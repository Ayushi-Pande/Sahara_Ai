from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import ensure_upload_dir, get_db, settings
from app.models import Evidence, User, utcnow
from app.utils.auth import current_user
from app.utils.rate_limit import rate_limit
from app.utils.responses import fail, success

router = APIRouter(prefix="/api/evidence", tags=["Evidence"])
ALLOWED_TYPES = {"photo": {"jpg", "jpeg", "png", "webp"}, "audio": {"mp3", "wav", "m4a", "ogg"},
                 "video": {"mp4", "webm", "mov"}, "screenshot": {"jpg", "jpeg", "png", "webp"},
                 "location_snapshot": set(), "note": set()}
ALLOWED_CONTENT_TYPES = {
    "jpg": {"image/jpeg"}, "jpeg": {"image/jpeg"}, "png": {"image/png"}, "webp": {"image/webp"},
    "mp3": {"audio/mpeg"}, "wav": {"audio/wav", "audio/x-wav"}, "m4a": {"audio/mp4", "audio/x-m4a"},
    "ogg": {"audio/ogg", "audio/vorbis"}, "mp4": {"video/mp4"}, "webm": {"video/webm"},
    "mov": {"video/quicktime"},
}


def evidence_data(item: Evidence):
    return {"id": item.id, "filename": item.filename, "type": item.type, "timestamp": item.timestamp,
            "latitude": item.latitude, "longitude": item.longitude, "description": item.description,
            "download_url": f"/api/evidence/{item.id}/download" if item.stored_filename else None}


@router.post("/upload", status_code=201, summary="Upload private evidence metadata and optional file",
             dependencies=[Depends(rate_limit(100, 60))])
async def upload_evidence(type: str = Form(...), file: UploadFile | None = File(default=None),
                          description: str | None = Form(default=None), latitude: float | None = Form(default=None),
                          longitude: float | None = Form(default=None), db: Session = Depends(get_db),
                          user: User = Depends(current_user)):
    evidence_type = type.lower()
    if evidence_type not in ALLOWED_TYPES:
        fail(422, "Unsupported evidence type.")
    if evidence_type in {"note", "location_snapshot"} and file is not None:
        fail(422, "Notes and location snapshots do not accept file uploads.")
    if evidence_type not in {"note", "location_snapshot"} and file is None:
        fail(422, "A file is required for this evidence type.")
    if evidence_type == "note" and not description:
        fail(422, "A description is required for note evidence.")
    stored_filename = None
    filename = ""
    if file is not None:
        original = (file.filename or "upload").replace("\\", "/").split("/")[-1]
        extension = Path(original).suffix.lower().lstrip(".")
        if extension not in ALLOWED_TYPES[evidence_type]:
            fail(415, "The file extension does not match an allowed type.")
        content_type = (file.content_type or "application/octet-stream").lower()
        if content_type != "application/octet-stream" and content_type not in ALLOWED_CONTENT_TYPES.get(extension, set()):
            fail(415, "The file content type does not match an allowed type.")
        content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
        if len(content) > settings.max_upload_mb * 1024 * 1024:
            fail(413, f"File exceeds the {settings.max_upload_mb} MB upload limit.")
        if not content:
            fail(400, "Uploaded file is empty.")
        stored_filename = f"{uuid4().hex}.{extension}"
        (ensure_upload_dir() / stored_filename).write_bytes(content)
        filename = original[:255]
    item = Evidence(user_id=user.id, filename=filename or "note.txt", stored_filename=stored_filename,
                    type=evidence_type, timestamp=utcnow(), latitude=latitude, longitude=longitude, description=description)
    try:
        db.add(item)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        if stored_filename:
            (ensure_upload_dir() / stored_filename).unlink(missing_ok=True)
        raise
    db.refresh(item)
    return success(evidence_data(item))


@router.get("", summary="List your private evidence")
def list_evidence(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(Evidence).where(Evidence.user_id == user.id).order_by(Evidence.timestamp.desc())).all()
    return success([evidence_data(item) for item in rows])


@router.get("/{evidence_id}", summary="Get private evidence metadata")
def get_evidence(evidence_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Evidence, evidence_id)
    if item is None or item.user_id != user.id:
        fail(404, "Evidence not found.")
    return success(evidence_data(item))


@router.get("/{evidence_id}/download", summary="Download a private evidence file")
def download_evidence(evidence_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Evidence, evidence_id)
    if item is None or item.user_id != user.id or not item.stored_filename:
        fail(404, "Evidence file not found.")
    path = ensure_upload_dir() / item.stored_filename
    if not path.is_file():
        fail(404, "Evidence file is unavailable.")
    return FileResponse(path, filename=item.filename)


@router.delete("/{evidence_id}", summary="Delete private evidence")
def delete_evidence(evidence_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Evidence, evidence_id)
    if item is None or item.user_id != user.id:
        fail(404, "Evidence not found.")
    if item.stored_filename:
        (ensure_upload_dir() / item.stored_filename).unlink(missing_ok=True)
    db.delete(item)
    db.commit()
    return success({"deleted": True})
