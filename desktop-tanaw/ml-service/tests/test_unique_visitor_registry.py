import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from app.identity.unique_visitor_registry import UniqueVisitorRegistry
from app.storage.session_store import SessionStore


class UniqueVisitorRegistryTest(unittest.TestCase):
    def test_first_entry_creates_unique_visitor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = UniqueVisitorRegistry(SessionStore(str(Path(directory))))

            decision = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )

            self.assertTrue(decision.is_unique_entry)
            self.assertEqual(decision.reid_decision, "new")
            self.assertIsNotNone(decision.visitor_id)

    def test_strong_repeat_match_does_not_increment_unique(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = UniqueVisitorRegistry(SessionStore(str(Path(directory))))
            now = _utc("2026-06-07T01:00:00+00:00")
            first = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=now,
            )
            second = registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([0.99, 0.01, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 12, 82, 182),
                now=_utc("2026-06-07T02:00:00+00:00"),
            )

            self.assertFalse(second.is_unique_entry)
            self.assertEqual(second.reid_decision, "matched_existing")
            self.assertEqual(second.visitor_id, first.visitor_id)

    def test_ambiguous_match_stays_provisional_and_does_not_increment_unique(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = UniqueVisitorRegistry(SessionStore(str(Path(directory))))
            registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )
            decision = registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([0.68, 0.73, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 12, 82, 182),
                now=_utc("2026-06-07T02:00:00+00:00"),
            )

            self.assertFalse(decision.is_unique_entry)
            self.assertEqual(decision.reid_decision, "ambiguous_new")
            self.assertEqual(decision.identity_confidence, "low")
            self.assertEqual(registry.status()["reid_provisional_gallery_size"], 1)

    def test_low_confidence_repeat_is_confirmed_instead_of_falsely_merged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = UniqueVisitorRegistry(SessionStore(str(Path(directory))))
            first = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )
            provisional = registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([0.69, 0.724, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 12, 82, 182),
                now=_utc("2026-06-07T02:00:00+00:00"),
            )
            promoted = registry.resolve_entry(
                track_id=3,
                camera_id=10,
                embedding=_embedding([0.78, 0.626, 0.0]),
                detection_confidence=0.9,
                bbox=(14, 12, 84, 182),
                now=_utc("2026-06-07T02:10:00+00:00"),
            )

            self.assertFalse(provisional.is_unique_entry)
            self.assertTrue(promoted.is_unique_entry)
            self.assertEqual(promoted.reid_decision, "provisional_confirmed")
            self.assertEqual(promoted.visitor_id, provisional.visitor_id)
            self.assertNotEqual(promoted.visitor_id, first.visitor_id)
            self.assertEqual(registry.status()["reid_gallery_size"], 2)
            self.assertEqual(registry.status()["reid_provisional_gallery_size"], 0)

    def test_strict_reconciliation_is_quarantined_and_can_be_rolled_back(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(str(Path(directory)))
            registry = UniqueVisitorRegistry(store)
            first = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )
            provisional = registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([0.79, 0.613, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 12, 82, 182),
                now=_utc("2026-06-07T02:00:00+00:00"),
            )
            reconciled = registry.resolve_entry(
                track_id=3,
                camera_id=10,
                embedding=_embedding([0.83, 0.558, 0.0]),
                detection_confidence=0.9,
                bbox=(14, 12, 84, 182),
                now=_utc("2026-06-07T02:10:00+00:00"),
            )

            self.assertFalse(provisional.is_unique_entry)
            self.assertFalse(reconciled.is_unique_entry)
            self.assertEqual(reconciled.reid_decision, "reconciled_existing")
            self.assertEqual(reconciled.visitor_id, first.visitor_id)

            prototypes = store.load_active_visitor_identity_prototypes(
                "2026-06-07",
                registry.model_name,
                "2026-06-07T02:11:00+00:00",
            )
            self.assertEqual(len(prototypes), 1)
            self.assertEqual(prototypes[0]["visitor_id"], first.visitor_id)
            self.assertEqual(prototypes[0]["embedding_count"], 1)

            assert provisional.visitor_id is not None
            restored = registry.restore_merged_identity(
                provisional.visitor_id,
                now=_utc("2026-06-07T02:20:00+00:00"),
            )
            self.assertTrue(restored)
            self.assertEqual(registry.status()["reid_gallery_size"], 2)

            repeat = registry.resolve_entry(
                track_id=4,
                camera_id=10,
                embedding=_embedding([0.79, 0.613, 0.0]),
                detection_confidence=0.9,
                bbox=(16, 12, 86, 182),
                now=_utc("2026-06-07T02:21:00+00:00"),
            )
            self.assertFalse(repeat.is_unique_entry)
            self.assertEqual(repeat.visitor_id, provisional.visitor_id)
            self.assertEqual(repeat.reid_decision, "matched_existing")

    def test_quality_disagreement_blocks_fast_reconciliation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = UniqueVisitorRegistry(
                SessionStore(str(Path(directory))),
                model_name="fast",
                quality_model_name="quality",
            )
            first = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                quality_embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )
            provisional = registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([0.79, 0.613, 0.0]),
                quality_embedding=_embedding([0.0, 1.0, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 12, 82, 182),
                now=_utc("2026-06-07T02:00:00+00:00"),
            )
            promoted = registry.resolve_entry(
                track_id=3,
                camera_id=10,
                embedding=_embedding([0.83, 0.558, 0.0]),
                quality_embedding=_embedding([0.0, 1.0, 0.0]),
                detection_confidence=0.9,
                bbox=(14, 12, 84, 182),
                now=_utc("2026-06-07T02:10:00+00:00"),
            )

            self.assertTrue(promoted.is_unique_entry)
            self.assertEqual(promoted.reid_decision, "provisional_confirmed")
            self.assertEqual(promoted.visitor_id, provisional.visitor_id)
            self.assertNotEqual(promoted.visitor_id, first.visitor_id)

    def test_fast_and_quality_consensus_reconciles_outfit_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = UniqueVisitorRegistry(
                SessionStore(str(Path(directory))),
                model_name="fast",
                quality_model_name="quality",
            )
            first = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                quality_embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )
            provisional = registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([0.75, 0.661, 0.0]),
                quality_embedding=_embedding([0.81, 0.586, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 12, 82, 182),
                now=_utc("2026-06-07T02:00:00+00:00"),
            )
            reconciled = registry.resolve_entry(
                track_id=3,
                camera_id=10,
                embedding=_embedding([0.79, 0.613, 0.0]),
                quality_embedding=_embedding([0.81, 0.586, 0.0]),
                detection_confidence=0.9,
                bbox=(14, 12, 84, 182),
                now=_utc("2026-06-07T02:10:00+00:00"),
            )

            self.assertFalse(provisional.is_unique_entry)
            self.assertFalse(reconciled.is_unique_entry)
            self.assertEqual(reconciled.reid_decision, "reconciled_existing")
            self.assertEqual(reconciled.visitor_id, first.visitor_id)

    def test_repeated_provisional_identity_is_promoted_when_still_distinct(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = UniqueVisitorRegistry(SessionStore(str(Path(directory))))
            registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )
            provisional = registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([0.61, 0.792, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 12, 82, 182),
                now=_utc("2026-06-07T02:00:00+00:00"),
            )
            promoted = registry.resolve_entry(
                track_id=3,
                camera_id=10,
                embedding=_embedding([0.62, 0.785, 0.0]),
                detection_confidence=0.9,
                bbox=(14, 12, 84, 182),
                now=_utc("2026-06-07T02:10:00+00:00"),
            )

            self.assertFalse(provisional.is_unique_entry)
            self.assertTrue(promoted.is_unique_entry)
            self.assertEqual(promoted.reid_decision, "provisional_confirmed")
            self.assertEqual(promoted.visitor_id, provisional.visitor_id)
            self.assertEqual(registry.status()["reid_provisional_gallery_size"], 0)

    def test_same_track_reentry_confirms_provisional_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = UniqueVisitorRegistry(SessionStore(str(Path(directory))))
            registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )
            provisional = registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([0.68, 0.73, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 12, 82, 182),
                now=_utc("2026-06-07T02:00:00+00:00"),
            )
            reentry = registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([0.69, 0.72, 0.0]),
                detection_confidence=0.9,
                bbox=(14, 12, 84, 182),
                now=_utc("2026-06-07T02:10:00+00:00"),
            )

            self.assertFalse(provisional.is_unique_entry)
            self.assertTrue(reentry.is_unique_entry)
            self.assertEqual(reentry.reid_decision, "provisional_confirmed")
            self.assertEqual(reentry.visitor_id, provisional.visitor_id)
            self.assertEqual(registry.status()["reid_provisional_gallery_size"], 0)

    def test_missing_embedding_degrades_to_unique_without_identity_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(str(Path(directory)))
            registry = UniqueVisitorRegistry(store)

            decision = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=None,
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )

            self.assertTrue(decision.is_unique_entry)
            self.assertEqual(decision.reid_decision, "degraded_no_embedding")
            self.assertIsNone(decision.visitor_id)
            self.assertEqual(registry.status()["reid_gallery_size"], 0)

    def test_expired_business_day_identity_is_not_reused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(str(Path(directory)))
            registry = UniqueVisitorRegistry(store)
            first = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )

            registry.cleanup_expired(_utc("2026-06-08T18:00:00+00:00"))
            second = registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-08T18:01:00+00:00"),
            )

            self.assertTrue(second.is_unique_entry)
            self.assertNotEqual(second.visitor_id, first.visitor_id)

    def test_session_track_mapping_can_be_reset_without_clearing_gallery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = UniqueVisitorRegistry(SessionStore(str(Path(directory))))
            first = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )
            same_track_before_reset = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([0.0, 1.0, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 12, 82, 182),
                now=_utc("2026-06-07T01:05:00+00:00"),
            )

            registry.reset_session_tracks()
            same_track_after_reset = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([0.0, 1.0, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 12, 82, 182),
                now=_utc("2026-06-07T01:10:00+00:00"),
            )

            self.assertFalse(same_track_before_reset.is_unique_entry)
            self.assertEqual(same_track_before_reset.reid_decision, "track_existing")
            self.assertEqual(same_track_before_reset.visitor_id, first.visitor_id)
            self.assertTrue(same_track_after_reset.is_unique_entry)
            self.assertEqual(same_track_after_reset.reid_decision, "new")
            self.assertNotEqual(same_track_after_reset.visitor_id, first.visitor_id)

    def test_gallery_ignores_embeddings_from_another_model_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(str(Path(directory)))
            now = _utc("2026-06-07T01:00:00+00:00")
            old_registry = UniqueVisitorRegistry(store, model_name="old-model")
            old_registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=now,
            )

            new_registry = UniqueVisitorRegistry(store, model_name="new-model")
            decision = new_registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:05:00+00:00"),
            )

            self.assertTrue(decision.is_unique_entry)
            self.assertEqual(decision.reid_decision, "new")

    def test_quality_embedding_overrides_conflicting_fast_match(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = UniqueVisitorRegistry(
                SessionStore(str(Path(directory))),
                model_name="fast",
                quality_model_name="quality",
            )
            now = _utc("2026-06-07T01:00:00+00:00")
            first = registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                quality_embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=now,
            )
            registry.resolve_entry(
                track_id=2,
                camera_id=10,
                embedding=_embedding([0.0, 1.0, 0.0]),
                quality_embedding=_embedding([0.0, 1.0, 0.0]),
                detection_confidence=0.9,
                bbox=(100, 10, 170, 180),
                now=_utc("2026-06-07T01:05:00+00:00"),
            )

            decision = registry.resolve_entry(
                track_id=3,
                camera_id=10,
                embedding=_embedding([0.0, 1.0, 0.0]),
                quality_embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(12, 10, 82, 180),
                now=_utc("2026-06-07T01:10:00+00:00"),
            )

            self.assertFalse(decision.is_unique_entry)
            self.assertEqual(decision.visitor_id, first.visitor_id)
            self.assertEqual(decision.reid_decision, "matched_existing_quality")

            registry.reset_session_tracks()
            fast_only_repeat = registry.resolve_entry(
                track_id=4,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(14, 10, 84, 180),
                now=_utc("2026-06-07T01:15:00+00:00"),
            )
            self.assertEqual(fast_only_repeat.visitor_id, first.visitor_id)

    def test_late_quality_embedding_is_attached_to_track_visitor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = SessionStore(str(Path(directory)))
            registry = UniqueVisitorRegistry(store, model_name="fast", quality_model_name="quality")
            registry.resolve_entry(
                track_id=1,
                camera_id=10,
                embedding=_embedding([1.0, 0.0, 0.0]),
                detection_confidence=0.9,
                bbox=(10, 10, 80, 180),
                now=_utc("2026-06-07T01:00:00+00:00"),
            )

            recorded = registry.record_quality_embedding_for_track(
                1,
                _embedding([0.0, 1.0, 0.0]),
                now=_utc("2026-06-07T01:01:00+00:00"),
            )

            self.assertTrue(recorded)
            self.assertEqual(registry.status()["reid_quality_gallery_size"], 1)
            rows = store.load_active_visitor_model_embeddings(
                "2026-06-07",
                "quality",
                "2026-06-07T01:02:00+00:00",
            )
            self.assertEqual(len(rows), 1)

            rejected = registry.record_quality_embedding_for_track(
                1,
                _embedding([1.0, 0.0, 0.0]),
                now=_utc("2026-06-07T01:03:00+00:00"),
            )
            unchanged = store.load_active_visitor_model_embeddings(
                "2026-06-07",
                "quality",
                "2026-06-07T01:04:00+00:00",
            )

            self.assertFalse(rejected)
            self.assertEqual(unchanged[0]["embedding_count"], 1)


def _embedding(values: list[float]) -> np.ndarray:
    embedding = np.asarray(values, dtype=np.float32)
    return embedding / np.linalg.norm(embedding)


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)


if __name__ == "__main__":
    unittest.main()
