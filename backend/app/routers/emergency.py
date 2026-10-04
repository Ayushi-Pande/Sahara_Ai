import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AlertEscalation, BatteryStatus, Device, EmergencyReport, EmergencyTimeline, Journey, JourneyCheckIn, LocationUpdate, Notification, SOSIncident, SOSIncidentEvent, TrustedContact, User, VoiceCommand, WatchDevice, utcnow
from app.schemas import BatteryInput, CheckInInput, PinInput, PinSetupInput, SOSInput, VoiceInput, WatchInput, WatchSOSInput
from app.services.safety import check_missed_arrival, record_alert
from app.utils.auth import current_user, hash_password, verify_password
from app.utils.rate_limit import rate_limit
from app.utils.responses import fail, success

router = APIRouter(tags=["SOS", "Safety", "Voice", "Battery", "Notifications", "Smartwatch"])
SOS_TRIGGERS = {"MANUAL", "VOICE", "STEALTH", "DURESS_PIN", "SMARTWATCH", "ROUTE_DEVIATION", "MISSED_CHECKIN"}


def record_incident_event(db: Session, incident_id: int, event_type: str, metadata: dict | None = None):
    payload = json.dumps(metadata) if metadata else None
    entry = SOSIncidentEvent(incident_id=incident_id, event_type=event_type, metadata=payload)
    db.add(entry)
    db.add(EmergencyTimeline(incident_id=incident_id, event_type=event_type, metadata=payload))
    return entry


def create_sos(db: Session, user: User, payload: SOSInput, device_id: str | None = None):
    if payload.journey_id is not None:
        journey = db.get(Journey, payload.journey_id)
        if journey is None or journey.user_id != user.id:
            fail(404, "Journey not found.")
    latitude, longitude = payload.latitude, payload.longitude
    if (latitude is None or longitude is None) and payload.journey_id:
        last_location = db.scalar(
            select(LocationUpdate).where(LocationUpdate.journey_id == payload.journey_id).order_by(LocationUpdate.timestamp.desc())
        )
        if last_location:
            latitude, longitude = last_location.latitude, last_location.longitude
    if payload.trigger_type not in SOS_TRIGGERS:
        fail(422, "Unsupported emergency trigger type.")
    incident = SOSIncident(user_id=user.id, journey_id=payload.journey_id, latitude=latitude, longitude=longitude,
                           trigger_type=payload.trigger_type, message=payload.message)
    db.add(incident)
    db.flush()
    record_incident_event(db, incident.id, "SOS_TRIGGERED", {"trigger_type": payload.trigger_type, "device_id": device_id})
    db.add(Notification(user_id=user.id, notification_type="SOS", message=f"Emergency incident {incident.id} activated."))
    contacts = db.scalars(select(TrustedContact).where(TrustedContact.user_id == user.id, TrustedContact.is_active.is_(True))).all()
    notified = 0
    for contact in contacts:
        if contact.email:
            recipient = db.scalar(select(User).where(User.email == contact.email.lower()))
            if recipient:
                db.add(Notification(user_id=recipient.id, notification_type="SOS", message=f"{user.name} activated an emergency alert."))
                notified += 1
    db.add(record_alert(db, user.id, payload.journey_id, "SOS", f"Emergency incident {incident.id} activated."))
    db.flush()
    return incident, notified


def incident_data(incident: SOSIncident):
    return {"incident_id": incident.id, "status": incident.status, "timestamp": incident.created_at,
            "location": {"latitude": incident.latitude, "longitude": incident.longitude},
            "trigger_type": incident.trigger_type, "message": incident.message}


@router.post("/api/journeys/{journey_id}/check-in", tags=["Safety"], summary="Record a journey safety check-in")
def check_in(journey_id: int, payload: CheckInInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    journey = db.get(Journey, journey_id)
    if journey is None or journey.user_id != user.id:
        fail(404, "Journey not found.")
    item = JourneyCheckIn(user_id=user.id, journey_id=journey.id, status=payload.status)
    db.add(item)
    if payload.status == "NEED_HELP":
        record_alert(db, user.id, journey.id, "MISSED_CHECKIN", "The user requested help during a journey check-in.")
        create_sos(db, user, SOSInput(journey_id=journey.id, trigger_type="MISSED_CHECKIN", message="User check-in requested help."))
    elif payload.status == "NO_RESPONSE":
        record_alert(db, user.id, journey.id, "MISSED_CHECKIN", "No response was received for a journey check-in.")
    db.commit()
    return success({"id": item.id, "journey_id": item.journey_id, "status": item.status, "timestamp": item.timestamp})


@router.post("/api/sos", status_code=201, summary="Activate an emergency incident", dependencies=[Depends(rate_limit(200, 60))])
def activate_sos(payload: SOSInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    incident, notified = create_sos(db, user, payload)
    db.commit()
    db.refresh(incident)
    result = incident_data(incident)
    result["contacts_notified"] = notified
    result["notification_note"] = "In-app notifications are created for contacts with registered accounts; this prototype does not send SMS or place calls."
    return success(result)


@router.post("/api/sos/stealth", status_code=201, summary="Securely activate a stealth SOS trigger")
def stealth_sos(payload: SOSInput | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    trigger = payload or SOSInput(trigger_type="STEALTH")
    trigger.trigger_type = "STEALTH"
    incident, notified = create_sos(db, user, trigger)
    db.commit()
    db.refresh(incident)
    result = incident_data(incident)
    result["contacts_notified"] = notified
    result["device_capability_note"] = "This endpoint accepts an authenticated integration trigger; browser operating-system buttons are not accessed."
    return success(result)


def owned_incident(db: Session, incident_id: int, user: User) -> SOSIncident:
    incident = db.get(SOSIncident, incident_id)
    if incident is None or incident.user_id != user.id:
        fail(404, "Emergency incident not found.")
    return incident


@router.get("/api/sos/{incident_id}", summary="Get emergency status")
def get_sos(incident_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return success(incident_data(owned_incident(db, incident_id, user)))


@router.get("/api/sos/{incident_id}/timeline", summary="Get emergency timeline and event history")
def sos_timeline(incident_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    incident = owned_incident(db, incident_id, user)
    rows = db.scalars(select(EmergencyTimeline).where(EmergencyTimeline.incident_id == incident.id).order_by(EmergencyTimeline.timestamp.asc())).all()
    return success([
        {"id": row.id, "event_type": row.event_type, "timestamp": row.timestamp, "metadata": json.loads(row.metadata) if row.metadata else None}
        for row in rows
    ])


@router.get("/api/emergency-reports", summary="List emergency reports")
def list_emergency_reports(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(EmergencyReport).where(EmergencyReport.user_id == user.id).order_by(EmergencyReport.created_at.desc())).all()
    return success([
        {
            "id": row.id,
            "incident_id": row.incident_id,
            "trigger_type": row.trigger_type,
            "start_time": row.start_time,
            "end_time": row.end_time,
            "location": row.location,
            "timeline": row.timeline,
            "contacts_notified": row.contacts_notified,
            "actions_taken": row.actions_taken,
            "evidence": row.evidence,
            "final_status": row.final_status,
            "details": row.details,
            "created_at": row.created_at,
        }
        for row in rows
    ])


@router.get("/api/emergency-reports/{report_id}", summary="Get an emergency report")
def get_emergency_report(report_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.get(EmergencyReport, report_id)
    if row is None or row.user_id != user.id:
        fail(404, "Emergency report not found.")
    return success({
        "id": row.id,
        "incident_id": row.incident_id,
        "trigger_type": row.trigger_type,
        "start_time": row.start_time,
        "end_time": row.end_time,
        "location": row.location,
        "timeline": row.timeline,
        "contacts_notified": row.contacts_notified,
        "actions_taken": row.actions_taken,
        "evidence": row.evidence,
        "final_status": row.final_status,
        "details": row.details,
        "created_at": row.created_at,
    })


def set_incident_status(incident_id: int, status: str, db: Session, user: User):
    incident = owned_incident(db, incident_id, user)
    incident.status = status
    incident.resolved_at = utcnow() if status in {"SAFE", "CANCELLED"} else None
    record_incident_event(db, incident.id, status, {"status": status})
    db.add(Notification(user_id=user.id, notification_type="SOS", message=f"Emergency incident {incident.id} status changed to {status}."))
    db.commit()
    db.refresh(incident)
    return success(incident_data(incident))


@router.post("/api/sos/{incident_id}/safe", summary="Mark yourself safe")
def sos_safe(incident_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return set_incident_status(incident_id, "SAFE", db, user)


@router.post("/api/sos/{incident_id}/cancel", summary="Cancel an emergency incident")
def sos_cancel(incident_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return set_incident_status(incident_id, "CANCELLED", db, user)


@router.post("/api/sos/{incident_id}/need-help", summary="Confirm continued need for help")
def sos_need_help(incident_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return set_incident_status(incident_id, "NEED_HELP", db, user)


@router.post("/api/security/duress-pin", summary="Set private and duress PINs")
def set_pins(payload: PinSetupInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if payload.pin == payload.duress_pin:
        fail(400, "The duress PIN must differ from the regular PIN.")
    user.security_pin_hash = hash_password(payload.pin)
    user.duress_pin_hash = hash_password(payload.duress_pin)
    db.commit()
    return success({"configured": True})


@router.post("/api/security/verify-pin", summary="Verify a PIN without revealing stored values")
def verify_pin(payload: PinInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not user.security_pin_hash or not user.duress_pin_hash:
        fail(409, "Configure both PINs before verification.")
    if verify_password(payload.pin, user.duress_pin_hash):
        incident, notified = create_sos(db, user, SOSInput(trigger_type="DURESS_PIN", message="Duress PIN entered."))
        db.commit()
        return success({"is_duress": True, "action": "ACTIVATE_EMERGENCY", "incident_id": incident.id,
                        "contacts_notified": notified})
    if verify_password(payload.pin, user.security_pin_hash):
        return success({"is_duress": False, "action": "NONE"})
    fail(401, "PIN is incorrect.")


@router.post("/api/battery/update", status_code=201, tags=["Battery"], summary="Update battery and last-known location")
def update_battery(payload: BatteryInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    previous = db.scalar(select(BatteryStatus).where(BatteryStatus.user_id == user.id).order_by(BatteryStatus.timestamp.desc()))
    battery = BatteryStatus(user_id=user.id, battery_percentage=payload.battery_percentage, timestamp=payload.timestamp or utcnow(),
                            latitude=payload.latitude, longitude=payload.longitude)
    db.add(battery)
    thresholds = (20, 15, 10)
    for threshold in thresholds:
        crossed = payload.battery_percentage <= threshold and (previous is None or previous.battery_percentage > threshold)
        if crossed:
            record_alert(db, user.id, None, "BATTERY_LOW", f"Battery has reached {payload.battery_percentage}% (critical threshold {threshold}%).")
    db.commit()
    return success({"battery_percentage": battery.battery_percentage, "timestamp": battery.timestamp,
                    "location": {"latitude": battery.latitude, "longitude": battery.longitude}})


@router.get("/api/battery/latest", tags=["Battery"], summary="Get your latest battery status")
def latest_battery(db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.scalar(select(BatteryStatus).where(BatteryStatus.user_id == user.id).order_by(BatteryStatus.timestamp.desc()))
    if item is None:
        return success(None)
    return success({"battery_percentage": item.battery_percentage, "timestamp": item.timestamp,
                    "latitude": item.latitude, "longitude": item.longitude})


@router.get("/api/notifications", tags=["Notifications"], summary="List your notifications")
def list_notifications(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc())).all()
    return success([{"id": row.id, "type": row.notification_type, "message": row.message, "read": row.read, "created_at": row.created_at} for row in rows])


@router.post("/api/notifications/{notification_id}/read", tags=["Notifications"], summary="Mark a notification read")
def read_notification(notification_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.get(Notification, notification_id)
    if row is None or row.user_id != user.id:
        fail(404, "Notification not found.")
    row.read = True
    db.commit()
    return success({"id": row.id, "read": row.read})


@router.post("/api/voice/command", tags=["Voice"], summary="Interpret a supported prototype voice command", dependencies=[Depends(rate_limit(200, 60))])
def voice_command(payload: VoiceInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    command = payload.command.strip().lower()
    intent, action, response = "UNKNOWN", "NO_ACTION", "I couldn't match that command. Try asking for help or location sharing."
    if any(phrase in command for phrase in ("need help", "help me", "emergency", "sos")):
        incident, _ = create_sos(db, user, SOSInput(trigger_type="VOICE", message=payload.command))
        intent, action, response = "SOS", "ACTIVATE_EMERGENCY", f"Emergency mode activated. Incident {incident.id}."
    elif "start" in command and "journey" in command:
        journey = db.scalar(select(Journey).where(Journey.user_id == user.id, Journey.status == "PLANNED").order_by(Journey.created_at.desc()))
        if journey:
            journey.status, journey.started_at = "ACTIVE", utcnow()
            intent, action, response = "START_JOURNEY", "START_LATEST_PLANNED_JOURNEY", f"Journey to {journey.destination} started."
        else:
            intent, action, response = "START_JOURNEY", "NO_PLANNED_JOURNEY", "You don't have a planned journey to start."
    elif "share" in command and "location" in command:
        journey = db.scalar(select(Journey).where(Journey.user_id == user.id, Journey.status == "ACTIVE", Journey.share_with_circle.is_(True)).order_by(Journey.started_at.desc()))
        location = db.scalar(select(LocationUpdate).where(LocationUpdate.journey_id == journey.id).order_by(LocationUpdate.timestamp.desc())) if journey else None
        if not location:
            intent, action, response = "SHARE_LOCATION", "LOCATION_UNAVAILABLE", "Start a shared active journey and allow a location update before sharing."
        else:
            contacts = db.scalars(select(TrustedContact).where(TrustedContact.user_id == user.id, TrustedContact.is_active.is_(True))).all()
            notified = 0
            for contact in contacts:
                recipient = db.scalar(select(User).where(User.email == contact.email.lower())) if contact.email else None
                if recipient:
                    db.add(Notification(user_id=recipient.id, notification_type="LOCATION_SHARED",
                                        message=f"{user.name} shared journey location: {location.latitude},{location.longitude}."))
                    notified += 1
            db.add(Notification(user_id=user.id, notification_type="LOCATION_SHARED", message="Your latest journey location was shared with registered trusted contacts."))
            intent, action = "SHARE_LOCATION", "SHARE_WITH_TRUSTED_CIRCLE"
            response = f"Your latest journey location was shared with {notified} registered trusted contact account(s)."
    elif "nearby" in command and "help" in command:
        intent, action, response = "FIND_HELP", "OPEN_NEARBY_HELP", "Nearby help options are available in the help directory."
    elif "call" in command:
        intent, action, response = "CALL_CONTACT", "OPEN_CONTACT_CALL", "Open the selected trusted contact to place a call on your device."
    elif "late" in command or "tell" in command and "mom" in command:
        intent, action, response = "SEND_DELAY_MESSAGE", "NOTIFY_TRUSTED_CIRCLE", "Your trusted circle has been notified in-app that you may be late."
        db.add(Notification(user_id=user.id, notification_type="LOCATION_SHARED", message="The user said they may be late."))
        contacts = db.scalars(select(TrustedContact).where(TrustedContact.user_id == user.id, TrustedContact.is_active.is_(True))).all()
        for contact in contacts:
            recipient = db.scalar(select(User).where(User.email == contact.email.lower())) if contact.email else None
            if recipient:
                db.add(Notification(user_id=recipient.id, notification_type="LOCATION_SHARED", message=f"{user.name} said they may be late."))
    row = VoiceCommand(user_id=user.id, command=payload.command, intent=intent, action=action)
    db.add(row)
    db.commit()
    return success({"intent": intent, "action": action, "response": response})


@router.post("/api/watch/sos", status_code=201, tags=["Smartwatch"], summary="Accept a smartwatch integration SOS trigger")
def watch_sos(payload: WatchSOSInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    device = db.scalar(select(WatchDevice).where(WatchDevice.user_id == user.id, WatchDevice.device_id == payload.device_id))
    if device is None:
        device = WatchDevice(user_id=user.id, device_id=payload.device_id)
        db.add(device)
    else:
        device.last_seen = utcnow()
    incident, notified = create_sos(db, user, SOSInput(latitude=payload.latitude, longitude=payload.longitude,
                                                        trigger_type="SMARTWATCH", message=f"Watch trigger from {payload.device_id}."))
    db.commit()
    db.refresh(incident)
    return success({**incident_data(incident), "contacts_notified": notified, "device_id": payload.device_id,
                    "integration_note": "Prototype trigger endpoint only; no physical smartwatch connection is configured."})



@router.post("/api/watch/checkin", tags=["Smartwatch"], summary="Record a smartwatch safety check-in")
def watch_checkin(payload: WatchInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    device = db.scalar(select(WatchDevice).where(WatchDevice.user_id == user.id, WatchDevice.device_id == payload.device_id))
    if device is None:
        device = WatchDevice(user_id=user.id, device_id=payload.device_id)
        db.add(device)
    device.last_seen = utcnow()
    journey = db.scalar(select(Journey).where(Journey.user_id == user.id, Journey.status == "ACTIVE").order_by(Journey.started_at.desc()))
    if journey and payload.status:
        db.add(JourneyCheckIn(user_id=user.id, journey_id=journey.id, status=payload.status))
        if payload.status == "NEED_HELP":
            create_sos(db, user, SOSInput(journey_id=journey.id, trigger_type="SMARTWATCH", message="Watch check-in requested help."))
    db.commit()
    return success({"accepted": True, "device_id": payload.device_id, "journey_id": journey.id if journey else None,
                    "integration_note": "Prototype endpoint; no smartwatch platform API is connected."})


@router.post("/api/watch/voice", tags=["Smartwatch"], summary="Interpret a smartwatch voice command")
def watch_voice(payload: WatchInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    device = db.scalar(select(WatchDevice).where(WatchDevice.user_id == user.id, WatchDevice.device_id == payload.device_id))
    if device is None:
        device = WatchDevice(user_id=user.id, device_id=payload.device_id)
        db.add(device)
    device.last_seen = utcnow()
    db.commit()
    command_result = voice_command(VoiceInput(command=payload.command or ""), db, user) if payload.command else success({"intent": "UNKNOWN", "action": "NO_ACTION", "response": "No command supplied."})
    return success({"device_id": payload.device_id, "command_result": command_result["data"],
                    "integration_note": "Prototype endpoint; voice capture is provided by the device or frontend."})


@router.get("/api/watch/status", tags=["Smartwatch"], summary="List registered demo watch integrations")
def watch_status(db: Session = Depends(get_db), user: User = Depends(current_user)):
    devices = db.scalars(select(WatchDevice).where(WatchDevice.user_id == user.id).order_by(WatchDevice.last_seen.desc())).all()
    return success({"demo_mode": True, "connected": bool(devices), "devices": [{"device_id": item.device_id, "last_seen": item.last_seen} for item in devices],
                    "note": "A registered integration trigger is not proof of a live physical device connection."})
