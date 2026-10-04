from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class SignupInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    phone: str | None = Field(default=None, max_length=40)


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ProfileInput(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    blood_group: str | None = Field(default=None, max_length=8)
    home_location: str | None = Field(default=None, max_length=255)
    preferred_language: str | None = Field(default=None, max_length=40)
    avatar: str | None = Field(default=None, max_length=500)


class ContactInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    relationship: str = Field(default="Friend", max_length=80)
    phone: str = Field(min_length=3, max_length=40)
    email: EmailStr | None = None
    priority: int = Field(default=1, ge=1, le=20)
    is_active: bool = True


class JourneyInput(BaseModel):
    origin: str = Field(min_length=1, max_length=255)
    destination: str = Field(min_length=1, max_length=255)
    expected_arrival: datetime | None = None
    distance: float | None = Field(default=None, ge=0)
    eta: int | None = Field(default=None, ge=0)
    battery_guardian_enabled: bool = True
    route_deviation_enabled: bool = True
    auto_checkin_enabled: bool = True
    share_with_circle: bool = True


class LocationInput(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    timestamp: datetime | None = None
    accuracy: float | None = Field(default=None, ge=0)
    battery: int | None = Field(default=None, ge=0, le=100)


class RouteCheckInput(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class CheckInInput(BaseModel):
    status: Literal["SAFE", "NEED_HELP", "NO_RESPONSE"]


class SOSInput(BaseModel):
    journey_id: int | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    trigger_type: Literal["MANUAL", "VOICE", "STEALTH", "DURESS_PIN", "SMARTWATCH", "ROUTE_DEVIATION", "MISSED_CHECKIN"] = "MANUAL"
    message: str | None = Field(default=None, max_length=2000)


class SOSStateInput(BaseModel):
    status: Literal["SAFE", "CANCELLED", "NEED_HELP"] | None = None


class PinInput(BaseModel):
    pin: str = Field(min_length=4, max_length=12, pattern=r"^[0-9]+$")


class PinSetupInput(BaseModel):
    pin: str = Field(min_length=4, max_length=12, pattern=r"^[0-9]+$")
    duress_pin: str = Field(min_length=4, max_length=12, pattern=r"^[0-9]+$")


class VoiceInput(BaseModel):
    command: str = Field(min_length=1, max_length=1000)


class CommunityInput(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    type: Literal["UNSAFE_AREA", "POOR_LIGHTING", "HARASSMENT", "SUSPICIOUS_ACTIVITY", "SAFE_AREA"]
    description: str = Field(min_length=1, max_length=2000)
    severity: int = Field(default=1, ge=1, le=5)
    timestamp: datetime | None = None


class BatteryInput(BaseModel):
    battery_percentage: int = Field(ge=0, le=100)
    timestamp: datetime | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class WatchSOSInput(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class WatchInput(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    status: Literal["SAFE", "NEED_HELP"] | None = None
    command: str | None = Field(default=None, max_length=1000)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
