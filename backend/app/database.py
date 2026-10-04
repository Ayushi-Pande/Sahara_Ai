from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Settings(BaseSettings):
    database_url: str = "sqlite:///./sahara.db"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    secret_key: str = "replace-this-development-secret"
    frontend_url: str = "http://localhost:5173"
    access_token_minutes: int = 60
    route_deviation_meters: float = 500
    max_upload_mb: int = 15
    demo_mode: bool = True
    max_rate_requests: int = 30
    rate_limit_window_seconds: int = 60

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()


def supabase_configured() -> bool:
    return bool(settings.supabase_url and settings.supabase_anon_key)


class Base(DeclarativeBase):
    pass


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_upload_dir() -> Path:
    path = Path(__file__).resolve().parents[1] / "uploads"
    path.mkdir(parents=True, exist_ok=True)
    return path
