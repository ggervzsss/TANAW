import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from app.detection.yolo_detector import (
    YoloPersonTracker,
    get_detector_model_availability,
    resolve_detector_selection,
)


class YoloPersonTrackerTest(unittest.TestCase):
    def test_construction_defers_expensive_runtime_discovery(self) -> None:
        with patch(
            "app.detection.yolo_detector.get_runtime_capabilities",
            side_effect=AssertionError("runtime discovery must be lazy"),
        ):
            tracker = YoloPersonTracker()

        self.assertEqual(tracker.effective_profile, "emergency")
        self.assertEqual(tracker.selected_runtime, "cpu")

    def test_default_model_path_resolves_to_local_setup_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11n.pt").write_bytes(b"placeholder")

            with (
                patch("app.detection.yolo_detector._models_root", return_value=models_root),
                patch(
                    "app.detection.yolo_detector.get_runtime_capabilities",
                    return_value=_capabilities(cuda=False, openvino=False),
                ),
            ):
                tracker = YoloPersonTracker()
                model_path = Path(tracker._resolve_model_path())

            self.assertEqual(model_path, models_root / "yolo11n.pt")
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

    def test_auto_cuda_selects_balanced_yolo11s_with_botsort_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11s.pt").write_bytes(b"placeholder")

            selection = resolve_detector_selection(
                processing_profile="auto",
                capabilities=_capabilities(cuda=True, openvino=False),
                models_root=models_root,
            )

            self.assertEqual(selection.effective_profile, "balanced")
            self.assertEqual(selection.model_name, "yolo11s")
            self.assertEqual(selection.runtime_backend, "cuda")
            self.assertEqual(selection.effective_tracker, "botsort")

    def test_all_stable_profiles_resolve_to_expected_yolo11_models_when_files_exist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            expected = {
                "emergency": "yolo11n",
                "compatibility": "yolo11n",
                "balanced": "yolo11s",
                "high_accuracy": "yolo11m",
            }
            for model_name in set(expected.values()):
                (models_root / f"{model_name}.pt").write_bytes(b"placeholder")

            for profile, model_name in expected.items():
                with self.subTest(profile=profile):
                    selection = resolve_detector_selection(
                        processing_profile=profile,
                        capabilities=_capabilities(cuda=True, openvino=False),
                        models_root=models_root,
                    )

                    self.assertEqual(selection.effective_profile, profile)
                    self.assertEqual(selection.model_name, model_name)

    def test_high_accuracy_selects_yolo11m_with_botsort_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11m.pt").write_bytes(b"placeholder")

            selection = resolve_detector_selection(
                processing_profile="high_accuracy",
                capabilities=_capabilities(cuda=True, openvino=False),
                models_root=models_root,
            )

            self.assertEqual(selection.effective_profile, "high_accuracy")
            self.assertEqual(selection.model_name, "yolo11m")
            self.assertEqual(selection.runtime_backend, "cuda")
            self.assertEqual(selection.effective_tracker, "botsort")

    def test_high_accuracy_falls_back_to_balanced_when_yolo11m_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11s.pt").write_bytes(b"placeholder")

            selection = resolve_detector_selection(
                processing_profile="high_accuracy",
                capabilities=_capabilities(cuda=True, openvino=False),
                models_root=models_root,
            )

            self.assertEqual(selection.effective_profile, "balanced")
            self.assertEqual(selection.model_name, "yolo11s")
            self.assertEqual(selection.fallback_chain, ("high_accuracy", "balanced"))
            self.assertIn("yolo11m", selection.fallback_reason or "")

    def test_balanced_falls_back_to_compatibility_when_yolo11s_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11n.pt").write_bytes(b"placeholder")

            selection = resolve_detector_selection(
                processing_profile="balanced",
                capabilities=_capabilities(cuda=True, openvino=False),
                models_root=models_root,
            )

            self.assertEqual(selection.effective_profile, "compatibility")
            self.assertEqual(selection.model_name, "yolo11n")
            self.assertIn("yolo11s", selection.fallback_reason or "")
            self.assertEqual(
                selection.fallback_chain,
                ("balanced", "compatibility"),
            )

    def test_cpu_openvino_auto_selects_compatibility_when_yolo11n_export_exists(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11n_640_openvino_model").mkdir()

            selection = resolve_detector_selection(
                processing_profile="auto",
                capabilities=_capabilities(cuda=False, openvino=True),
                models_root=models_root,
            )

            self.assertEqual(selection.effective_profile, "compatibility")
            self.assertEqual(selection.model_name, "yolo11n")
            self.assertEqual(selection.runtime_backend, "openvino")

    def test_explicit_cpu_runtime_does_not_use_openvino_export(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11n.pt").write_bytes(b"placeholder")
            (models_root / "yolo11n_640_openvino_model").mkdir()

            selection = resolve_detector_selection(
                processing_profile="compatibility",
                runtime_backend="cpu",
                capabilities=_capabilities(cuda=True, openvino=True),
                models_root=models_root,
            )

            self.assertEqual(selection.effective_profile, "compatibility")
            self.assertEqual(selection.runtime_backend, "cpu")

    def test_explicit_openvino_runtime_uses_size_specific_openvino_export(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11n.pt").write_bytes(b"placeholder")
            (models_root / "yolo11n_640_openvino_model").mkdir()

            selection = resolve_detector_selection(
                processing_profile="compatibility",
                runtime_backend="openvino",
                capabilities=_capabilities(cuda=False, openvino=True),
                models_root=models_root,
            )

            self.assertEqual(selection.effective_profile, "compatibility")
            self.assertEqual(selection.runtime_backend, "openvino")
            self.assertTrue((selection.model_path or "").endswith("yolo11n_640_openvino_model"))

    def test_unavailable_cuda_runtime_falls_back_without_crashing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11s.pt").write_bytes(b"placeholder")

            selection = resolve_detector_selection(
                processing_profile="balanced",
                runtime_backend="cuda",
                capabilities=_capabilities(cuda=False, openvino=False),
                models_root=models_root,
            )

            self.assertEqual(selection.effective_profile, "balanced")
            self.assertEqual(selection.runtime_backend, "cpu")
            self.assertIn("Requested cuda runtime was unavailable", selection.fallback_reason or "")

    def test_unknown_processing_profile_uses_auto_recommendation_for_internal_safety(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11s.pt").write_bytes(b"placeholder")

            selection = resolve_detector_selection(
                processing_profile="experimental_max",
                capabilities=_capabilities(cuda=True, openvino=False),
                models_root=models_root,
            )

            self.assertEqual(selection.normalized_profile, "auto")
            self.assertEqual(selection.effective_profile, "balanced")
            self.assertEqual(selection.model_name, "yolo11s")

    def test_model_availability_reports_yolo11_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            for model_name in ("yolo11n", "yolo11s", "yolo11m"):
                (models_root / f"{model_name}.pt").write_bytes(b"placeholder")

            availability = get_detector_model_availability(models_root)

            self.assertEqual(
                set(availability),
                {
                    "emergency",
                    "compatibility",
                    "balanced",
                    "high_accuracy",
                },
            )
            self.assertTrue(availability["balanced"]["available"])

    def test_requested_botsort_falls_back_when_config_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            models_root = Path(directory)
            (models_root / "yolo11s.pt").write_bytes(b"placeholder")

            def missing_botsort_config(profile_name: str, tracker: str) -> Path:
                if tracker == "botsort":
                    return models_root / "missing_botsort.yaml"
                return models_root / "tracker_configs" / "bytetrack.yaml"

            with patch(
                "app.detection.yolo_detector._tracker_config_path",
                side_effect=missing_botsort_config,
            ):
                selection = resolve_detector_selection(
                    processing_profile="balanced",
                    tracker_profile="botsort",
                    capabilities=_capabilities(cuda=True, openvino=False),
                    models_root=models_root,
                )

            self.assertEqual(selection.effective_tracker, "bytetrack")
            self.assertIn("BoT-SORT config", selection.fallback_reason or "")


def _capabilities(cuda: bool, openvino: bool) -> dict[str, Any]:
    return {
        "cuda_available": cuda,
        "openvino_available": openvino,
        "runtime_available": {
            "auto": True,
            "cuda": cuda,
            "openvino": openvino,
            "cpu": True,
        },
    }


if __name__ == "__main__":
    unittest.main()
