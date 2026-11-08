from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from unittest.mock import patch

import numpy as np

from app.camera.camera_manager import CameraProcessingManager
from app.camera.models import ProcessingSession
from app.config.camera_config import CameraStartRequest
from app.config.open_space_config import OpenSpaceConfig
from app.counting.geometry import Centroid
from app.identity.unique_visitor_registry import UniqueVisitorRegistry
from app.reid.async_worker import ReIdResult
from app.storage.local_database import LocalDatabase
from app.storage.session_store import SessionStore
from app.tracking import ResolvedTrack

POLYGON = [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.2}, {"x": 0.8, "y": 0.8}, {"x": 0.2, "y": 0.8}]
VECTOR = np.array([1.0, 0.0, 0.0], dtype=np.float32)


def resolve(
    registry: UniqueVisitorRegistry, track: int, now: datetime, embedding: np.ndarray = VECTOR
):
    return registry.resolve_entry(
        track_id=track,
        camera_id=1,
        embedding=embedding,
        detection_confidence=0.9,
        bbox=(10, 10, 80, 180),
        now=now,
    )


def test_zone_gallery_is_persistent_deduplicated_and_separate_from_doorway_counts(tmp_path: Path):
    store = SessionStore(str(tmp_path))
    now = datetime(2026, 10, 29, 10, tzinfo=UTC)
    door = UniqueVisitorRegistry(store)
    area = UniqueVisitorRegistry(
        store, identity_namespace="open_space:zone1", record_sightings=False
    )
    door_visitor = resolve(door, 1, now)
    first = resolve(area, 1, now)
    repeat = resolve(area, 2, now + timedelta(minutes=5))
    assert first.visitor_id != door_visitor.visitor_id
    assert first.visitor_id == repeat.visitor_id
    assert area.confirmed_visitor_count(1, now) == 1
    assert door.confirmed_visitor_count(1, now) == 1
    restored = UniqueVisitorRegistry(
        store, identity_namespace="open_space:zone1", record_sightings=False
    )
    assert restored.confirmed_visitor_count(1, now) == 1
    other_zone = UniqueVisitorRegistry(
        store, identity_namespace="open_space:zone2", record_sightings=False
    )
    assert other_zone.confirmed_visitor_count(1, now) == 0
    assert restored.confirmed_visitor_count(2, now) == 0
    assert restored.confirmed_visitor_count(1, now + timedelta(days=1)) == 0
    assert store.metrics_summary()["unique_count"] == 0


def test_uncertain_identity_is_excluded_from_the_zone_unique_estimate(tmp_path: Path):
    registry = UniqueVisitorRegistry(
        SessionStore(str(tmp_path)), identity_namespace="open_space:r1", record_sightings=False
    )
    now = datetime(2026, 10, 29, 10, tzinfo=UTC)
    resolve(registry, 1, now)
    ambiguous = resolve(
        registry, 2, now, np.array([0.65, np.sqrt(1 - 0.65**2), 0], dtype=np.float32)
    )
    assert ambiguous.identity_confidence == "low"
    assert registry.confirmed_visitor_count(1, now) == 1
    assert registry.status()["reid_provisional_gallery_size"] == 1
    with LocalDatabase(str(tmp_path), None).connection() as db:
        assert db.execute("select count(*) from visitor_sightings").fetchone()[0] == 0


def test_people_observed_together_cannot_share_one_visitor_identity(tmp_path: Path):
    registry = UniqueVisitorRegistry(
        SessionStore(str(tmp_path)), identity_namespace="open_space:r1", record_sightings=False
    )
    now = datetime(2026, 10, 29, 10, tzinfo=UTC)
    first = resolve(registry, 1, now)
    assert first.visitor_id is not None
    # Even identical appearance descriptors cannot merge two co-present physical tracks.
    second = registry.resolve_entry(
        track_id=2,
        camera_id=1,
        embedding=VECTOR,
        detection_confidence=0.9,
        bbox=(90, 10, 160, 180),
        now=now,
        excluded_visitor_ids=frozenset({first.visitor_id}),
    )
    assert second.visitor_id != first.visitor_id
    assert registry.confirmed_visitor_count(1, now) == 2


def test_live_zone_identity_matching_preserves_gap_recovery_and_independent_dwell_visits(
    tmp_path: Path,
):
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    manager.bind_enterprise("park", restore_session=False)
    config = CameraStartRequest(
        stream_url="rtsp://192.168.1.20/stream2",
        camera_id=1,
        analysis_mode="open_space",
        reid_mode="fast",
        open_space=OpenSpaceConfig(polygon=POLYGON),
    )
    manager._config = config
    manager._configure_reid_locked(config.model_copy(update={"reid_mode": "auto"}))
    assert manager._effective_reid_mode == "fast"
    manager._configure_reid_locked(config.model_copy(update={"reid_mode": "off"}))
    assert manager._effective_reid_mode == "off"
    manager._configure_reid_locked(config)
    session = ProcessingSession(1, config, Event(), "session")
    manager._active_session = session
    try:
        with (
            patch.object(manager._reidentifier, "status", return_value={"reid_model_ready": True}),
            patch.object(manager._tracker, "track_people", return_value=[]),
            patch.object(manager._counting_track_resolver, "resolve") as motion,
            patch.object(manager._reid_worker, "poll") as fast,
            patch.object(manager._quality_reid_worker, "poll", return_value=[]),
            patch.object(manager, "_schedule_track_embedding"),
        ):
            manager._begin_area(config)
            tracker = manager._area_tracker
            assert tracker is not None
            anchor = tracker.anchor
            first_visit = None
            for second, track_id, x, embedding in [
                (0, 1, 0.1, False),
                (1, 1, 0.5, False),
                (2, 1, 0.5, True),
                (3, 1, 0.5, True),
                (4, 1, None, False),
                (5, 1, 0.5, False),
                (6, 1, 0.9, False),
                (7, 1, 0.9, False),
                (8, 2, 0.1, False),
                (9, 2, 0.5, False),
                (10, 2, 0.5, True),
                (11, 2, 0.5, True),
            ]:
                at = anchor + second
                track = ResolvedTrack(
                    track_id,
                    track_id,
                    (20, 20, 80, 180),
                    0.9,
                    Centroid((x or 0) * 200, 90),
                    Centroid((x or 0) * 200, 100),
                    "new",
                    None,
                    "motion",
                )
                motion.return_value = [track] if x is not None else []
                fast.return_value = (
                    [ReIdResult(1, track_id, track_id, VECTOR, 0.9, at - 0.1, at)]
                    if embedding
                    else []
                )
                if second == 5:
                    fast.return_value = [
                        ReIdResult(1, track_id, track_id, VECTOR, 0.9, anchor - 1, at)
                    ]
                with (
                    patch("app.camera.camera_manager.time.monotonic", return_value=at),
                    patch("app.camera.camera_manager.datetime") as clock,
                ):
                    clock.now.return_value = tracker.wall_anchor + timedelta(seconds=second)
                    manager._detect_and_count(
                        session, np.zeros((200, 200, 3), dtype=np.uint8), 0.15, 0.35, observed_at=at
                    )
                if second == 2:
                    first_visit = tracker.active_records()[0]["visit_id"]
                    assert manager.area_state()["unique_visitors"] == 0
                if second == 4:
                    assert tracker.snapshot()["temporarily_missing"] == 1
                    assert tracker.snapshot()["presence"] == 0
                if second == 5:
                    assert tracker.active_records()[0]["visit_id"] == first_visit
                    assert tracker.active_records()[0]["uncertain_gap_count"] == 1
                    assert manager._appearance_buffer.sample_count_for_track(1) == 2
            assert manager.area_state()["unique_visitors"] == 1
            assert tracker.active_records()[0]["visit_id"] != first_visit
            assert manager._area_repo is not None
            result = manager._area_repo.query(
                1,
                tracker.wall_anchor - timedelta(seconds=1),
                tracker.wall_anchor + timedelta(hours=1),
            )
            assert result["completed_count"] == 1
            assert result["median_dwell_ms"] == 4000
            with patch("app.camera.camera_manager.datetime") as clock:
                clock.now.return_value = tracker.wall_anchor + timedelta(days=1)
                assert manager.area_state()["unique_visitors"] is None
            with manager._area_repo.database.connection() as db:
                assert db.execute("select count(*) from count_events").fetchone()[0] == 0
                assert db.execute("select count(*) from visitor_sightings").fetchone()[0] == 0
            manager._effective_reid_mode = "off"
            manager._publish_area_snapshot()
            assert manager.area_state()["unique_visitors"] is None
        manager.bind_enterprise("other", restore_session=False)
        assert manager.area_state() is None
    finally:
        manager.close()
