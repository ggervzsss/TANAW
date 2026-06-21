import unittest

import numpy as np

from app.counting.geometry import Centroid
from app.detection.yolo_detector import TrackResult
from app.tracking import TrackIdentityResolver


class TrackIdentityResolverTest(unittest.TestCase):
    def test_nearby_raw_id_reset_is_stitched_to_stable_id(self) -> None:
        resolver = TrackIdentityResolver(lost_track_ttl_seconds=2.5)

        first = resolver.resolve([_track(10, (40, 20, 80, 180))], 1.0, 200, 200)[0]
        second = resolver.resolve([_track(22, (55, 20, 95, 180))], 1.2, 200, 200)[0]

        self.assertEqual(second.track_id, first.track_id)
        self.assertEqual(second.source_track_id, 22)
        self.assertEqual(second.identity_state, "stitched")
        self.assertEqual(resolver.status()["identity_stitches"], 1)

    def test_implausible_jump_splits_reused_source_id(self) -> None:
        resolver = TrackIdentityResolver(max_jump_distance_fraction=0.20)

        first = resolver.resolve([_track(10, (10, 20, 50, 180))], 1.0, 400, 200)[0]
        second = resolver.resolve([_track(10, (330, 20, 370, 180))], 1.1, 400, 200)[0]

        self.assertNotEqual(second.track_id, first.track_id)
        self.assertEqual(resolver.status()["identity_splits"], 1)

    def test_appearance_can_merge_new_track_back_to_lost_identity(self) -> None:
        resolver = TrackIdentityResolver(
            lost_track_ttl_seconds=3.0,
            max_spatial_distance_fraction=0.05,
            appearance_match_threshold=0.70,
        )
        embedding = _embedding([1.0, 0.0, 0.0])

        first = resolver.resolve([_track(1, (20, 20, 60, 180))], 1.0, 400, 200)[0]
        resolver.record_embedding(1, first.track_id, embedding, 1.1)
        second = resolver.resolve([_track(2, (240, 20, 280, 180))], 2.0, 400, 200)[0]

        remap = resolver.record_embedding(2, second.track_id, embedding, 2.1)

        self.assertIsNotNone(remap)
        assert remap is not None
        self.assertEqual((remap.remap_from, remap.remap_to), (second.track_id, first.track_id))
        self.assertEqual(resolver.canonical_track_id(second.track_id), first.track_id)

    def test_appearance_corrects_active_source_id_swap(self) -> None:
        resolver = TrackIdentityResolver(appearance_match_threshold=0.70)
        first_embedding = _embedding([1.0, 0.0, 0.0])
        second_embedding = _embedding([0.0, 1.0, 0.0])
        first, second = resolver.resolve(
            [_track(10, (80, 20, 120, 180)), _track(20, (180, 20, 220, 180))],
            1.0,
            400,
            200,
        )
        resolver.record_embedding(10, first.track_id, first_embedding, 1.1)
        resolver.record_embedding(20, second.track_id, second_embedding, 1.1)

        resolver.resolve(
            [_track(10, (180, 20, 220, 180)), _track(20, (80, 20, 120, 180))],
            1.2,
            400,
            200,
        )
        correction = resolver.record_embedding(10, first.track_id, second_embedding, 1.3)

        self.assertIsNotNone(correction)
        assert correction is not None
        self.assertTrue(correction.swapped)
        corrected = resolver.resolve(
            [_track(10, (185, 20, 225, 180)), _track(20, (75, 20, 115, 180))],
            1.4,
            400,
            200,
        )
        by_source = {track.source_track_id: track.track_id for track in corrected}
        self.assertEqual(by_source[10], second.track_id)
        self.assertEqual(by_source[20], first.track_id)

    def test_unconfirmed_detector_result_does_not_create_stable_identity(self) -> None:
        resolver = TrackIdentityResolver()

        resolved = resolver.resolve([_track(-1, (40, 20, 80, 180))], 1.0, 200, 200)

        self.assertEqual(resolved, [])
        self.assertEqual(resolver.status()["identity_active_tracks"], 0)


def _track(track_id: int, bbox: tuple[int, int, int, int]) -> TrackResult:
    x1, y1, x2, y2 = bbox
    return TrackResult(
        track_id=track_id,
        bbox=bbox,
        confidence=0.9,
        centroid=Centroid((x1 + x2) / 2, (y1 + y2) / 2),
        counting_point=Centroid((x1 + x2) / 2, y2),
    )


def _embedding(values: list[float]) -> np.ndarray:
    embedding = np.asarray(values, dtype=np.float32)
    return embedding / np.linalg.norm(embedding)


if __name__ == "__main__":
    unittest.main()
