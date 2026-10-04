import json
import math
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    BatteryStatus,
    CommunityReport,
    Journey,
    JourneyCheckIn,
    LocationUpdate,
    Notification,
    SafetyAlert,
    SafetyScore,
    utcnow,
)


def distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    value = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def safety_score(db: Session, journey: Journey) -> dict:
    score = 100
    reasons: list[str] = []
    latest_battery = db.scalar(
        select(BatteryStatus).where(BatteryStatus.user_id == journey.user_id).order_by(BatteryStatus.timestamp.desc())
    )
    if latest_battery and latest_battery.battery_percentage < 20:
        score -= 18
        reasons.append("Battery below 20%")
    alerts = list(db.scalars(select(SafetyAlert).where(SafetyAlert.journey_id == journey.id, SafetyAlert.resolved.is_(False))))
    if any(alert.alert_type == "ROUTE_DEVIATION" for alert in alerts):
        score -= 22
        reasons.append("Route deviation detected")
    if any(alert.alert_type == "MISSED_CHECKIN" for alert in alerts):
        score -= 25
        reasons.append("A check-in may have been missed")
    latest_location = db.scalar(
        select(LocationUpdate).where(LocationUpdate.journey_id == journey.id).order_by(LocationUpdate.timestamp.desc())
    )
    if latest_location:
        reports = list(db.scalars(select(CommunityReport)))
        nearby_risk = any(
            report.type != "SAFE_AREA"
            and distance_meters(latest_location.latitude, latest_location.longitude, report.latitude, report.longitude) < 1000
            for report in reports
        )
        if nearby_risk:
            score -= 10
            reasons.append("Community safety reports are nearby")
    now_hour = utcnow().hour
    if now_hour >= 22 or now_hour < 5:
        score -= 5
        reasons.append("Journey is during late-night hours")
    score = max(0, min(100, score))
    risk_level = "LOW" if score >= 80 else "MEDIUM" if score >= 55 else "HIGH"
    recommendation = {
        "LOW": "No significant safety anomaly detected. Continue your journey and check in as planned.",
        "MEDIUM": "Share live location with trusted contacts and review your route.",
        "HIGH": "Contact a trusted person or emergency services if you feel unsafe.",
    }[risk_level]
    result = {
        "score": score,
        "risk_level": risk_level,
        "reasons": reasons,
        "factors": reasons,
        "recommendation": recommendation,
        "timestamp": utcnow().isoformat(),
    }
    db.add(SafetyScore(user_id=journey.user_id, journey_id=journey.id, score=score, risk_level=risk_level, reasons=json.dumps(reasons)))
    db.flush()
    return result


class SafetyMonitorService:
    def __init__(self, db: Session):
        self.db = db

    def assess(self, journey: Journey) -> str:
        latest_location = self.db.scalar(
            select(LocationUpdate).where(LocationUpdate.journey_id == journey.id).order_by(LocationUpdate.timestamp.desc())
        )
        latest_battery = self.db.scalar(
            select(BatteryStatus).where(BatteryStatus.user_id == journey.user_id).order_by(BatteryStatus.timestamp.desc())
        )
        alerts = self.db.scalars(select(SafetyAlert).where(SafetyAlert.journey_id == journey.id, SafetyAlert.resolved.is_(False))).all()
        if any(alert.alert_type in {"MISSED_CHECKIN", "ROUTE_DEVIATION"} for alert in alerts):
            return "HIGH"
        if latest_battery and latest_battery.battery_percentage <= 10:
            return "CRITICAL"
        if latest_battery and latest_battery.battery_percentage <= 20:
            return "MEDIUM"
        if latest_location is None and journey.status == "ACTIVE":
            return "MEDIUM"
        return "SAFE" if journey.status == "ACTIVE" else "LOW"


class JourneySafetyService:
    def __init__(self, db: Session):
        self.db = db

    def evaluate(self, journey: Journey) -> dict:
        monitor = SafetyMonitorService(self.db)
        status = monitor.assess(journey)
        score = safety_score(self.db, journey)
        return {"status": status, "score": score["score"], "risk_level": score["risk_level"], "reasons": score["reasons"]}


class SafetyScoreService:
    def __init__(self, db: Session):
        self.db = db

    def calculate(self, journey: Journey) -> dict:
        return safety_score(self.db, journey)


def record_alert(db: Session, user_id: int, journey_id: int | None, alert_type: str, message: str) -> SafetyAlert:
    alert = SafetyAlert(user_id=user_id, journey_id=journey_id, alert_type=alert_type, message=message)
    db.add(alert)
    db.add(Notification(user_id=user_id, notification_type=alert_type, message=message))
    return alert


def check_missed_arrival(db: Session, journey: Journey) -> bool:
    if journey.status != "ACTIVE" or not journey.expected_arrival:
        return False
    expected = journey.expected_arrival
    if expected.tzinfo is None:
        expected = expected.replace(tzinfo=timezone.utc)
    if expected > utcnow():
        return False
    existing = db.scalar(
        select(SafetyAlert).where(
            SafetyAlert.journey_id == journey.id,
            SafetyAlert.alert_type == "JOURNEY_NOT_COMPLETED",
            SafetyAlert.resolved.is_(False),
        )
    )
    if existing:
        return False
    latest_location = db.scalar(
        select(LocationUpdate).where(LocationUpdate.journey_id == journey.id).order_by(LocationUpdate.timestamp.desc())
    )
    latest_battery = db.scalar(
        select(BatteryStatus).where(BatteryStatus.user_id == journey.user_id).order_by(BatteryStatus.timestamp.desc())
    )
    message = (
        f"Journey expected arrival {expected.isoformat()} was missed. "
        f"Last location: {latest_location.latitude},{latest_location.longitude}. "
        if latest_location
        else f"Journey expected arrival {expected.isoformat()} was missed. Last location unavailable. "
    )
    message += f"Last battery: {latest_battery.battery_percentage}%." if latest_battery else "Last battery unavailable."
    record_alert(db, journey.user_id, journey.id, "JOURNEY_NOT_COMPLETED", message)
    return True
