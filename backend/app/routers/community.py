from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BatteryStatus, CommunityReport, Journey, LocationUpdate, SafetyAlert, TrustedContact, User, utcnow
from app.schemas import CommunityInput
from app.services.safety import SafetyScoreService, check_missed_arrival, distance_meters
from app.utils.auth import current_user
from app.utils.responses import fail, success

router = APIRouter(tags=["Community", "Nearby Help", "Guardian", "AI", "Safety"])


def guardian_owner(db: Session, guardian: User, owner_id: int) -> User:
    owner = db.get(User, owner_id)
    if owner is None:
        fail(404, "User not found.")
    contact = db.scalar(
        select(TrustedContact).where(
            TrustedContact.user_id == owner_id,
            TrustedContact.is_active.is_(True),
            TrustedContact.guardian_authorized.is_(True),
            ((TrustedContact.email == guardian.email) | (TrustedContact.phone == guardian.phone)),
        )
    )
    if contact is None:
        fail(403, "You are not an authorized guardian for this user.")
    return owner


def shared_active_journey(db: Session, owner: User) -> Journey | None:
    journey = db.scalar(
        select(Journey).where(Journey.user_id == owner.id, Journey.status == "ACTIVE", Journey.share_with_circle.is_(True))
        .order_by(Journey.started_at.desc())
    )
    return journey


@router.get("/api/community/reports", summary="List public community safety reports")
def list_community_reports(db: Session = Depends(get_db), report_type: str | None = Query(default=None, alias="type")):
    query = select(CommunityReport).order_by(CommunityReport.timestamp.desc())
    if report_type:
        query = query.where(CommunityReport.type == report_type.upper())
    reports = db.scalars(query).all()
    return success([{"id": item.id, "latitude": item.latitude, "longitude": item.longitude, "type": item.type,
                    "description": item.description, "severity": item.severity, "timestamp": item.timestamp} for item in reports])


@router.get("/api/community/reports/nearby", summary="Find nearby community reports")
def nearby_community_reports(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180),
                            radius_km: float = Query(default=25, gt=0, le=250), db: Session = Depends(get_db)):
    rows = db.scalars(select(CommunityReport).order_by(CommunityReport.timestamp.desc())).all()
    results = []
    for row in rows:
        distance = distance_meters(latitude, longitude, row.latitude, row.longitude) / 1000
        if distance <= radius_km:
            results.append({"id": row.id, "latitude": row.latitude, "longitude": row.longitude, "type": row.type,
                            "description": row.description, "severity": row.severity, "distance_km": round(distance, 2)})
    return success(sorted(results, key=lambda item: item["distance_km"]))


@router.post("/api/community/reports", status_code=201, summary="Submit a community safety report")
def add_community_report(payload: CommunityInput, db: Session = Depends(get_db), user: User = Depends(current_user)):
    report = CommunityReport(user_id=user.id, **payload.model_dump(exclude={"timestamp"}), timestamp=payload.timestamp or utcnow())
    db.add(report)
    db.commit()
    db.refresh(report)
    return success({"id": report.id, "latitude": report.latitude, "longitude": report.longitude, "type": report.type,
                    "description": report.description, "severity": report.severity, "timestamp": report.timestamp})


@router.get("/api/help/nearby", summary="Find seeded nearby help locations")
def nearby_help(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180),
                category: str | None = None, radius_km: float = Query(default=25, gt=0, le=250), db: Session = Depends(get_db)):
    from app.models import NearbyHelp

    rows = db.scalars(select(NearbyHelp)).all()
    results = []
    for row in rows:
        if category and row.category != category.upper():
            continue
        distance = distance_meters(latitude, longitude, row.latitude, row.longitude) / 1000
        if distance <= radius_km:
            results.append({"id": row.id, "name": row.name, "category": row.category, "latitude": row.latitude,
                            "longitude": row.longitude, "address": row.address, "phone": row.phone, "distance_km": round(distance, 2)})
    return success(sorted(results, key=lambda item: item["distance_km"]))


@router.get("/api/analytics/dashboard", summary="Return aggregated safety analytics")
def analytics_dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)):
    total_journeys = db.query(Journey).count()
    completed_journeys = db.query(Journey).filter(Journey.status == "COMPLETED").count()
    active_journeys = db.query(Journey).filter(Journey.status == "ACTIVE").count()
    total_alerts = db.query(SafetyAlert).count()
    sos_incidents = db.query(SafetyAlert).filter(SafetyAlert.alert_type == "SOS").count()
    average_safety_score = 0
    scores = db.scalars(select(SafetyScore.score)).all()
    if scores:
        average_safety_score = round(sum(scores) / len(scores), 2)
    battery_alerts = db.query(SafetyAlert).filter(SafetyAlert.alert_type.in_(["BATTERY_LOW", "BATTERY_CRITICAL"])) .count()
    route_deviations = db.query(SafetyAlert).filter(SafetyAlert.alert_type == "ROUTE_DEVIATION").count()
    missed_checkins = db.query(SafetyAlert).filter(SafetyAlert.alert_type == "MISSED_CHECKIN").count()
    offline_events = db.query(SafetyAlert).filter(SafetyAlert.alert_type == "DEVICE_OFFLINE").count()
    return success({
        "total_journeys": total_journeys,
        "completed_journeys": completed_journeys,
        "active_journeys": active_journeys,
        "total_alerts": total_alerts,
        "sos_incidents": sos_incidents,
        "average_safety_score": average_safety_score,
        "battery_alerts": battery_alerts,
        "route_deviations": route_deviations,
        "missed_checkins": missed_checkins,
        "offline_events": offline_events,
    })


@router.get("/api/guardian/users", summary="List users who authorized you as a guardian")
def guardian_users(db: Session = Depends(get_db), guardian: User = Depends(current_user)):
    contacts = db.scalars(
        select(TrustedContact).where(TrustedContact.is_active.is_(True), TrustedContact.guardian_authorized.is_(True),
                                     ((TrustedContact.email == guardian.email) | (TrustedContact.phone == guardian.phone)))
    ).all()
    result = []
    for contact in contacts:
        owner = db.get(User, contact.user_id)
        if owner:
            journey = shared_active_journey(db, owner)
            result.append({"user_id": owner.id, "name": owner.name, "active_shared_journey": journey is not None})
    return success(result)


@router.get("/api/guardian/{user_id}/journey", summary="View an authorized shared active journey")
def guardian_journey(user_id: int, db: Session = Depends(get_db), guardian: User = Depends(current_user)):
    owner = guardian_owner(db, guardian, user_id)
    journey = shared_active_journey(db, owner)
    if not journey:
        return success(None)
    check_missed_arrival(db, journey)
    db.commit()
    return success({"id": journey.id, "origin": journey.origin, "destination": journey.destination, "expected_arrival": journey.expected_arrival,
                    "status": journey.status, "safety_score": journey.safety_score, "started_at": journey.started_at})


@router.get("/api/guardian/{user_id}/alerts", summary="View alerts for an authorized guardian")
def guardian_alerts(user_id: int, db: Session = Depends(get_db), guardian: User = Depends(current_user)):
    guardian_owner(db, guardian, user_id)
    rows = db.scalars(select(SafetyAlert).where(SafetyAlert.user_id == user_id).order_by(SafetyAlert.created_at.desc())).all()
    return success([{"id": row.id, "type": row.alert_type, "message": row.message, "created_at": row.created_at, "resolved": row.resolved} for row in rows])


@router.get("/api/guardian/{user_id}/location", summary="View location only during an authorized shared journey")
def guardian_location(user_id: int, db: Session = Depends(get_db), guardian: User = Depends(current_user)):
    owner = guardian_owner(db, guardian, user_id)
    journey = shared_active_journey(db, owner)
    if not journey:
        fail(403, "Location is available only during an active journey shared with the trusted circle.")
    location = db.scalar(select(LocationUpdate).where(LocationUpdate.journey_id == journey.id).order_by(LocationUpdate.timestamp.desc()))
    if not location:
        return success(None)
    return success({"journey_id": journey.id, "latitude": location.latitude, "longitude": location.longitude,
                    "timestamp": location.timestamp, "accuracy": location.accuracy})


@router.get("/api/guardian/{user_id}/battery", summary="View battery only during an authorized shared journey")
def guardian_battery(user_id: int, db: Session = Depends(get_db), guardian: User = Depends(current_user)):
    owner = guardian_owner(db, guardian, user_id)
    journey = shared_active_journey(db, owner)
    if not journey or not journey.battery_guardian_enabled:
        fail(403, "Battery status is not shared for an active journey.")
    item = db.scalar(select(BatteryStatus).where(BatteryStatus.user_id == owner.id).order_by(BatteryStatus.timestamp.desc()))
    if not item:
        return success(None)
    return success({"battery_percentage": item.battery_percentage, "timestamp": item.timestamp,
                    "latitude": item.latitude, "longitude": item.longitude})


@router.get("/api/ai/safety-insight/{journey_id}", summary="Get explainable rule-based journey safety insight")
def ai_safety_insight(journey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    journey = db.get(Journey, journey_id)
    if journey is None or journey.user_id != user.id:
        fail(404, "Journey not found.")
    check_missed_arrival(db, journey)
    result = SafetyScoreService(db).calculate(journey)
    db.commit()
    return success({"risk_level": result["risk_level"], "score": result["score"], "reasons": result["reasons"],
                    "recommendation": result["recommendation"], "prototype": True,
                    "disclaimer": "Rule-based decision support only; this score does not predict crime or guarantee safety."})


@router.get("/api/journeys/{journey_id}/safety-score", summary="Calculate an explainable safety score")
def journey_safety_score(journey_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    journey = db.get(Journey, journey_id)
    if journey is None or journey.user_id != user.id:
        fail(404, "Journey not found.")
    result = SafetyScoreService(db).calculate(journey)
    journey.safety_score = result["score"]
    db.commit()
    return success(result)
