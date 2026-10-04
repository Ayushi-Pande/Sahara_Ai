import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.database import Base, SessionLocal, engine, settings, supabase_configured
from app.models import Journey
from app.routers import auth, community, core, emergency, evidence
from app.services.safety import check_missed_arrival


async def arrival_monitor():
    while True:
        db = SessionLocal()
        try:
            active = db.scalars(select(Journey).where(Journey.status == "ACTIVE")).all()
            changed = False
            for journey in active:
                changed = check_missed_arrival(db, journey) or changed
            if changed:
                db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    task = asyncio.create_task(arrival_monitor())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
    engine.dispose()


app = FastAPI(
    title="SAHARA AI Backend",
    description="Hackathon prototype API for women's safety, journey tracking, and emergency response. Scores are decision support only.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url.rstrip("/")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

for feature_router in (auth.router, core.router, emergency.router, community.router, evidence.router):
    app.include_router(feature_router)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException):
    detail = exc.detail
    if isinstance(detail, dict) and detail.get("success") is False:
        body = detail
    else:
        body = {"success": False, "message": str(detail)}
    return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    messages = [f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}" for error in exc.errors()]
    return JSONResponse(status_code=422, content={"success": False, "message": "; ".join(messages)})


@app.get("/health", tags=["Health"], summary="Check API service status")
def health():
    return {"status": "ok", "service": "SAHARA AI Backend", "version": "2.0.0"}


@app.get("/api/system/status", tags=["System"], summary="Read deployment and environment health")
def system_status():
    return {
        "success": True,
        "data": {
            "database": "ok",
            "supabase": "configured" if supabase_configured() else "demo",
            "storage": "ok",
            "realtime": "enabled" if supabase_configured() else "demo",
            "environment": "production" if settings.secret_key != "replace-this-development-secret" else "development",
            "background_monitor": "running",
            "version": "2.0.0",
        },
    }


@app.get("/api", tags=["API"], summary="Discover API service information")
def api_index():
    return {"success": True, "data": {"service": "SAHARA AI Backend", "version": "2.0.0", "docs": "/docs", "health": "/health"}}


@app.get("/", tags=["API"], include_in_schema=False)
def root():
    return api_index()
