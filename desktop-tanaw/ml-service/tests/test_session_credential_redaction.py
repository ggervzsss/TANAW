import json
import tempfile
import unittest
from pathlib import Path

from app.camera.camera_manager import CameraProcessingManager


class SessionCredentialRedactionTest(unittest.TestCase):
    def test_init_scrubs_credentials_from_untrusted_session_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            secret_payload = _credential_bearing_session_payload()
            session_path = Path(directory) / "ml-service" / "active_session.json"
            session_path.parent.mkdir(parents=True)
            session_path.write_text(json.dumps(secret_payload), encoding="utf-8")

            manager = CameraProcessingManager(directory)

            self.assertFalse(manager.restore_last_session())
            persisted_text = session_path.read_text(encoding="utf-8")
            persisted = json.loads(persisted_text)
            camera_config = persisted["camera_config"]
            self.assertIsNone(camera_config["username"])
            self.assertIsNone(camera_config["password"])
            self.assertTrue(camera_config["username_redacted"])
            self.assertTrue(camera_config["password_redacted"])
            self.assertTrue(camera_config["stream_url_credentials_redacted"])
            self.assertNotIn("camera-user-secret", persisted_text)
            self.assertNotIn("camera-password-secret", persisted_text)

    def test_restore_load_scrubs_credentials_written_after_store_initialization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = CameraProcessingManager(directory)
            session_path = Path(directory) / "ml-service" / "active_session.json"
            session_path.parent.mkdir(parents=True, exist_ok=True)
            session_path.write_text(
                json.dumps(_credential_bearing_session_payload()),
                encoding="utf-8",
            )

            restored = manager.restore_last_session()

            self.assertFalse(restored)
            persisted_text = session_path.read_text(encoding="utf-8")
            self.assertNotIn("camera-user-secret", persisted_text)
            self.assertNotIn("camera-password-secret", persisted_text)
            self.assertIn('"username_redacted": true', persisted_text)
            self.assertIn('"password_redacted": true', persisted_text)


def _credential_bearing_session_payload() -> dict:
    credential_url = "rtsp://camera-user-secret:camera-password-secret@camera.example.test/live"
    return {
        "running": True,
        "status": "running",
        "error": f"Last connected to {credential_url}",
        "camera_id": 1,
        "camera_name": "Entrance",
        "camera_config": {
            "stream_url": credential_url,
            "camera_id": 1,
            "camera_name": "Entrance",
            "camera_type": "RTSP_CCTV",
            "username": "camera-user-secret",
            "password": "camera-password-secret",
        },
        "counts": {
            "entry": 5,
            "exit": 2,
            "occupancy": 3,
            "running": True,
            "status": "running",
            "error": f"Retrying {credential_url}",
        },
    }
