import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from app.camera.camera_manager import CameraProcessingManager
from app.storage.local_metrics_store import LocalMetricsStore
from app.storage.local_schema import connect_local_database, initialize_local_database


class SessionCredentialMigrationTest(unittest.TestCase):
    def test_init_scrubs_legacy_json_and_sqlite_camera_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            legacy_payload = _legacy_session_payload()
            store = LocalMetricsStore(directory)
            store.save_count_snapshot(
                legacy_payload,
                "2026-06-15T04:00:00+00:00",
            )
            session_path = Path(directory) / "ml-service" / "active_session.json"
            session_path.write_text(json.dumps(legacy_payload), encoding="utf-8")
            with closing(sqlite3.connect(store._database_path)) as connection:
                connection.execute("delete from local_schema_migrations where version = 4")
                connection.execute("pragma user_version = 3")
                connection.commit()

            initialize_local_database(store._database_path)

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
            self.assertNotIn("legacy-camera-user", persisted_text)
            self.assertNotIn("legacy-camera-password", persisted_text)

            with closing(connect_local_database(store._database_path)) as connection:
                snapshot = connection.execute(
                    "select error, payload_json from count_snapshots"
                ).fetchone()
            snapshot_text = str(snapshot["payload_json"])
            snapshot_payload = json.loads(snapshot_text)
            snapshot_config = snapshot_payload["camera_config"]
            self.assertIsNone(snapshot_config["username"])
            self.assertIsNone(snapshot_config["password"])
            self.assertTrue(snapshot_config["username_redacted"])
            self.assertTrue(snapshot_config["password_redacted"])
            self.assertTrue(snapshot_config["stream_url_credentials_redacted"])
            self.assertNotIn("legacy-camera-user", snapshot_text)
            self.assertNotIn("legacy-camera-password", snapshot_text)
            self.assertNotIn("legacy-camera-user", str(snapshot["error"]))
            self.assertNotIn("legacy-camera-password", str(snapshot["error"]))

    def test_restore_load_scrubs_credentials_written_after_store_initialization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = CameraProcessingManager(directory)
            session_path = Path(directory) / "ml-service" / "active_session.json"
            session_path.parent.mkdir(parents=True, exist_ok=True)
            session_path.write_text(
                json.dumps(_legacy_session_payload()),
                encoding="utf-8",
            )

            restored = manager.restore_last_session()

            self.assertFalse(restored)
            persisted_text = session_path.read_text(encoding="utf-8")
            self.assertNotIn("legacy-camera-user", persisted_text)
            self.assertNotIn("legacy-camera-password", persisted_text)
            self.assertIn('"username_redacted": true', persisted_text)
            self.assertIn('"password_redacted": true', persisted_text)


def _legacy_session_payload() -> dict:
    credential_url = "rtsp://legacy-camera-user:legacy-camera-password@camera.example.test/live"
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
            "username": "legacy-camera-user",
            "password": "legacy-camera-password",
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
