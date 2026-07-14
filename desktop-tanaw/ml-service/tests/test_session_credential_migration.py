import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from app.camera.camera_manager import CameraProcessingManager
from app.storage.local_schema import connect_local_database, initialize_local_database


class SessionCredentialMigrationTest(unittest.TestCase):
    def test_init_scrubs_legacy_json_and_sqlite_camera_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            legacy_payload = _legacy_session_payload()
            session_path = Path(directory) / "ml-service" / "active_session.json"
            session_path.parent.mkdir(parents=True)
            session_path.write_text(json.dumps(legacy_payload), encoding="utf-8")
            database_path = session_path.parent / "tanaw_metrics.sqlite3"
            with closing(sqlite3.connect(database_path)) as connection:
                connection.execute(
                    """
                    create table count_snapshots (
                        id integer primary key autoincrement,
                        recorded_at text not null,
                        camera_id integer,
                        camera_name text,
                        entry_count integer not null default 0,
                        exit_count integer not null default 0,
                        occupancy_count integer not null default 0,
                        running integer not null default 0,
                        status text,
                        error text,
                        payload_json text not null
                    )
                    """
                )
                connection.execute(
                    """
                    insert into count_snapshots (
                        recorded_at,
                        camera_id,
                        camera_name,
                        entry_count,
                        exit_count,
                        occupancy_count,
                        running,
                        status,
                        error,
                        payload_json
                    )
                    values (?, 1, 'Entrance', 5, 2, 3, 1, 'running', ?, ?)
                    """,
                    (
                        "2026-06-15T04:00:00+00:00",
                        legacy_payload["error"],
                        json.dumps(legacy_payload),
                    ),
                )
                connection.commit()

            initialize_local_database(database_path)

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

            with closing(connect_local_database(database_path)) as connection:
                state = connection.execute(
                    """
                    select state, running, entry_count, exit_count,
                           occupancy_count, error_summary
                    from camera_live_state
                    """
                ).fetchone()
                legacy_table = connection.execute(
                    """
                    select 1 from sqlite_master
                    where type = 'table' and name = 'count_snapshots'
                    """
                ).fetchone()
            self.assertEqual(tuple(state)[:5], ("running", 1, 5, 2, 3))
            self.assertNotIn("legacy-camera-user", str(state["error_summary"]))
            self.assertNotIn("legacy-camera-password", str(state["error_summary"]))
            self.assertIsNone(legacy_table)

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
