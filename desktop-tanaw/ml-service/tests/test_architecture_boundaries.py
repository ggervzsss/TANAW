import unittest
from pathlib import Path

from app.camera.camera_manager import CameraProcessingManager

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class ArchitectureBoundariesTest(unittest.TestCase):
    def test_runtime_files_do_not_regress_into_unbounded_modules(self) -> None:
        limits = {
            "app/camera/camera_manager.py": 1600,
            "app/storage/local_data_store.py": 1150,
            "app/main.py": 350,
        }
        for relative_path, maximum_lines in limits.items():
            line_count = len((PROJECT_ROOT / relative_path).read_text(encoding="utf8").splitlines())
            self.assertLessEqual(
                line_count,
                maximum_lines,
                f"{relative_path} exceeded its decomposition boundary",
            )

    def test_camera_worker_has_no_reporting_workspace_responsibilities(self) -> None:
        reporting_methods = {
            "delete_report_draft",
            "get_report_draft",
            "list_report_submissions",
            "mark_report_synced",
            "purge_report_raw_events",
            "save_report_draft",
        }
        self.assertTrue(reporting_methods.isdisjoint(dir(CameraProcessingManager)))

    def test_local_data_facade_delegates_visitor_identity_storage(self) -> None:
        source = (PROJECT_ROOT / "app/storage/local_data_store.py").read_text(encoding="utf8")
        self.assertNotIn("insert into visitor_identities", source)
        self.assertNotIn("insert into visitor_sightings", source)

    def test_duplicate_state_tables_are_absent_from_the_canonical_schema(self) -> None:
        runtime_files = list((PROJECT_ROOT / "app").rglob("*.py"))
        runtime_source = "\n".join(path.read_text(encoding="utf8") for path in runtime_files)
        self.assertNotIn("active_monitoring_state", runtime_source)
        self.assertNotIn("count_snapshots", runtime_source)


if __name__ == "__main__":
    unittest.main()
