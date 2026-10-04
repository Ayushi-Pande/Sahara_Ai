from datetime import timedelta

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import BatteryStatus, Journey, LocationUpdate, NearbyHelp, TrustedContact, User, utcnow
from app.utils.auth import hash_password

DEMO_PASSWORD = "SaharaDemo123!"


def get_or_create_user(db, email, name, phone, password=DEMO_PASSWORD):
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(name=name, email=email, phone=phone, password_hash=hash_password(password))
        db.add(user)
        db.flush()
    return user


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        ayushi = get_or_create_user(db, "ayushi@sahara.demo", "Ayushi Pandey", "+919876543210")
        guardians = [
            ("Mom", "Mother", "+919876543211", "mom@sahara.demo"),
            ("Janhavi", "Friend", "+919876543212", "janhavi@sahara.demo"),
            ("Praveen", "Friend", "+919876543213", "praveen@sahara.demo"),
        ]
        for name, relation, phone, email in guardians:
            get_or_create_user(db, email, name, phone)
            exists = db.scalar(select(TrustedContact).where(TrustedContact.user_id == ayushi.id, TrustedContact.email == email))
            if exists is None:
                db.add(TrustedContact(user_id=ayushi.id, name=name, relationship_name=relation, phone=phone,
                                      email=email, priority=len(guardians), is_active=True, guardian_authorized=True))
        journey = db.scalar(select(Journey).where(Journey.user_id == ayushi.id, Journey.destination == "Home"))
        if journey is None:
            journey = Journey(user_id=ayushi.id, origin="SHEAT College", destination="Home",
                              expected_arrival=utcnow() + timedelta(hours=2), distance=12.4, eta=35,
                              safety_score=92, status="ACTIVE", started_at=utcnow(), share_with_circle=True)
            db.add(journey)
            db.flush()
        if db.scalar(select(LocationUpdate).where(LocationUpdate.journey_id == journey.id)) is None:
            db.add(LocationUpdate(user_id=ayushi.id, journey_id=journey.id, latitude=25.2620, longitude=82.9890,
                                  accuracy=12, battery=68, timestamp=utcnow()))
        if db.scalar(select(BatteryStatus).where(BatteryStatus.user_id == ayushi.id)) is None:
            db.add(BatteryStatus(user_id=ayushi.id, battery_percentage=68, latitude=25.2620, longitude=82.9890))
        help_locations = [
            ("SHEAT Campus Security", "SAFE_ZONE", 25.2630, 82.9880, "SHEAT College campus", "+915422500000"),
            ("Lanka Police Station", "POLICE", 25.2820, 82.9990, "Lanka, Varanasi", "112"),
            ("BHU Trauma Centre", "HOSPITAL", 25.2670, 82.9910, "BHU, Varanasi", "108"),
            ("Lanka Pharmacy", "PHARMACY", 25.2800, 82.9970, "Lanka Road, Varanasi", None),
            ("Lanka Bus Stop", "TRANSPORT", 25.2810, 82.9960, "Lanka, Varanasi", None),
            ("Emergency Services", "EMERGENCY", 25.2820, 82.9990, "Varanasi", "112"),
        ]
        for name, category, latitude, longitude, address, phone in help_locations:
            if db.scalar(select(NearbyHelp).where(NearbyHelp.name == name)) is None:
                db.add(NearbyHelp(name=name, category=category, latitude=latitude, longitude=longitude, address=address, phone=phone))
        db.commit()
        print("Demo data ready.")
        print("Demo user: ayushi@sahara.demo / SaharaDemo123!")
        print("Demo guardians: mom@sahara.demo, janhavi@sahara.demo, praveen@sahara.demo / SaharaDemo123!")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
