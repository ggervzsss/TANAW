import tempfile
import unittest
from contextlib import closing

from app.camera.camera_manager import CameraProcessingManager
from app.storage.local_schema import connect_local_database
from app.storage.runtime_store import EdgeRuntimeStore


class SessionCredentialRedactionTest(unittest.TestCase):
    def test_runtime_snapshot_is_redacted_before_atomic_ledger_persistence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = EdgeRuntimeStore(directory)
            store.save_session(_credential_bearing_session_payload())

            persisted = store.load_session()
            self.assertIsNotNone(persisted)
            assert persisted is not None
            camera_config = persisted["camera_config"]
            self.assertIsNone(camera_config["username"])
            self.assertIsNone(camera_config["password"])
            self.assertTrue(camera_config["username_redacted"])
            self.assertTrue(camera_config["password_redacted"])
            self.assertTrue(camera_config["stream_url_credentials_redacted"])
            with closing(connect_local_database(store._ledger._database_path)) as connection:
                snapshot_json = connection.execute(
                    "select snapshot_json from camera_runtime_state"
                ).fetchone()[0]
            self.assertNotIn("camera-user-secret", snapshot_json)
            self.assertNotIn("camera-password-secret", snapshot_json)

    def test_manager_restore_fails_closed_for_redacted_credential_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = EdgeRuntimeStore(directory)
            store.save_session(_credential_bearing_session_payload())
            manager = CameraProcessingManager(directory)

            restored = manager.restore_last_session()

            self.assertFalse(restored)


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
