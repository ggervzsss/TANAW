import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.counting.geometry import Centroid
from app.detection.yolo_detector import TrackResult
from app.reid import PersonReIdentifier, TrackAppearanceBuffer


class ReIdComponentsTest(unittest.TestCase):
    def test_missing_reid_model_degrades_without_raising(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            reidentifier = PersonReIdentifier(model_path=str(Path(directory) / "missing.onnx"))

            reidentifier.warmup()
            status = reidentifier.status()

            self.assertFalse(status["reid_model_ready"])
            self.assertEqual(status["reid_status"], "degraded")
            self.assertIsNotNone(status["reid_error"])

    def test_bundled_reid_model_loads_and_outputs_normalized_embedding(self) -> None:
        reidentifier = PersonReIdentifier()

        reidentifier.warmup()
        result = reidentifier.embed_crop(np.zeros((256, 128, 3), dtype=np.uint8))

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.embedding.shape, (512,))
        self.assertAlmostEqual(float(np.linalg.norm(result.embedding)), 1.0, places=5)
        self.assertTrue(reidentifier.status()["reid_model_ready"])

    def test_absolute_reid_model_path_resolves_when_present(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.onnx"
            model_path.write_bytes(b"placeholder")
            reidentifier = PersonReIdentifier(model_path=str(model_path))

            self.assertEqual(reidentifier._resolve_model_path(), str(model_path))

    def test_appearance_buffer_skips_low_quality_tracks(self) -> None:
        buffer = TrackAppearanceBuffer(min_detection_confidence=0.45, min_bbox_height_px=80)
        low_confidence = _track(confidence=0.2, bbox=(10, 10, 90, 140))
        small_bbox = _track(confidence=0.9, bbox=(10, 10, 90, 40))

        self.assertFalse(buffer.should_sample(low_confidence, 200, 200, 1))
        self.assertFalse(buffer.should_sample(small_bbox, 200, 200, 1))

    def test_appearance_buffer_returns_weighted_normalized_embedding(self) -> None:
        buffer = TrackAppearanceBuffer()
        buffer.record_sample(1, np.array([1.0, 0.0], dtype=np.float32), quality=0.9, frame_index=1)
        buffer.record_sample(1, np.array([0.0, 1.0], dtype=np.float32), quality=0.1, frame_index=2)

        embedding = buffer.embedding_for_track(1)

        self.assertIsNotNone(embedding)
        assert embedding is not None
        self.assertAlmostEqual(float(np.linalg.norm(embedding)), 1.0, places=5)
        self.assertGreater(float(embedding[0]), float(embedding[1]))

    def test_quality_buffer_stops_sampling_when_full(self) -> None:
        buffer = TrackAppearanceBuffer(max_samples_per_track=1, stop_when_full=True)
        track = _track(confidence=0.9, bbox=(10, 10, 90, 180))
        buffer.record_sample(1, np.array([1.0, 0.0], dtype=np.float32), quality=0.9, frame_index=1)

        self.assertFalse(buffer.should_sample(track, 200, 200, 2))


def _track(confidence: float, bbox: tuple[int, int, int, int]) -> TrackResult:
    return TrackResult(
        track_id=1,
        bbox=bbox,
        confidence=confidence,
        centroid=Centroid(50, 50),
        counting_point=Centroid(50, 100),
    )


if __name__ == "__main__":
    unittest.main()
