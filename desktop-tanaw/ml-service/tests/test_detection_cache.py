import tempfile
import unittest
from pathlib import Path

from app.counting.geometry import Centroid
from app.detection.yolo_detector import TrackResult
from app.evaluation.detection_cache import (
    CachedDetectionFrame,
    DetectionCacheMetadata,
    DetectionCacheWriter,
    load_detection_cache,
    validate_detection_cache,
)


class DetectionCacheTest(unittest.TestCase):
    def test_round_trip_preserves_detector_tracks(self) -> None:
        metadata = _metadata()
        frame = CachedDetectionFrame(
            frame_index=12,
            timestamp=0.4,
            frame_width=640,
            frame_height=360,
            detector_ms=12.5,
            tracks=(
                TrackResult(
                    track_id=8,
                    bbox=(10, 20, 80, 180),
                    confidence=0.91,
                    centroid=Centroid(45.0, 100.0),
                    counting_point=Centroid(45.0, 180.0),
                ),
            ),
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "detections.jsonl"
            with DetectionCacheWriter(path, metadata) as writer:
                writer.write_frame(frame)

            loaded_metadata, loaded_frames = load_detection_cache(path)

        self.assertEqual(loaded_metadata, metadata)
        self.assertEqual(loaded_frames[12], frame)

    def test_validation_rejects_a_changed_replay_setting(self) -> None:
        cached = _metadata()
        expected = DetectionCacheMetadata(**{**cached.__dict__, "tracking_confidence": 0.2})

        with self.assertRaisesRegex(ValueError, "tracking_confidence"):
            validate_detection_cache(cached, expected)


def _metadata() -> DetectionCacheMetadata:
    return DetectionCacheMetadata(
        video_sha256="abc123",
        source_fps=30.0,
        source_frame_count=300,
        sample_every=3,
        crop_normalized=None,
        processing_profile="balanced",
        runtime_backend="cpu",
        tracker_profile="botsort",
        tracking_confidence=0.15,
        max_frame_width=960,
        model_name="yolo11s",
        detector_image_size=640,
        detector_nms_iou=0.55,
        detector_max_detections=96,
    )


if __name__ == "__main__":
    unittest.main()
