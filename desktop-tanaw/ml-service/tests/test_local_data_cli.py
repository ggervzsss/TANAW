import tempfile
import unittest
from pathlib import Path

from app.storage.local_data_schema import LOCAL_SCHEMA_VERSION
from app.storage.local_data_store import LocalDataStore
from app.tools.local_data_cli import clear_local_data, inspect_local_data


class LocalDataCliTest(unittest.TestCase):
    def test_inspect_lists_scoped_ledger_counts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app_data_dir = Path(directory)
            store = LocalDataStore(str(app_data_dir), "enterprise@example.test")
            store.append_count_event(_event())
            store.append_count_event(_event())
            store.save_report_draft(
                "period:July 2026",
                "July 2026",
                {"demo": {"thisProvMale": "10"}},
            )
            store.replace_camera_profiles([_camera_profile()])

            result = inspect_local_data(app_data_dir, "enterprise@example.test", limit=5)

            ledger = result["ledgers"][0]
            self.assertTrue(ledger["exists"])
            self.assertEqual(ledger["tables"]["count_events"], 2)
            self.assertEqual(ledger["tables"]["report_drafts"], 1)
            self.assertEqual(ledger["tables"]["camera_profiles"], 1)
            self.assertEqual(ledger["schemaVersion"], LOCAL_SCHEMA_VERSION)
            self.assertEqual(ledger["currentDraftEvents"], 2)

    def test_clear_enterprise_does_not_remove_other_ledger_or_browser_storage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app_data_dir = Path(directory)
            first = LocalDataStore(str(app_data_dir), "first@example.test")
            second = LocalDataStore(str(app_data_dir), "second@example.test")
            first.append_count_event(_event())
            second.append_count_event(_event())
            browser_file = app_data_dir / "Local Storage" / "leveldb" / "000001.log"
            browser_file.parent.mkdir(parents=True)
            browser_file.write_text("camera settings", encoding="utf-8")

            result = clear_local_data(app_data_dir, enterprise_id="first@example.test")

            self.assertEqual(result["scope"], "enterprise")
            self.assertFalse(Path(result["path"]).exists())
            self.assertTrue(second._database_path.exists())
            self.assertTrue(browser_file.exists())

    def test_clear_all_ledgers_preserves_camera_profiles_and_browser_storage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app_data_dir = Path(directory)
            store = LocalDataStore(str(app_data_dir), "enterprise@example.test")
            store.append_count_event(_event())
            store.save_report_draft(
                "period:July 2026",
                "July 2026",
                {"demo": {"thisProvMale": "10"}},
            )
            store.replace_camera_profiles([_camera_profile()])
            retired_database = app_data_dir / "ml-service" / "tanaw_metrics.sqlite3"
            retired_database.parent.mkdir(parents=True, exist_ok=True)
            retired_database.write_bytes(b"retired")
            retired_session = store._database_path.parent / "active_session.json"
            retired_session.write_text("{}", encoding="utf-8")
            browser_file = app_data_dir / "Local Storage" / "leveldb" / "000001.log"
            browser_file.parent.mkdir(parents=True)
            browser_file.write_text("camera settings", encoding="utf-8")

            result = clear_local_data(app_data_dir, all_ledgers=True)

            self.assertTrue((app_data_dir / "ml-service" / "enterprises").exists())
            self.assertEqual(store.list_camera_profiles(), [_camera_profile()])
            self.assertEqual(store.metrics_summary()["total_events"], 0)
            self.assertIsNone(store.get_report_draft("period:July 2026"))
            self.assertFalse(retired_database.exists())
            self.assertFalse(retired_session.exists())
            self.assertEqual(len(result["retiredPathsRemoved"]), 2)
            self.assertTrue(browser_file.exists())

    def test_full_device_removes_browser_and_ledgers(self) -> None:
        with tempfile.TemporaryDirectory() as parent:
            app_data_dir = Path(parent) / "desktop-tanaw"
            store = LocalDataStore(str(app_data_dir), "enterprise@example.test")
            store.append_count_event(_event())
            persistent_files = (
                app_data_dir / "Local Storage" / "leveldb" / "000001.log",
                app_data_dir / "IndexedDB" / "app.indexeddb.leveldb" / "000001.log",
                app_data_dir / "Session Storage" / "000001.log",
                app_data_dir / "Network" / "Cookies",
                app_data_dir / "Cache" / "cache.data",
                app_data_dir / "camera-credentials.json",
                app_data_dir / "auth-session.json",
                app_data_dir / ".hidden-state",
            )
            for persistent_file in persistent_files:
                persistent_file.parent.mkdir(parents=True, exist_ok=True)
                persistent_file.write_text("persisted desktop data", encoding="utf-8")

            result = clear_local_data(app_data_dir, full_device=True)

            self.assertEqual(result["scope"], "full-device")
            self.assertTrue(result["existed"])
            self.assertFalse(app_data_dir.exists())

            repeated_result = clear_local_data(app_data_dir, full_device=True)
            self.assertFalse(repeated_result["existed"])
            self.assertFalse(app_data_dir.exists())


def _event() -> dict:
    return {
        "camera_id": 1,
        "camera_name": "Test Camera",
        "direction": "entry",
        "track_id": 1,
        "counts": {"entry": 1, "exit": 0, "occupancy": 1},
    }


def _camera_profile() -> dict:
    return {
        "id": 1,
        "name": "Test Camera",
        "status": "untested",
        "zone": "Entrance",
        "rtsp": "rtsp://192.168.1.20/stream1",
        "cameraHost": "192.168.1.20",
        "rtspStream": "stream1",
        "processingProfile": "auto",
        "confidence": 0.35,
        "trackingConfidence": 0.15,
        "reidMode": "auto",
        "uniqueCountingMode": "estimated_reid",
        "config": {
            "tripwire": 50,
            "tripwires": {
                "entry": {"start": {"x": 0.4, "y": 0}, "end": {"x": 0.4, "y": 1}},
                "exit": {"start": {"x": 0.6, "y": 0}, "end": {"x": 0.6, "y": 1}},
            },
            "roi": {"top": 0, "left": 0, "width": 100, "height": 100},
            "reverse": False,
        },
    }
