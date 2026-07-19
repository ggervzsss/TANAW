import tempfile
import unittest
from pathlib import Path

from app.storage.local_metrics_store import LocalMetricsStore
from app.tools.local_data_cli import clear_local_data, inspect_local_data


class LocalDataCliTest(unittest.TestCase):
    def test_inspect_lists_scoped_ledger_counts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app_data_dir = Path(directory)
            store = LocalMetricsStore(str(app_data_dir), "enterprise@example.test")
            store.append_count_event(_event())
            store.append_count_event(_event())
            store.save_report_draft(
                "period:July 2026",
                "July 2026",
                {"demo": {"thisProvMale": "10"}},
            )

            result = inspect_local_data(app_data_dir, "enterprise@example.test", limit=5)

            ledger = result["ledgers"][0]
            self.assertTrue(ledger["exists"])
            self.assertEqual(ledger["tables"]["count_events"], 2)
            self.assertEqual(ledger["tables"]["report_drafts"], 1)
            self.assertEqual(ledger["currentDraftEvents"], 2)

    def test_clear_enterprise_does_not_remove_other_ledger_or_browser_storage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app_data_dir = Path(directory)
            first = LocalMetricsStore(str(app_data_dir), "first@example.test")
            second = LocalMetricsStore(str(app_data_dir), "second@example.test")
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

    def test_clear_all_ledgers_preserves_browser_storage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app_data_dir = Path(directory)
            store = LocalMetricsStore(str(app_data_dir), "enterprise@example.test")
            store.append_count_event(_event())
            store.save_report_draft(
                "period:July 2026",
                "July 2026",
                {"demo": {"thisProvMale": "10"}},
            )
            browser_file = app_data_dir / "Local Storage" / "leveldb" / "000001.log"
            browser_file.parent.mkdir(parents=True)
            browser_file.write_text("camera settings", encoding="utf-8")

            clear_local_data(app_data_dir, all_ledgers=True)

            self.assertFalse((app_data_dir / "ml-service" / "enterprises").exists())
            self.assertTrue(browser_file.exists())

    def test_full_device_removes_browser_and_ledgers(self) -> None:
        with tempfile.TemporaryDirectory() as parent:
            app_data_dir = Path(parent) / "desktop-tanaw"
            store = LocalMetricsStore(str(app_data_dir), "enterprise@example.test")
            store.append_count_event(_event())
            browser_file = app_data_dir / "Local Storage" / "leveldb" / "000001.log"
            browser_file.parent.mkdir(parents=True)
            browser_file.write_text("camera settings", encoding="utf-8")

            result = clear_local_data(app_data_dir, full_device=True)

            self.assertEqual(result["scope"], "full-device")
            self.assertFalse(app_data_dir.exists())


def _event() -> dict:
    return {
        "camera_id": 1,
        "camera_name": "Test Camera",
        "direction": "entry",
        "track_id": 1,
        "counts": {"entry": 1, "exit": 0, "occupancy": 1},
    }
