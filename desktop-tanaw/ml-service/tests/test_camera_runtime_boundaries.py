import importlib.util
import inspect
import unittest
from pathlib import Path

from app.camera.camera_manager import CameraProcessingManager
from app.camera.capture_runtime import CaptureRuntimeMixin
from app.camera.coverage_runtime import CoverageRuntimeMixin
from app.camera.identity_runtime import IdentityRuntimeMixin
from app.camera.persistence_runtime import PersistenceRuntimeMixin
from app.camera.processing_runtime import ProcessingRuntimeMixin
from app.camera.rendering_runtime import RenderingRuntimeMixin
from app.camera.simulation_runtime import SimulationRuntimeMixin
from app.storage.local_ledger import LocalLedger


class CameraRuntimeBoundaryTest(unittest.TestCase):
    def test_runtime_modules_own_their_responsibilities(self) -> None:
        expected_owners = {
            "prepare_simulation_counts": SimulationRuntimeMixin,
            "_capture_loop": CaptureRuntimeMixin,
            "_start_monitoring_coverage": CoverageRuntimeMixin,
            "_processing_loop": ProcessingRuntimeMixin,
            "_resolve_unique_entry": IdentityRuntimeMixin,
            "_render_display_frame": RenderingRuntimeMixin,
            "_persist_count_event": PersistenceRuntimeMixin,
        }

        for method_name, owner in expected_owners.items():
            with self.subTest(method=method_name):
                self.assertNotIn(method_name, CameraProcessingManager.__dict__)
                self.assertIn(method_name, owner.__dict__)
                self.assertIs(
                    getattr(CameraProcessingManager, method_name), getattr(owner, method_name)
                )

    def test_facade_and_runtime_modules_remain_bounded(self) -> None:
        camera_root = Path(__file__).parents[1] / "app" / "camera"
        runtime_files = (
            "camera_manager.py",
            "capture_runtime.py",
            "coverage_runtime.py",
            "identity_runtime.py",
            "persistence_runtime.py",
            "processing_runtime.py",
            "rendering_runtime.py",
            "simulation_runtime.py",
        )

        line_counts = {
            filename: len((camera_root / filename).read_text(encoding="utf-8").splitlines())
            for filename in runtime_files
        }

        self.assertLess(line_counts["camera_manager.py"], 1_000)
        for filename, line_count in line_counts.items():
            if filename != "camera_manager.py":
                self.assertLess(line_count, 500, filename)

    def test_superseded_storage_modules_are_physically_absent(self) -> None:
        storage_root = Path(__file__).parents[1] / "app" / "storage"
        for module_name in ("local_metrics_store", "session_store", "resilience_store"):
            with self.subTest(module=module_name):
                self.assertFalse((storage_root / f"{module_name}.py").exists())
                self.assertIsNone(importlib.util.find_spec(f"app.storage.{module_name}"))

    def test_local_ledger_routes_transactions_through_the_serialized_writer(self) -> None:
        connection_source = inspect.getsource(LocalLedger._connection)
        write_source = inspect.getsource(LocalLedger._write)
        ledger_source = inspect.getsource(LocalLedger)

        self.assertIn("self._ledger_writer.transaction", connection_source)
        self.assertIn("self._ledger_writer.instrumented_write", write_source)
        self.assertNotIn("sqlite3.connect", ledger_source)


if __name__ == "__main__":
    unittest.main()
