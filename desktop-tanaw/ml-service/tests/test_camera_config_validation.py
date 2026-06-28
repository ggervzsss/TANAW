import unittest

from pydantic import ValidationError

from app.config.camera_config import CameraStartRequest


class CameraConfigValidationTest(unittest.TestCase):
    def test_valid_roi_and_tripwire_config_is_accepted(self) -> None:
        config = CameraStartRequest.model_validate(
            {
                "stream_url": "000",
                "roi": {"top": 0.1, "left": 0.1, "width": 0.8, "height": 0.8},
                "entry_line": {
                    "start": {"x": 0.35, "y": 0.1},
                    "end": {"x": 0.35, "y": 0.9},
                },
                "exit_line": {
                    "start": {"x": 0.65, "y": 0.1},
                    "end": {"x": 0.65, "y": 0.9},
                },
            }
        )

        self.assertEqual(config.roi.width, 0.8)

    def test_sampled_tripwire_paths_are_accepted(self) -> None:
        config = CameraStartRequest.model_validate(
            {
                "stream_url": "000",
                "entry_line": {
                    "start": {"x": 0.25, "y": 0.1},
                    "end": {"x": 0.42, "y": 0.9},
                    "points": [
                        {"x": 0.25, "y": 0.1},
                        {"x": 0.30, "y": 0.45},
                        {"x": 0.42, "y": 0.9},
                    ],
                    "curve": "smooth",
                    "sampled_points": [
                        {"x": 0.25, "y": 0.1},
                        {"x": 0.29, "y": 0.35},
                        {"x": 0.35, "y": 0.65},
                        {"x": 0.42, "y": 0.9},
                    ],
                },
                "exit_line": {
                    "start": {"x": 0.70, "y": 0.1},
                    "end": {"x": 0.70, "y": 0.9},
                },
            }
        )

        self.assertIsNotNone(config.entry_line)
        if config.entry_line is not None:
            self.assertEqual(config.entry_line.curve, "smooth")
            self.assertEqual(len(config.entry_line.sampled_points or []), 4)

    def test_processing_profile_is_validated(self) -> None:
        self.assertEqual(
            CameraStartRequest(stream_url="000", processing_profile="cpu").processing_profile, "cpu"
        )
        with self.assertRaises(ValidationError):
            CameraStartRequest.model_validate(
                {"stream_url": "000", "processing_profile": "unsupported"}
            )

    def test_roi_outside_frame_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValidationError, "ROI left \\+ width"):
            CameraStartRequest.model_validate(
                {"stream_url": "000", "roi": {"top": 0.1, "left": 0.4, "width": 0.8, "height": 0.8}}
            )

    def test_too_small_roi_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            CameraStartRequest.model_validate(
                {
                    "stream_url": "000",
                    "roi": {"top": 0.1, "left": 0.1, "width": 0.05, "height": 0.8},
                }
            )

    def test_custom_tripwire_requires_both_lines(self) -> None:
        with self.assertRaisesRegex(ValidationError, "Both entry_line and exit_line"):
            CameraStartRequest.model_validate(
                {
                    "stream_url": "000",
                    "entry_line": {
                        "start": {"x": 0.35, "y": 0.1},
                        "end": {"x": 0.35, "y": 0.9},
                    },
                }
            )

    def test_short_custom_tripwire_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValidationError, "at least 0.10"):
            CameraStartRequest.model_validate(
                {
                    "stream_url": "000",
                    "entry_line": {
                        "start": {"x": 0.35, "y": 0.1},
                        "end": {"x": 0.35, "y": 0.12},
                    },
                    "exit_line": {
                        "start": {"x": 0.65, "y": 0.1},
                        "end": {"x": 0.65, "y": 0.9},
                    },
                }
            )

    def test_overlapping_custom_tripwires_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValidationError, "must not overlap"):
            CameraStartRequest.model_validate(
                {
                    "stream_url": "000",
                    "entry_line": {
                        "start": {"x": 0.35, "y": 0.1},
                        "end": {"x": 0.35, "y": 0.9},
                    },
                    "exit_line": {
                        "start": {"x": 0.35, "y": 0.1},
                        "end": {"x": 0.35, "y": 0.9},
                    },
                }
            )


if __name__ == "__main__":
    unittest.main()
