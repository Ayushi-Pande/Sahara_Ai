import os
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.database import (
    Base,
    Settings,
    get_db,
    is_supabase_database_url,
    sqlalchemy_database_url,
    verify_database_connection,
)
from app.main import app, lifespan
from app.models import Journey, NearbyHelp, SafetyAlert, SafetyScore, utcnow


class DatabaseURLTests(unittest.TestCase):
    def test_postgresql_urls_use_psycopg_driver(self):
        self.assertEqual(
            sqlalchemy_database_url("postgres://user:password@host/database"),
            "postgresql+psycopg://user:password@host/database",
        )
        self.assertEqual(
            sqlalchemy_database_url("postgresql://user:password@host/database"),
            "postgresql+psycopg://user:password@host/database",
        )
        self.assertEqual(
            sqlalchemy_database_url("postgresql+psycopg://user:password@host/database"),
            "postgresql+psycopg://user:password@host/database",
        )
        self.assertEqual(sqlalchemy_database_url("sqlite:///./sahara.db"), "sqlite:///./sahara.db")

    def test_database_url_is_loaded_from_environment(self):
        database_url = "postgresql://database-host/sahara"
        with patch.dict("os.environ", {"DATABASE_URL": database_url}):
            settings = Settings(_env_file=None)
        self.assertEqual(settings.database_url, database_url)

    def test_postgresql_url_parser_selects_psycopg_driver(self):
        for url in (
            "postgres://database-host/sahara",
            "postgresql://database-host/sahara",
        ):
            with self.subTest(url=url):
                parsed_url = make_url(sqlalchemy_database_url(url))
                self.assertEqual(parsed_url.drivername, "postgresql+psycopg")

    def test_supabase_database_url_detection_does_not_require_credentials(self):
        self.assertTrue(is_supabase_database_url("postgresql://db.example.supabase.co/sahara"))
        self.assertTrue(is_supabase_database_url("postgresql://aws-0-region.pooler.supabase.com/sahara"))
        self.assertFalse(is_supabase_database_url("postgresql://database.example.test/sahara"))
        self.assertFalse(is_supabase_database_url("sqlite:///./sahara.db"))

    def test_database_connection_probe_uses_configured_engine(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            test_engine = create_engine(f"sqlite:///{(Path(temporary_directory) / 'probe.db').as_posix()}")
            try:
                verify_database_connection(test_engine)
            finally:
                test_engine.dispose()


@unittest.skipUnless(
    os.environ.get("TEST_POSTGRESQL_DATABASE_URL"),
    "Set TEST_POSTGRESQL_DATABASE_URL to run the read-only PostgreSQL integration test.",
)
class PostgreSQLIntegrationTests(unittest.TestCase):
    def test_configured_postgresql_database_accepts_read_only_probe(self):
        database_url = sqlalchemy_database_url(os.environ["TEST_POSTGRESQL_DATABASE_URL"])
        if make_url(database_url).get_backend_name() != "postgresql":
            self.fail("TEST_POSTGRESQL_DATABASE_URL must use a PostgreSQL URL.")
        test_engine = create_engine(database_url, pool_pre_ping=True, hide_parameters=True)
        try:
            verify_database_connection(test_engine)
        finally:
            test_engine.dispose()


class DatabaseStartupTests(unittest.IsolatedAsyncioTestCase):
    async def test_database_connection_failure_aborts_startup(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            missing_parent = Path(temporary_directory) / "missing" / "database.db"
            unavailable_engine = create_engine(
                f"sqlite:///{missing_parent.as_posix()}",
                connect_args={"check_same_thread": False},
            )
            try:
                with patch("app.main.engine", unavailable_engine):
                    with self.assertRaises(OperationalError):
                        async with lifespan(app):
                            self.fail("Application startup continued without a working database.")
            finally:
                unavailable_engine.dispose()

    async def test_sqlite_startup_initializes_schema_on_isolated_database(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "startup.db"
            test_engine = create_engine(
                f"sqlite:///{database_path.as_posix()}",
                connect_args={"check_same_thread": False},
            )
            test_session_factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
            try:
                with patch("app.main.engine", test_engine), patch("app.main.SessionLocal", test_session_factory):
                    async with lifespan(app):
                        self.assertIn("users", inspect(test_engine).get_table_names())
                        self.assertIn("journeys", inspect(test_engine).get_table_names())
            finally:
                test_engine.dispose()


class DatabaseMigrationTests(unittest.TestCase):
    def run_migrations(self, connection):
        config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
        config.attributes["connection"] = connection
        command.upgrade(config, "head")

    def test_migration_creates_schema_in_an_empty_database(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "fresh.db"
            test_engine = create_engine(f"sqlite:///{database_path.as_posix()}")
            try:
                with test_engine.begin() as connection:
                    self.run_migrations(connection)
                inspector = inspect(test_engine)
                self.assertIn("users", inspector.get_table_names())
                self.assertIn("journeys", inspector.get_table_names())
                self.assertIn("alembic_version", inspector.get_table_names())
            finally:
                test_engine.dispose()

    def test_migration_refuses_existing_unversioned_schema_without_deleting_data(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            database_path = Path(temporary_directory) / "existing.db"
            test_engine = create_engine(f"sqlite:///{database_path.as_posix()}")
            try:
                Base.metadata.create_all(bind=test_engine)
                with test_engine.begin() as connection:
                    connection.execute(
                        text(
                            "INSERT INTO nearby_help "
                            "(name, category, latitude, longitude, address, phone) "
                            "VALUES ('Existing location', 'SAFE_ZONE', 25.0, 83.0, 'Existing address', NULL)"
                        )
                    )
                    with self.assertRaisesRegex(RuntimeError, "Refusing to initialize"):
                        self.run_migrations(connection)
                    preserved = connection.execute(
                        text("SELECT name FROM nearby_help WHERE name = 'Existing location'")
                    ).scalar_one()
                self.assertEqual(preserved, "Existing location")
                self.assertNotIn("alembic_version", inspect(test_engine).get_table_names())
            finally:
                test_engine.dispose()


class BackendWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(cls.temp_dir.name) / "test.db"
        cls.engine = create_engine(f"sqlite:///{database_path.as_posix()}", connect_args={"check_same_thread": False})
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False, autocommit=False)
        Base.metadata.create_all(bind=cls.engine)

        def override_get_db():
            db = cls.session_factory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.engine_patch = patch("app.main.engine", cls.engine)
        cls.session_patch = patch("app.main.SessionLocal", cls.session_factory)
        cls.engine_patch.start()
        cls.session_patch.start()
        with cls.session_factory() as db:
            db.add(NearbyHelp(name="Test Safe Zone", category="SAFE_ZONE", latitude=25.0, longitude=83.0, address="Test address"))
            db.commit()
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        app.dependency_overrides.clear()
        cls.session_patch.stop()
        cls.engine_patch.stop()
        cls.engine.dispose()
        cls.temp_dir.cleanup()

    def test_system_and_device_endpoints(self):
        client = self.client
        signup = client.post("/api/auth/signup", json={
            "name": "Device User", "email": "device@example.com", "password": "DevicePass123", "phone": "+15550000010"
        })
        self.assertEqual(signup.status_code, 201, signup.text)
        token = signup.json()["data"]["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        system = client.get("/api/system/status")
        self.assertEqual(system.status_code, 200, system.text)
        self.assertEqual(system.json()["data"]["database"], "ok")
        self.assertEqual(system.json()["data"]["supabase"], "not-integrated")
        self.assertEqual(system.json()["data"]["realtime"], "not-integrated")

        device = client.post("/api/devices", headers=headers, json={
            "device_type": "PHONE",
            "device_name": "Test Phone",
            "device_id": "device-001",
            "platform": "ios",
            "push_token": "demo-token"
        })
        self.assertEqual(device.status_code, 201, device.text)
        devices = client.get("/api/devices", headers=headers)
        self.assertEqual(devices.status_code, 200, devices.text)
        self.assertTrue(devices.json()["data"])
        device_id = devices.json()["data"][0]["id"]
        self.assertEqual(client.get(f"/api/devices/{device_id}", headers=headers).status_code, 200)
        self.assertEqual(client.get("/api/devices/status", headers=headers).status_code, 200)

    def test_local_frontend_origins_are_allowed_by_cors(self):
        for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
            with self.subTest(origin=origin):
                response = self.client.options(
                    "/health",
                    headers={
                        "Origin": origin,
                        "Access-Control-Request-Method": "GET",
                    },
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers.get("access-control-allow-origin"), origin)

    def test_authenticated_profile_and_session_contracts(self):
        client = self.client
        signup = client.post("/api/auth/signup", json={
            "name": "Profile Contract", "email": "profile-contract@example.com", "password": "ProfilePass123"
        })
        self.assertEqual(signup.status_code, 201, signup.text)
        first_token = signup.json()["data"]["access_token"]
        first_headers = {"Authorization": f"Bearer {first_token}"}

        self.assertEqual(client.get("/api/users/me").status_code, 401)
        updated = client.put("/api/users/me", headers=first_headers, json={
            "name": "Updated Profile", "blood_group": "O+", "preferred_language": "English"
        })
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["data"]["name"], "Updated Profile")
        self.assertEqual(updated.json()["data"]["blood_group"], "O+")

        login = client.post("/api/auth/login", json={
            "email": "profile-contract@example.com", "password": "ProfilePass123"
        })
        self.assertEqual(login.status_code, 200, login.text)
        second_headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}
        self.assertEqual(client.post("/api/auth/logout", headers=first_headers).status_code, 200)
        self.assertEqual(client.get("/api/users/me", headers=first_headers).status_code, 401)
        self.assertEqual(client.get("/api/users/me", headers=second_headers).status_code, 200)

    def test_analytics_endpoint_is_available_and_scoped_to_the_signed_in_user(self):
        client = self.client
        first = client.post("/api/auth/signup", json={
            "name": "Analytics Owner", "email": "analytics-owner@example.com", "password": "AnalyticsPass123"
        })
        second = client.post("/api/auth/signup", json={
            "name": "Analytics Other", "email": "analytics-other@example.com", "password": "AnalyticsPass123"
        })
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(second.status_code, 201, second.text)
        first_user_id = first.json()["data"]["user"]["id"]
        second_user_id = second.json()["data"]["user"]["id"]
        with self.session_factory() as db:
            first_journey = Journey(user_id=first_user_id, origin="Campus", destination="Home")
            second_journey = Journey(user_id=second_user_id, origin="Station", destination="Home")
            db.add_all([first_journey, second_journey])
            db.flush()
            db.add_all([
                SafetyAlert(user_id=first_user_id, journey_id=first_journey.id, alert_type="SOS", message="Owner alert"),
                SafetyAlert(user_id=second_user_id, journey_id=second_journey.id, alert_type="SOS", message="Other alert"),
                SafetyScore(user_id=first_user_id, journey_id=first_journey.id, score=84, risk_level="LOW"),
                SafetyScore(user_id=second_user_id, journey_id=second_journey.id, score=12, risk_level="HIGH"),
            ])
            db.commit()
        headers = {"Authorization": f"Bearer {first.json()['data']['access_token']}"}
        response = client.get("/api/analytics/dashboard", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(data["total_journeys"], 1)
        self.assertEqual(data["total_alerts"], 1)
        self.assertEqual(data["sos_incidents"], 1)
        self.assertEqual(data["average_safety_score"], 84)

    def test_end_to_end_safety_workflows(self):
        client = self.client
        self.assertEqual(client.get("/health").json()["status"], "ok")
        self.assertEqual(client.get("/api").json()["data"]["docs"], "/docs")

        guardian_signup = client.post("/api/auth/signup", json={
            "name": "Demo Guardian", "email": "guardian@example.com", "password": "GuardianPass123", "phone": "+15550000001"
        })
        self.assertEqual(guardian_signup.status_code, 201, guardian_signup.text)
        guardian_token = guardian_signup.json()["data"]["access_token"]
        guardian_headers = {"Authorization": f"Bearer {guardian_token}"}

        owner_signup = client.post("/api/auth/signup", json={
            "name": "Test Owner", "email": "owner@example.com", "password": "OwnerPass123", "phone": "+15550000002"
        })
        self.assertEqual(owner_signup.status_code, 201, owner_signup.text)
        owner_token = owner_signup.json()["data"]["access_token"]
        owner_headers = {"Authorization": f"Bearer {owner_token}"}
        self.assertEqual(client.post("/api/auth/login", json={"email": "owner@example.com", "password": "OwnerPass123"}).status_code, 200)

        contact = client.post("/api/contacts", headers=owner_headers, json={
            "name": "Guardian", "relationship": "Friend", "phone": "+15550000001", "email": "guardian@example.com"
        })
        self.assertEqual(contact.status_code, 201, contact.text)
        contact_id = contact.json()["data"]["id"]
        updated_contact = client.put(f"/api/contacts/{contact_id}", headers=owner_headers, json={
            "name": "Guardian", "relationship": "Family", "phone": "+15550000001", "email": "guardian@example.com"
        })
        self.assertEqual(updated_contact.status_code, 200, updated_contact.text)
        self.assertEqual(updated_contact.json()["data"]["relationship"], "Family")
        expected_arrival = (utcnow() + timedelta(hours=2)).isoformat()
        journey_response = client.post("/api/journeys", headers=owner_headers, json={
            "origin": "Campus", "destination": "Home", "expected_arrival": expected_arrival, "share_with_circle": True
        })
        self.assertEqual(journey_response.status_code, 201, journey_response.text)
        journey_id = journey_response.json()["data"]["id"]
        self.assertEqual(client.get(f"/api/journeys/{journey_id}", headers=owner_headers).status_code, 200)
        self.assertEqual(len(client.get("/api/journeys", headers=owner_headers).json()["data"]), 1)
        self.assertEqual(client.post(f"/api/journeys/{journey_id}/start", headers=owner_headers).status_code, 200)
        location_response = client.post(f"/api/journeys/{journey_id}/location", headers=owner_headers, json={
            "latitude": 25.0, "longitude": 83.0, "accuracy": 8, "battery": 68
        })
        self.assertEqual(location_response.status_code, 201, location_response.text)
        share = client.post("/api/voice/command", headers=owner_headers, json={"command": "share my location"})
        self.assertIn("shared with 1", share.json()["data"]["response"])
        deviation = client.post(f"/api/journeys/{journey_id}/route-check", headers=owner_headers, json={"latitude": 25.02, "longitude": 83.0})
        self.assertTrue(deviation.json()["data"]["deviation"])
        self.assertEqual(client.post(f"/api/journeys/{journey_id}/check-in", headers=owner_headers, json={"status": "SAFE"}).status_code, 200)

        battery = client.post("/api/battery/update", headers=owner_headers, json={"battery_percentage": 15, "latitude": 25.0, "longitude": 83.0})
        self.assertEqual(battery.status_code, 201, battery.text)
        self.assertEqual(client.get("/api/battery/latest", headers=owner_headers).json()["data"]["battery_percentage"], 15)
        self.assertEqual(client.post("/api/voice/command", headers=owner_headers, json={"command": "I need help"}).json()["data"]["intent"], "SOS")

        pins = client.post("/api/security/duress-pin", headers=owner_headers, json={"pin": "1234", "duress_pin": "9876"})
        self.assertEqual(pins.status_code, 200, pins.text)
        duress = client.post("/api/security/verify-pin", headers=owner_headers, json={"pin": "9876"})
        self.assertTrue(duress.json()["data"]["is_duress"])
        self.assertEqual(duress.json()["data"]["action"], "ACTIVATE_EMERGENCY")
        self.assertTrue(duress.json()["data"]["incident_id"])

        watch = client.post("/api/watch/sos", headers=owner_headers, json={"device_id": "DEMO-WATCH-001", "latitude": 25.0, "longitude": 83.0})
        self.assertEqual(watch.status_code, 201, watch.text)
        self.assertEqual(watch.json()["data"]["trigger_type"], "SMARTWATCH")
        self.assertTrue(client.get("/api/watch/status", headers=owner_headers).json()["data"]["connected"])

        self.assertEqual(client.post("/api/sos", json={"trigger_type": "MANUAL"}).status_code, 401)
        sos_response = client.post("/api/sos", headers=owner_headers, json={
            "journey_id": journey_id, "trigger_type": "MANUAL", "latitude": 25.0, "longitude": 83.0
        })
        self.assertEqual(sos_response.status_code, 201, sos_response.text)
        incident_id = sos_response.json()["data"]["incident_id"]
        self.assertEqual(sos_response.json()["data"]["contacts_notified"], 1)
        self.assertIn("does not send SMS or place calls", sos_response.json()["data"]["notification_note"])
        self.assertEqual(client.get(f"/api/sos/{incident_id}", headers=owner_headers).status_code, 200)
        self.assertEqual(client.post(f"/api/sos/{incident_id}/safe", headers=owner_headers).json()["data"]["status"], "SAFE")

        invalid_evidence = client.post("/api/evidence/upload", headers=owner_headers, data={"type": "photo"},
                                       files={"file": ("proof.png", b"fixture", "application/pdf")})
        self.assertEqual(invalid_evidence.status_code, 415, invalid_evidence.text)
        evidence = client.post("/api/evidence/upload", headers=owner_headers, data={"type": "photo", "description": "test image"},
                               files={"file": ("proof.png", b"not-a-real-image-but-upload-fixture", "image/png")})
        self.assertEqual(evidence.status_code, 201, evidence.text)
        evidence_id = evidence.json()["data"]["id"]
        self.assertEqual(client.get(f"/api/evidence/{evidence_id}", headers=owner_headers).status_code, 200)
        self.assertEqual(client.get(f"/api/evidence/{evidence_id}", headers=guardian_headers).status_code, 404)
        download = client.get(f"/api/evidence/{evidence_id}/download", headers=owner_headers)
        self.assertEqual(download.status_code, 200, download.text)
        self.assertEqual(download.content, b"not-a-real-image-but-upload-fixture")
        self.assertEqual(client.delete(f"/api/evidence/{evidence_id}", headers=owner_headers).status_code, 200)

        guardian_users = client.get("/api/guardian/users", headers=guardian_headers)
        self.assertEqual(guardian_users.status_code, 200, guardian_users.text)
        self.assertTrue(any(item["user_id"] == owner_signup.json()["data"]["user"]["id"] for item in guardian_users.json()["data"]))
        self.assertEqual(client.get(f"/api/guardian/{owner_signup.json()['data']['user']['id']}/location", headers=guardian_headers).status_code, 200)
        self.assertEqual(client.get("/api/help/nearby?latitude=25&longitude=83", headers=owner_headers).status_code, 200)

        report = client.post("/api/community/reports", headers=owner_headers, json={
            "latitude": 25.0, "longitude": 83.0, "type": "POOR_LIGHTING", "description": "Dim street", "severity": 2
        })
        self.assertEqual(report.status_code, 201, report.text)
        public_reports = client.get("/api/community/reports").json()["data"]
        self.assertNotIn("user_id", public_reports[0])
        insight = client.get(f"/api/ai/safety-insight/{journey_id}", headers=owner_headers)
        self.assertEqual(insight.status_code, 200, insight.text)
        self.assertTrue(insight.json()["data"]["prototype"])

        invalid_guardian = client.post("/api/auth/signup", json={
            "name": "Stranger", "email": "stranger@example.com", "password": "StrangerPass123", "phone": "+15550000003"
        }).json()["data"]["access_token"]
        forbidden = client.get(f"/api/guardian/{owner_signup.json()['data']['user']['id']}/location",
                               headers={"Authorization": f"Bearer {invalid_guardian}"})
        self.assertEqual(forbidden.status_code, 403)
        self.assertEqual(client.post(f"/api/journeys/{journey_id}/end", headers=owner_headers).json()["data"]["status"], "COMPLETED")
        self.assertEqual(client.get("/api/contacts", headers=owner_headers).json()["data"][0]["relationship"], "Family")
        self.assertEqual(client.delete(f"/api/contacts/{contact_id}", headers=owner_headers).status_code, 200)


if __name__ == "__main__":
    unittest.main()