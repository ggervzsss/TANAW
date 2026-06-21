import tempfile
import unittest
from pathlib import Path

from app.detection.yolo_detector import YoloPersonTracker


class YoloPersonTrackerTest(unittest.TestCase):
    def test_default_model_path_resolves_to_bundled_models_directory(self) -> None:
        tracker = YoloPersonTracker()

        model_path = Path(tracker._resolve_model_path())

        self.assertIn(
            model_path.name, {"yolov8n.pt", "yolov8n_480_openvino_model", "yolov8n_openvino_model"}
        )
        self.assertIn("models", model_path.parts)
        self.assertTrue(model_path.exists())

    def test_missing_absolute_model_path_raises_clear_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing_model = Path(directory) / "missing.pt"
            tracker = YoloPersonTracker(model_path=str(missing_model))

            with self.assertRaisesRegex(FileNotFoundError, "YOLO model file was not found"):
                tracker._resolve_model_path()

    def test_status_does_not_block_when_model_lock_is_held(self) -> None:
        tracker = YoloPersonTracker()

        tracker._lock.acquire()
        try:
            status = tracker.status()
        finally:
            tracker._lock.release()

        self.assertTrue(status["model_loading"])
        self.assertFalse(status["model_loaded"])

    def test_cpu_profile_uses_balanced_detector_input(self) -> None:
        tracker = YoloPersonTracker()

        effective = tracker.configure("cpu")

        self.assertEqual(effective, "cpu")
        self.assertEqual(tracker.image_size, 480)


if __name__ == "__main__":
    unittest.main()
