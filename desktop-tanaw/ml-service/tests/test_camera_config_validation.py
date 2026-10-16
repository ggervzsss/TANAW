import unittest

from pydantic import ValidationError

from app.config.camera_config import (
    CameraCountingConfigUpdate,
    CameraStartRequest,
    CameraTestRequest,
)


class CameraConfigValidationTest(unittest.TestCase):
    def test_test_and_start_requests_preserve_brand_endpoints(self) -> None:
        endpoints = (
            ("tenda", "rtsp://192.168.1.20:554/ch=1?subtype=0"),
            ("tenda", "rtsp://192.168.1.20:8554/profile1"),
            ("tenda", "rtsp://192.168.1.20:554/ch=1&subtype=1"),
            ("tenda", "rtsp://192.168.1.20:554/H264?ch=1&subtype=0"),
            ("dahua", "rtsp://192.168.1.20:554/cam/realmonitor?channel=1&subtype=1"),
            ("dahua", "rtsp://192.168.1.20:9554/cam/realmonitor?channel=1&subtype=0"),
            ("custom", "rtsp://192.168.1.20:9554/live?channel=2&quality=high"),
        )
        for request_type in (CameraTestRequest, CameraStartRequest):
            for brand, endpoint in endpoints:
                with self.subTest(request=request_type.__name__, endpoint=endpoint):
                    request = request_type.model_validate(
                        {
                            "camera_id": 7,
                            "camera_brand": brand,
                            "stream_url": endpoint,
                            "username": "admin",
                            "password": "device-password",
                        }
                    )
                    self.assertEqual(request.stream_url, endpoint)
                    self.assertEqual(request.camera_host, "192.168.1.20")
                    self.assertEqual(request.camera_brand, brand)

    def test_custom_rtsp_validation_rejects_invalid_or_unsafe_endpoints(self) -> None:
        for endpoint in (
            "rtsp://camera.local/live",
            "rtsp://192.168.1.21/live",
            "rtsp://192.168.1.20:0/live",
            "rtsp://192.168.1.20:99999/live",
            "rtsp://192.168.1.20:/live",
            "rtsp://192.168.1.20/live#fragment",
            "rtsp://user:secret@192.168.1.20/live",
            "rtsp://192.168.1.20/live path",
        ):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValidationError):
                CameraTestRequest.model_validate(
                    {
                        "camera_id": 7,
                        "camera_brand": "custom",
                        "camera_host": "192.168.1.20",
                        "stream_url": endpoint,
                    }
                )

    def test_tapo_default_does_not_accept_other_brands_stream_paths(self) -> None:
        with self.assertRaisesRegex(ValidationError, "conflicts"):
            CameraStartRequest.model_validate({"stream_url": "rtsp://192.168.1.20:8554/profile0"})

    def test_counting_hot_update_rejects_invalid_geometry_without_a_stream_url(self) -> None:
        with self.assertRaisesRegex(ValidationError, "must not overlap"):
            CameraCountingConfigUpdate.model_validate(
                {
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

    def test_valid_roi_and_tripwire_config_is_accepted(self) -> None:
        config = CameraStartRequest.model_validate(
            {
                "stream_url": "rtsp://192.168.1.20/stream2",
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
                "stream_url": "rtsp://192.168.1.20/stream2",
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
            CameraStartRequest(
                stream_url="rtsp://192.168.1.20/stream2", processing_profile="compatibility"
            ).processing_profile,
            "compatibility",
        )
        self.assertEqual(
            CameraStartRequest(
                stream_url="rtsp://192.168.1.20/stream2", processing_profile="high_accuracy"
            ).processing_profile,
            "high_accuracy",
        )
        self.assertEqual(
            CameraStartRequest(
                stream_url="rtsp://192.168.1.20/stream2",
                runtime_backend="openvino",
                tracker_profile="botsort",
            ).runtime_backend,
            "openvino",
        )
        with self.assertRaises(ValidationError):
            CameraStartRequest.model_validate(
                {"stream_url": "rtsp://192.168.1.20/stream2", "runtime_backend": "tensorrt"}
            )
        with self.assertRaises(ValidationError):
            CameraStartRequest.model_validate(
                {"stream_url": "rtsp://192.168.1.20/stream2", "runtime_backend": "directml"}
            )
        with self.assertRaises(ValidationError):
            CameraStartRequest.model_validate(
                {"stream_url": "rtsp://192.168.1.20/stream2", "processing_profile": "unsupported"}
            )
        for removed_profile in ("experimental_max", "cpu", "accelerated"):
            with self.subTest(removed_profile=removed_profile):
                with self.assertRaises(ValidationError):
                    CameraStartRequest.model_validate(
                        {
                            "stream_url": "rtsp://192.168.1.20/stream2",
                            "processing_profile": removed_profile,
                        }
                    )

    def test_confidence_thresholds_and_modes_are_validated(self) -> None:
        explicit = CameraStartRequest(
            stream_url="rtsp://192.168.1.20/stream2",
            tracking_confidence=0.12,
            counting_confidence=0.38,
            reid_mode="quality",
            unique_counting_mode="estimated_reid",
        )
        self.assertEqual(explicit.tracking_confidence, 0.12)
        self.assertEqual(explicit.counting_confidence, 0.38)
        self.assertEqual(explicit.reid_mode, "quality")

        with self.assertRaisesRegex(ValidationError, "tracking_confidence"):
            CameraStartRequest.model_validate(
                {
                    "stream_url": "rtsp://192.168.1.20/stream2",
                    "tracking_confidence": 0.50,
                    "counting_confidence": 0.35,
                }
            )
        with self.assertRaises(ValidationError):
            CameraStartRequest.model_validate(
                {"stream_url": "rtsp://192.168.1.20/stream2", "reid_mode": "slow"}
            )

    def test_rtsp_source_is_canonicalized_from_ipv4_and_profile(self) -> None:
        config = CameraStartRequest.model_validate(
            {
                "camera_id": 7,
                "camera_host": "192.168.1.20",
                "rtsp_stream": "stream1",
                "stream_url": "rtsp://192.168.1.20/stream1",
            }
        )

        self.assertEqual(config.camera_host, "192.168.1.20")
        self.assertEqual(config.rtsp_stream, "stream1")
        self.assertEqual(config.stream_url, "rtsp://192.168.1.20/stream1")

    def test_rtsp_source_rejects_non_ipv4_and_conflicting_url(self) -> None:
        with self.assertRaisesRegex(ValidationError, "valid IPv4"):
            CameraStartRequest.model_validate(
                {
                    "camera_id": 7,
                    "camera_host": "camera.local",
                    "rtsp_stream": "stream2",
                    "stream_url": "rtsp://camera.local/stream2",
                }
            )
        with self.assertRaisesRegex(ValidationError, "conflicts"):
            CameraStartRequest.model_validate(
                {
                    "camera_id": 7,
                    "camera_host": "192.168.1.20",
                    "rtsp_stream": "stream2",
                    "stream_url": "rtsp://192.168.1.21/stream1",
                }
            )

    def test_non_rtsp_camera_sources_are_rejected(self) -> None:
        for stream_url in ("0", "http://192.168.1.20/video", "https://192.168.1.20/shot.jpg"):
            with self.subTest(stream_url=stream_url):
                with self.assertRaisesRegex(ValidationError, "must start with rtsp://"):
                    CameraStartRequest.model_validate({"stream_url": stream_url})

    def test_roi_outside_frame_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValidationError, "ROI left \\+ width"):
            CameraStartRequest.model_validate(
                {
                    "stream_url": "rtsp://192.168.1.20/stream2",
                    "roi": {"top": 0.1, "left": 0.4, "width": 0.8, "height": 0.8},
                }
            )

    def test_too_small_roi_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            CameraStartRequest.model_validate(
                {
                    "stream_url": "rtsp://192.168.1.20/stream2",
                    "roi": {"top": 0.1, "left": 0.1, "width": 0.05, "height": 0.8},
                }
            )

    def test_custom_tripwire_requires_both_lines(self) -> None:
        with self.assertRaisesRegex(ValidationError, "Both entry_line and exit_line"):
            CameraStartRequest.model_validate(
                {
                    "stream_url": "rtsp://192.168.1.20/stream2",
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
                    "stream_url": "rtsp://192.168.1.20/stream2",
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
                    "stream_url": "rtsp://192.168.1.20/stream2",
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
