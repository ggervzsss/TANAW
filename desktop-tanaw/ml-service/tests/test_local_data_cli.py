import tempfile
import unittest
from pathlib import Path

from app.storage.local_ledger import LocalLedger
from app.tools.local_data_cli import clear_local_data, inspect_local_data


class LocalDataCliTest(unittest.TestCase):
    def test_inspect_lists_scoped_ledger_counts_and_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app_data_dir = Path(directory)
            store = LocalLedger(str(app_data_dir), "enterprise@example.test")
            store.append_count_event(_event("real", None))
            store.append_count_event(_event("mock", "run-1"))
            forbidden_file = store._database_path.parent / "events.jsonl"
            forbidden_file.write_text("legacy duplicate", encoding="utf-8")
            legacy_session = store._database_path.parent / "active_session.json"
            legacy_session.write_text("{}", encoding="utf-8")

            result = inspect_local_data(app_data_dir, "enterprise@example.test", limit=5)

            ledger = result["ledgers"][0]
            self.assertTrue(ledger["exists"])
            self.assertEqual(ledger["tables"]["count_events"], 2)
            self.assertEqual(ledger["currentDraftEvents"], 2)
            self.assertEqual(
                ledger["forbiddenDiskArtifacts"],
                ["active_session.json", "events.jsonl"],
            )
            self.assertEqual(
                {
                    (row["sourceKind"], row["mockRunId"], row["count"])
                    for row in ledger["eventProvenance"]
                },
                {("real", None, 1), ("mock", "run-1", 1)},
            )

    def test_clear_enterprise_does_not_remove_other_ledger_or_browser_storage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app_data_dir = Path(directory)
            first = LocalLedger(str(app_data_dir), "first@example.test")
            second = LocalLedger(str(app_data_dir), "second@example.test")
            first.append_count_event(_event("real", None))
            second.append_count_event(_event("real", None))
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
            store = LocalLedger(str(app_data_dir), "enterprise@example.test")
            store.append_count_event(_event("real", None))
            browser_file = app_data_dir / "Local Storage" / "leveldb" / "000001.log"
            browser_file.parent.mkdir(parents=True)
            browser_file.write_text("camera settings", encoding="utf-8")

            clear_local_data(app_data_dir, all_ledgers=True)

            self.assertFalse((app_data_dir / "ml-service" / "enterprises").exists())
            self.assertTrue(browser_file.exists())

    def test_full_device_removes_browser_and_ledgers(self) -> None:
        with tempfile.TemporaryDirectory() as parent:
            app_data_dir = Path(parent) / "desktop-tanaw"
            store = LocalLedger(str(app_data_dir), "enterprise@example.test")
            store.append_count_event(_event("real", None))
            browser_file = app_data_dir / "Local Storage" / "leveldb" / "000001.log"
            browser_file.parent.mkdir(parents=True)
            browser_file.write_text("camera settings", encoding="utf-8")

            result = clear_local_data(app_data_dir, full_device=True)

            self.assertEqual(result["scope"], "full-device")
            self.assertFalse(app_data_dir.exists())


def _event(source_kind: str, mock_run_id: str | None) -> dict:
    return {
        "camera_id": 1,
        "camera_name": "Test Camera",
        "direction": "entry",
        "track_id": 1,
        "counts": {"entry": 1, "exit": 0, "occupancy": 1},
        "source_kind": source_kind,
        "mock_run_id": mock_run_id,
    }
