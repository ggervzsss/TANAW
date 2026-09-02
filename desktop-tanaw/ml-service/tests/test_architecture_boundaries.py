import ast
import unittest
from pathlib import Path

from app.camera.camera_manager import CameraProcessingManager

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class ArchitectureBoundariesTest(unittest.TestCase):
    def test_capture_worker_does_not_own_inference_identity_or_persistence(self) -> None:
        imports = _imports("app/camera/capture_worker.py")
        forbidden = ("app.api", "app.detection", "app.identity", "app.storage")
        self.assertFalse(any(name.startswith(forbidden) for name in imports), imports)

    def test_detector_selection_is_independent_of_inference_and_api_layers(self) -> None:
        imports = _imports("app/detection/detector_selection.py")
        forbidden = ("app.api", "app.camera", "numpy", "torch", "ultralytics")
        self.assertFalse(any(name.startswith(forbidden) for name in imports), imports)

    def test_identity_gallery_storage_does_not_depend_on_camera_or_detection(self) -> None:
        imports = _imports("app/identity/gallery_store.py")
        forbidden = ("app.api", "app.camera", "app.detection")
        self.assertFalse(any(name.startswith(forbidden) for name in imports), imports)

    def test_storage_repositories_do_not_depend_on_camera_or_api_layers(self) -> None:
        repository_root = PROJECT_ROOT / "app/storage/repositories"
        imports = {
            name
            for path in repository_root.glob("*.py")
            for name in _imports(path.relative_to(PROJECT_ROOT).as_posix())
        }
        forbidden = ("app.api", "app.camera", "app.detection", "app.identity")
        self.assertFalse(any(name.startswith(forbidden) for name in imports), imports)

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

    def test_local_data_facade_delegates_atomic_occupancy_event_writes(self) -> None:
        source = (PROJECT_ROOT / "app/storage/local_data_store.py").read_text(encoding="utf8")
        self.assertNotIn("insert or ignore into count_events", source)
        self.assertNotIn("insert into occupancy_corrections", source)

    def test_camera_manager_delegates_opencv_capture_ownership(self) -> None:
        imports = _imports("app/camera/camera_manager.py")
        self.assertNotIn("app.camera.stream_reader.open_capture", imports)
        source = (PROJECT_ROOT / "app/camera/camera_manager.py").read_text(encoding="utf8")
        self.assertNotIn("capture.release()", source)

    def test_duplicate_state_tables_are_absent_from_the_canonical_schema(self) -> None:
        runtime_files = list((PROJECT_ROOT / "app").rglob("*.py"))
        runtime_source = "\n".join(path.read_text(encoding="utf8") for path in runtime_files)
        self.assertNotIn("active_monitoring_state", runtime_source)
        self.assertNotIn("count_snapshots", runtime_source)


def _imports(relative_path: str) -> set[str]:
    tree = ast.parse((PROJECT_ROOT / relative_path).read_text(encoding="utf8"))
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            if len(node.names) == 1:
                imports.add(f"{node.module}.{node.names[0].name}")
            else:
                imports.add(node.module)
    return imports


if __name__ == "__main__":
    unittest.main()
