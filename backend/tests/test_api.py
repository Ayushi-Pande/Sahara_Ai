import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models import NearbyHelp, utcnow


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
        with cls.session_factory() as db:
            db.add(NearbyHelp(name="Test Safe Zone", category="SAFE_ZONE", latitude=25.0, longitude=83.0, address="Test address"))
            db.commit()
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        app.dependency_overrides.clear()
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
        expected_arrival = (utcnow() + timedelta(hours=2)).isoformat()
        journey_response = client.post("/api/journeys", headers=owner_headers, json={
            "origin": "Campus", "destination": "Home", "expected_arrival": expected_arrival, "share_with_circle": True
        })
        self.assertEqual(journey_response.status_code, 201, journey_response.text)
        journey_id = journey_response.json()["data"]["id"]
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

        sos_response = client.post("/api/sos", headers=owner_headers, json={"journey_id": journey_id, "trigger_type": "MANUAL"})
        self.assertEqual(sos_response.status_code, 201, sos_response.text)
        incident_id = sos_response.json()["data"]["incident_id"]
        self.assertEqual(sos_response.json()["data"]["contacts_notified"], 1)
        self.assertEqual(client.get(f"/api/sos/{incident_id}", headers=owner_headers).status_code, 200)
        self.assertEqual(client.post(f"/api/sos/{incident_id}/safe", headers=owner_headers).json()["data"]["status"], "SAFE")

        evidence = client.post("/api/evidence/upload", headers=owner_headers, data={"type": "photo", "description": "test image"},
                               files={"file": ("proof.png", b"not-a-real-image-but-upload-fixture", "image/png")})
        self.assertEqual(evidence.status_code, 201, evidence.text)
        evidence_id = evidence.json()["data"]["id"]
        self.assertEqual(client.get(f"/api/evidence/{evidence_id}", headers=owner_headers).status_code, 200)
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


if __name__ == "__main__":
    unittest.main()