from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db, settings
from app.models import User, UserSession, utcnow
from app.schemas import LoginInput, SignupInput
from app.utils.auth import create_access_token, current_user, hash_password, oauth2_scheme, verify_password
from app.utils.rate_limit import rate_limit
from app.utils.responses import fail, success

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def create_session(db: Session, user: User, token: str | None = None):
    issued_token = token or create_access_token(user.id)
    session = UserSession(
        user_id=user.id,
        session_token=issued_token,
        user_agent="",
        ip_address="",
        created_at=utcnow(),
        last_seen_at=utcnow(),
        expires_at=utcnow() + timedelta(minutes=settings.access_token_minutes),
    )
    db.add(session)
    db.flush()
    return session


@router.post("/signup", status_code=201, summary="Create an account", dependencies=[Depends(rate_limit(100, 60))])
def signup(payload: SignupInput, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        fail(409, "An account with this email already exists.")
    user = User(name=payload.name.strip(), email=email, password_hash=hash_password(payload.password), phone=payload.phone)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id)
    create_session(db, user, token)
    db.commit()
    return success({"access_token": token, "token_type": "bearer", "user": {"id": user.id, "name": user.name, "email": user.email}})


@router.post("/login", summary="Authenticate and receive a JWT", dependencies=[Depends(rate_limit(100, 60))])
def login(payload: LoginInput, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        fail(401, "Email or password is incorrect.")
    token = create_access_token(user.id)
    create_session(db, user, token)
    db.commit()
    return success({"access_token": token, "token_type": "bearer", "user": {"id": user.id, "name": user.name, "email": user.email}})


@router.get("/me", summary="Get the authenticated account")
def auth_me(user: User = Depends(current_user)):
    return success({"id": user.id, "name": user.name, "email": user.email})


@router.get("/sessions", summary="List active sessions")
def list_sessions(db: Session = Depends(get_db), user: User = Depends(current_user)):
    sessions = db.scalars(select(UserSession).where(UserSession.user_id == user.id).order_by(UserSession.created_at.desc())).all()
    return success([
        {"id": session.id, "user_agent": session.user_agent, "ip_address": session.ip_address, "created_at": session.created_at,
         "last_seen_at": session.last_seen_at, "expires_at": session.expires_at, "revoked_at": session.revoked_at}
        for session in sessions
    ])


@router.delete("/sessions/{session_id}", summary="Terminate one session")
def delete_session(session_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    session = db.get(UserSession, session_id)
    if session is None or session.user_id != user.id:
        fail(404, "Session not found.")
    session.revoked_at = utcnow()
    db.commit()
    return success({"deleted": True, "session_id": session_id})


@router.post("/logout", summary="Log out the current device")
def logout_current(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), user: User = Depends(current_user)):
    session = db.scalar(select(UserSession).where(UserSession.user_id == user.id, UserSession.session_token == token))
    if session is not None and session.revoked_at is None:
        session.revoked_at = utcnow()
        db.commit()
    return success({"logged_out": True})


@router.post("/logout-all", summary="Log out every device")
def logout_all(db: Session = Depends(get_db), user: User = Depends(current_user)):
    sessions = db.scalars(select(UserSession).where(UserSession.user_id == user.id)).all()
    for session in sessions:
        session.revoked_at = utcnow()
    db.commit()
    return success({"logged_out": len(sessions)})
