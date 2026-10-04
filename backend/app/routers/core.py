from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BatteryStatus, Device, Journey, LocationUpdate, Notification, TrustedContact, User, utcnow
from app.schemas import ContactInput, JourneyInput, LocationInput, ProfileInput, RouteCheckInput
from app.services.safety import distance_meters, record_alert
from app.database import settings
from app.utils.auth import current_user
from app.utils.responses import fail, success

router = APIRouter(tags=["Users", "Contacts", "Journeys", "Locations"])


def profile_data(user: User):
    return {"id": user.id, "name": user.name, "email": user.email, "phone": user.phone, "blood_group": user.blood_group,
            "home_location": user.home_location, "preferred_language": user.preferred_language, "avatar": user.avatar}


def contact_data(contact: TrustedContact):
    return {"id": contact.id, "name": contact.name, "relationship": contact.relationship_name, "phone": contact.phone,
            "email": contact.email, "priority": contact.priority, "is_active": contact.is_active}


def journey_data(journey: Journey):
    return {"id": journey.id, "user_id": journey.user_id, "origin": journey.origin, "destination": journey.destination,
            "expected_arrival": journey.expected_arrival, "distance": journey.distance, "eta": journey.eta,
            "safety_score": journey.safety_score, "status": journey.status,
            "battery_guardian_enabled": journey.battery_guardian_enabled,
            "route_deviation_enabled": journey.route_deviation_enabled, "auto_checkin_enabled": journey.auto_checkin_enabled,
            "share_with_circle": journey.share_with_circle, "created_at": journey.created_at,
            "started_at": journey.started_at, "ended_at": journey.ended_at}


def owned_journey(db: Session, journey_id: int, user: User) -> Journey:
    journey = db.get(Journey, journey_id)
    if journey is None or journey.user_id != user.id:
        fail(404, "Journey not found.")
    return journey


def device_status_for(last_seen: datetime) -> str:
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    elapsed = (utcnow() - last_seen).total_seconds()
    if elapsed > 600:
        return "OFFLINE"
    if elapsed > 180:
        return "STALE"
    return "ONLINE"


def device_data(device: Device):
    return {
        "id": device.id,
        "user_id": device.user_id,
        "device_type": device.device_type,
        "device_name": device.device_name,
        "device_id": device.device_id,
        "platform": device.platform,
        "push_token": device.push_token,
        "last_seen": device.last_seen,
        "battery": device.battery,
        "is_active": device.is_active,
        "status": device_status_for(device.last_seen),
        "created_at": device.created_at,
        "updated_at": device.updated_at,
    }


@router.get("/api/users/me", tags=["Users"], summary="Read your profile")
def get_profile(user: User = Depends(current_user)):
    return success(profile_data(user))


@router.put("/api/users/me", tags=["Users"], summary="Update your profile")
def update_profile(payload: ProfileInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    values = payload.model_dump(exclude_unset=True)
    if "email" in values:
        values["email"] = values["email"].lower()
        other = db.scalar(select(User).where(User.email == values["email"], User.id != user.id))
        if other:
            fail(409, "That email is already registered.")
    for key, value in values.items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return success(profile_data(user))


@router.get("/api/contacts", tags=["Contacts"], summary="List trusted contacts")
def list_contacts(db: Session = Depends(get_db), user: User = Depends(current_user)):
    contacts = db.scalars(select(TrustedContact).where(TrustedContact.user_id == user.id).order_by(TrustedContact.priority)).all()
    return success([contact_data(contact) for contact in contacts])


@router.post("/api/contacts", status_code=201, tags=["Contacts"], summary="Add a trusted contact")
def add_contact(payload: ContactInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    contact = TrustedContact(user_id=user.id, relationship_name=payload.relationship, **payload.model_dump(exclude={"relationship"}))
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return success(contact_data(contact))


@router.put("/api/contacts/{contact_id}", tags=["Contacts"], summary="Update a trusted contact")
def update_contact(contact_id: int, payload: ContactInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    contact = db.get(TrustedContact, contact_id)
    if contact is None or contact.user_id != user.id:
        fail(404, "Contact not found.")
    for key, value in payload.model_dump().items():
        setattr(contact, "relationship_name" if key == "relationship" else key, value)
    db.commit()
    db.refresh(contact)
    return success(contact_data(contact))


@router.delete("/api/contacts/{contact_id}", tags=["Contacts"], summary="Remove a trusted contact")
def delete_contact(contact_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    contact = db.get(TrustedContact, contact_id)
    if contact is None or contact.user_id != user.id:
        fail(404, "Contact not found.")
    db.delete(contact)
    db.commit()
    return success({"deleted": True})


@router.post("/api/journeys", status_code=201, tags=["Journeys"], summary="Plan a journey")
def create_journey(payload: JourneyInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    journey = Journey(user_id=user.id, **payload.model_dump())
    db.add(journey)
    db.commit()
    db.refresh(journey)
    return success(journey_data(journey))


@router.get("/api/journeys", tags=["Journeys"], summary="List your journeys")
def list_journeys(db: Session = Depends(get_db), user: User = Depends(current_user)):
    journeys = db.scalars(select(Journey).where(Journey.user_id == user.id).order_by(Journey.created_at.desc())).all()
    return success([journey_data(journey) for journey in journeys])


@router.get("/api/journeys/{journey_id}", tags=["Journeys"], summary="Get a journey")
def get_journey(journey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return success(journey_data(owned_journey(db, journey_id, user)))


@router.put("/api/journeys/{journey_id}", tags=["Journeys"], summary="Update a planned journey")
def update_journey(journey_id: int, payload: JourneyInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    journey = owned_journey(db, journey_id, user)
    for key, value in payload.model_dump().items():
        setattr(journey, key, value)
    db.commit()
    db.refresh(journey)
    return success(journey_data(journey))


@router.post("/api/journeys/{journey_id}/start", tags=["Journeys"], summary="Start a journey")
def start_journey(journey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    journey = owned_journey(db, journey_id, user)
    if journey.status == "COMPLETED":
        fail(409, "A completed journey cannot be restarted.")
    journey.status = "ACTIVE"
    journey.started_at = utcnow()
    db.add(Notification(user_id=user.id, notification_type="JOURNEY_STARTED", message=f"Journey to {journey.destination} started."))
    db.commit()
    db.refresh(journey)
    return success(journey_data(journey))


@router.post("/api/journeys/{journey_id}/end", tags=["Journeys"], summary="Complete a journey")
def end_journey(journey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    journey = owned_journey(db, journey_id, user)
    journey.status = "COMPLETED"
    journey.ended_at = utcnow()
    db.add(Notification(user_id=user.id, notification_type="JOURNEY_COMPLETED", message=f"Journey to {journey.destination} completed."))
    db.commit()
    db.refresh(journey)
    return success(journey_data(journey))


@router.post("/api/journeys/{journey_id}/location", status_code=201, tags=["Locations"], summary="Store a live location update")
def add_location(journey_id: int, payload: LocationInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    journey = owned_journey(db, journey_id, user)
    location = LocationUpdate(user_id=user.id, journey_id=journey_id, **payload.model_dump(exclude={"timestamp"}), timestamp=payload.timestamp or utcnow())
    db.add(location)
    if payload.battery is not None:
        db.add(BatteryStatus(user_id=user.id, battery_percentage=payload.battery, latitude=payload.latitude,
                             longitude=payload.longitude, timestamp=payload.timestamp or utcnow()))
    db.commit()
    db.refresh(location)
    return success({"id": location.id, "journey_id": journey_id, "latitude": location.latitude, "longitude": location.longitude,
                    "timestamp": location.timestamp, "accuracy": location.accuracy, "battery": location.battery})


def location_data(location: LocationUpdate):
    return {"id": location.id, "latitude": location.latitude, "longitude": location.longitude, "timestamp": location.timestamp,
            "accuracy": location.accuracy, "battery": location.battery}


@router.get("/api/journeys/{journey_id}/location/latest", tags=["Locations"], summary="Get latest journey location")
def latest_location(journey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    journey = owned_journey(db, journey_id, user)
    location = db.scalar(select(LocationUpdate).where(LocationUpdate.journey_id == journey.id).order_by(LocationUpdate.timestamp.desc()))
    return success(location_data(location) if location else None)


@router.post("/api/devices", status_code=201, tags=["Devices"], summary="Create or register a connected device")
def create_device(payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    device_type = str(payload.get("device_type", "PHONE")).upper()
    device_id = str(payload.get("device_id") or payload.get("device_name") or f"device-{user.id}-{len(db.scalars(select(Device).where(Device.user_id == user.id)).all()) + 1}")
    existing = db.scalar(select(Device).where(Device.user_id == user.id, Device.device_id == device_id))
    if existing is not None:
        existing.device_type = device_type
        existing.device_name = payload.get("device_name") or existing.device_name
        existing.platform = payload.get("platform")
        existing.push_token = payload.get("push_token") or existing.push_token
        existing.last_seen = utcnow()
        existing.battery = payload.get("battery")
        existing.is_active = True
        existing.updated_at = utcnow()
        db.commit()
        db.refresh(existing)
        return success(device_data(existing))
    device = Device(user_id=user.id, device_type=device_type, device_name=payload.get("device_name"), device_id=device_id,
                   platform=payload.get("platform"), push_token=payload.get("push_token"), last_seen=utcnow(),
                   battery=payload.get("battery"), is_active=True, updated_at=utcnow())
    db.add(device)
    db.commit()
    db.refresh(device)
    return success(device_data(device))


@router.get("/api/devices", tags=["Devices"], summary="List your registered devices")
def list_devices(db: Session = Depends(get_db), user: User = Depends(current_user)):
    devices = db.scalars(select(Device).where(Device.user_id == user.id).order_by(Device.last_seen.desc())).all()
    return success([device_data(device) for device in devices])


@router.get("/api/devices/{device_id}", tags=["Devices"], summary="Get a registered device")
def get_device(device_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    device = db.get(Device, device_id)
    if device is None or device.user_id != user.id:
        fail(404, "Device not found.")
    return success(device_data(device))


@router.delete("/api/devices/{device_id}", tags=["Devices"], summary="Delete a registered device")
def delete_device(device_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    device = db.get(Device, device_id)
    if device is None or device.user_id != user.id:
        fail(404, "Device not found.")
    db.delete(device)
    db.commit()
    return success({"deleted": True})


@router.get("/api/devices/status", tags=["Devices"], summary="Get device connection health")
def device_status(db: Session = Depends(get_db), user: User = Depends(current_user)):
    devices = db.scalars(select(Device).where(Device.user_id == user.id)).all()
    statuses = {}
    for device in devices:
        statuses[device.device_id] = device_status_for(device.last_seen)
    return success({"devices": statuses, "summary": {"online": sum(1 for v in statuses.values() if v == "ONLINE"), "stale": sum(1 for v in statuses.values() if v == "STALE"), "offline": sum(1 for v in statuses.values() if v == "OFFLINE")}})


@router.get("/api/journeys/{journey_id}/locations", tags=["Locations"], summary="Get journey location history")
def list_locations(journey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    owned_journey(db, journey_id, user)
    locations = db.scalars(select(LocationUpdate).where(LocationUpdate.journey_id == journey_id).order_by(LocationUpdate.timestamp)).all()
    return success([location_data(location) for location in locations])


@router.post("/api/journeys/{journey_id}/route-check", tags=["Safety"], summary="Check location movement against the previous route point")
def route_check(journey_id: int, payload: RouteCheckInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    journey = owned_journey(db, journey_id, user)
    previous = db.scalar(select(LocationUpdate).where(LocationUpdate.journey_id == journey.id).order_by(LocationUpdate.timestamp.desc()))
    if not journey.route_deviation_enabled or previous is None:
        return success({"deviation": False, "distance_meters": 0, "threshold_meters": settings.route_deviation_meters, "alert": None})
    distance = distance_meters(previous.latitude, previous.longitude, payload.latitude, payload.longitude)
    alert = None
    if distance > settings.route_deviation_meters:
        alert = record_alert(db, user.id, journey.id, "ROUTE_DEVIATION", f"Location moved {round(distance)}m from the last route point.")
        db.commit()
    return success({"deviation": alert is not None, "distance_meters": round(distance, 1),
                    "threshold_meters": settings.route_deviation_meters, "alert": {"id": alert.id, "type": alert.alert_type} if alert else None})
