"""Regression coverage for the operational review: counting, identity and recovery safeguards."""

import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import monotonic
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import patch
from zoneinfo import ZoneInfo

import numpy as np
import pytest
from support.cameras import (
    FakePipeline,
    FakeTracker,
    manager_with_store,
    pipeline_config,
    processing_session,
    track_result,
)
from ultralytics.trackers.basetrack import BaseTrack
from ultralytics.trackers.byte_tracker import BYTETracker

from app.attributes import SexEstimator
from app.camera.pipeline_manager import CameraPipelineRegistry
from app.camera.runtime_math import resolve_reid_mode
from app.config.camera_config import CameraStartRequest
from app.counting.geometry import Centroid
from app.counting.tripwire_counter import TripwireCounter
from app.detection.yolo_detector import _GLOBAL_INFERENCE_LOCK, YoloPersonTracker
from app.identity.establishment_registry import EstablishmentRegistry
from app.reid import AsyncReIdWorker, PersonReIdentifier

TRACKER_ARGS = SimpleNamespace(
    track_high_thresh=0.25,
    track_low_thresh=0.08,
    new_track_thresh=0.28,
    track_buffer=45,
    match_thresh=0.78,
    fuse_score=True,
)


def _next_ids(detector: YoloPersonTracker, count: int) -> list[int]:
    with _GLOBAL_INFERENCE_LOCK, detector._own_track_ids():
        return [BaseTrack.next_id() for _ in range(count)]


def test_starting_another_camera_never_reissues_a_running_cameras_track_ids() -> None:
    first, second = YoloPersonTracker(), YoloPersonTracker()
    assert _next_ids(first, 2) == [1, 2]
    # A second camera starts: Ultralytics resets its shared counter when a tracker is created.
    second.reset_tracking()
    with _GLOBAL_INFERENCE_LOCK, second._own_track_ids():
        BYTETracker(TRACKER_ARGS)
        assert BaseTrack.next_id() == 1
    assert _next_ids(first, 1) == [3]
    assert _next_ids(second, 1) == [2]


def test_reconnect_keeps_track_numbering_but_a_restart_does_not() -> None:
    detector = YoloPersonTracker()
    assert _next_ids(detector, 2) == [1, 2]
    detector.reset_tracking(restart_ids=False)
    assert _next_ids(detector, 1) == [3]
    detector.reset_tracking()
    assert _next_ids(detector, 1) == [1]


def _walk(counter: TripwireCounter, points: list[tuple[int, int]]) -> list[str]:
    directions: list[str] = []
    for step, (x, y) in enumerate(points):
        counter.begin_frame(float(step))
        directions += counter.update_many(1, Centroid(x, y), 1000, 1000)
    return directions


def test_walking_past_the_ends_of_the_tripwires_counts_nothing() -> None:
    counter = TripwireCounter(
        entry_line=((0.30, 0.50), (0.45, 0.50)), exit_line=((0.55, 0.40), (0.70, 0.40))
    )
    counter.reset()
    assert _walk(counter, [(900, 200), (900, 300), (900, 450), (900, 600), (900, 800)]) == []
    assert counter.counts.entry == 0


def test_slow_crossing_through_the_line_margin_still_counts() -> None:
    counter = TripwireCounter(tripwire_position=0.5)
    counter.reset()
    # Steps smaller than the movement threshold reach the far side without one big jump.
    assert _walk(counter, [(480, 500), (488, 500), (496, 500), (504, 500), (512, 500)]) == ["entry"]


def test_frame_from_before_a_reconnect_writes_no_crossing(tmp_path: Path) -> None:
    manager = manager_with_store(str(tmp_path))
    session = processing_session(1, camera_id=1)
    manager._config, manager._active_session = session.config, session

    class ReconnectDuringInference(FakeTracker):
        def track_people(self, frame: np.ndarray, confidence: float) -> list[Any]:
            tracks = super().track_people(frame, confidence)
            if not self._responses:
                with manager._raw_frame_condition:
                    manager._invalidate_stream_frames_locked()
            return tracks

    manager._tracker = cast(
        Any,
        ReconnectDuringInference(
            [[track_result(1, (50, 20, 90, 80))], [track_result(1, (96, 20, 136, 80))]]
        ),
    )
    frame = np.zeros((200, 200, 3), dtype=np.uint8)
    try:
        with patch.object(manager, "_schedule_track_embedding"):
            for _ in range(2):
                manager._detect_and_count(
                    session, frame, 0.35, generation=manager._stream_generation
                )
        assert manager.metrics_summary()["entries"] == 0
    finally:
        manager.close()


def test_a_reconnect_restarts_partial_crossings(tmp_path: Path) -> None:
    manager = manager_with_store(str(tmp_path))
    session = processing_session(1, camera_id=1)
    manager._config, manager._active_session = session.config, session
    manager._tracker = cast(
        Any,
        FakeTracker([[track_result(1, (50, 20, 90, 80))], [track_result(1, (96, 20, 136, 80))]]),
    )
    frame = np.zeros((200, 200, 3), dtype=np.uint8)
    try:
        with patch.object(manager, "_schedule_track_embedding"):
            manager._detect_and_count(session, frame, 0.35, generation=manager._stream_generation)
            with manager._raw_frame_condition:
                manager._invalidate_stream_frames_locked()
            # The person is next seen across the line, after an unseen gap: no crossing.
            manager._detect_and_count(session, frame, 0.35, generation=manager._stream_generation)
        assert manager.metrics_summary()["entries"] == 0
    finally:
        manager.close()


class _FlakySession:
    def __init__(self) -> None:
        self.calls = 0

    def run(self, outputs: list[str], feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("transient provider error")
        return [np.ones((1, 512), np.float32)]


def test_one_reid_failure_is_retried_after_a_backoff() -> None:
    reidentifier = PersonReIdentifier()
    reidentifier._session = _FlakySession()
    reidentifier._input_name, reidentifier._output_name = "input", "output"
    crop = np.zeros((128, 64, 3), np.uint8)
    assert reidentifier.embed_crop(crop) is None
    assert reidentifier.embed_crop(crop) is None  # still inside the backoff
    with patch("app.reid.person_reid.monotonic", return_value=monotonic() + 2.0):
        assert reidentifier.embed_crop(crop) is not None
    assert reidentifier.status()["reid_status"] == "ready"


def test_reid_worker_survives_an_unexpected_embedding_error() -> None:
    reidentifier = PersonReIdentifier()
    worker = AsyncReIdWorker(reidentifier)
    worker.begin_session(1)
    try:
        with patch.object(reidentifier, "embed_crop", side_effect=ValueError("bad crop")):
            assert worker.submit(
                session_id=1,
                track_id=1,
                source_track_id=1,
                crop=np.zeros((8, 8, 3), np.uint8),
                quality=1.0,
                requested_at=0.0,
            )
            deadline = monotonic() + 2.0
            results: list[Any] = []
            while not results and monotonic() < deadline:
                results = worker.poll(1)
        assert results and results[0].embedding is None
        assert worker.status()["reid_worker_alive"] is True
    finally:
        worker.close()


def test_every_processing_profile_identifies_visitors_under_auto() -> None:
    for profile in ("emergency", "compatibility", "balanced", "high_accuracy"):
        assert resolve_reid_mode("auto", profile) != "off"
    assert resolve_reid_mode("auto", "compatibility") == "quality"
    assert resolve_reid_mode("off", "balanced") == "off"


def test_a_corrupt_sex_head_disables_only_that_head(tmp_path: Path) -> None:
    corrupt = tmp_path / "sex_head_fast.npz"
    corrupt.write_bytes(b"PK\x03\x04not really a zip archive")
    estimator = SexEstimator.from_files([corrupt])
    assert estimator.status()["sex_head_errors"]


def test_a_slow_camera_start_never_blocks_reporting_or_another_cameras_stop(
    tmp_path: Path,
) -> None:
    probing, release = threading.Event(), threading.Event()

    class SlowProbePipeline(FakePipeline):
        def start(self, config: CameraStartRequest, should_continue: Any = None) -> None:
            if config.camera_id == 2:
                probing.set()
                release.wait(5)
                if should_continue is not None and not should_continue():
                    return
            super().start(config)

    registry = CameraPipelineRegistry(str(tmp_path), pipeline_factory=SlowProbePipeline)
    registry.bind_enterprise("park")
    try:
        registry.start(pipeline_config(1))
        assert registry.request_start(pipeline_config(2))
        assert probing.wait(1)
        started_at = monotonic()
        registry.establishment_live()
        assert registry.stop(1) is True
        # Stopping a camera that is still probing cancels its start.
        assert registry.stop(2) is False
        assert monotonic() - started_at < 1.0
        release.set()
        deadline = monotonic() + 2.0
        while registry._pending_starts and monotonic() < deadline:
            time.sleep(0.01)
        second = registry.pipeline(2)
        assert second is not None and not second.running
    finally:
        release.set()
        registry.close()


MANILA = ZoneInfo("Asia/Manila")
WHEN = datetime(2026, 11, 10, 2, tzinfo=UTC)
PERSON = np.array([1.0, 0.0, 0.0], np.float32)


def _door(service: EstablishmentRegistry, key: str, at: datetime, **changes: Any) -> Any:
    values: dict[str, Any] = dict(
        observation_id=key,
        camera_id=1,
        track_key=key,
        analysis_mode="entrance_exit",
        kind="entry",
        qualified=True,
        first_at=at,
        observed_at=at,
        embedding=PERSON,
    )
    values.update(changes)
    if values["kind"] == "exit":
        values.setdefault("ended_at", at)
    return service.observe(**values)


def _attached_manager(tmp_path: Path) -> tuple[Any, EstablishmentRegistry, Any]:
    manager = manager_with_store(str(tmp_path))
    manager.bind_enterprise("park", restore_session=False)
    registry = EstablishmentRegistry(str(tmp_path), "park")
    manager.use_establishment_registry(registry)
    session = processing_session(1, camera_id=1)
    manager._config, manager._active_session = session.config, session
    return manager, registry, session


def _resolved(manager: Any) -> Any:
    return manager._identity_resolver.resolve(
        [track_result(1, (50, 20, 90, 80))], monotonic(), 200, 200
    )[0]


def test_a_failed_observation_leaves_no_raw_crossing_behind(tmp_path: Path) -> None:
    manager, registry, session = _attached_manager(tmp_path)
    try:
        with (
            patch.object(registry, "observe", side_effect=RuntimeError("disk full")),
            pytest.raises(RuntimeError),
        ):
            manager._persist_count_event(session, _resolved(manager), "exit")
        with registry.database.connection() as db:
            assert db.execute("select count(*) from count_events").fetchone()[0] == 0
    finally:
        manager.close()


def test_an_attached_camera_identifies_entries_only_in_the_establishment_gallery(
    tmp_path: Path,
) -> None:
    manager, registry, session = _attached_manager(tmp_path)
    try:
        track = _resolved(manager)
        with patch.object(manager._visitor_registry, "resolve_entry") as legacy:
            decision = manager._resolve_unique_entry(session, track)
            saved = manager._persist_count_event(session, track, "entry", decision)
        legacy.assert_not_called()
        assert saved is not None and saved.business_date
        with registry.database.connection() as db:
            assert db.execute("select reid_decision from count_events").fetchone()[0] != (
                "establishment"
            )
            assert db.execute("select count(*) from establishment_observations").fetchone()[0] == 1
    finally:
        manager.close()


def test_a_lookalike_entering_soon_after_is_a_new_visitor(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    first = _door(service, "a", WHEN)
    # Same uniform, ten seconds later, while the first person is still inside.
    second = _door(service, "b", WHEN + timedelta(seconds=10))
    assert second.visitor_id != first.visitor_id


def test_a_visitor_who_left_and_returns_is_still_recognised(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    first = _door(service, "a", WHEN)
    _door(service, "a-out", WHEN + timedelta(seconds=10), kind="exit")
    returning = _door(service, "b", WHEN + timedelta(seconds=20))
    assert returning.visitor_id == first.visitor_id


def test_gallery_times_in_local_offsets_still_match_in_the_evening(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    evening = datetime(2026, 11, 10, 21, 0, tzinfo=MANILA)
    first = _door(service, "a", evening)
    _door(service, "a-out", evening + timedelta(seconds=10), kind="exit")
    assert _door(service, "b", evening + timedelta(minutes=5)).visitor_id == first.visitor_id


def test_an_uncertain_identity_from_just_before_midnight_is_settled(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    evening = datetime(2026, 11, 10, 23, 59, 30, tzinfo=MANILA)
    _door(service, "first", evening - timedelta(minutes=5))
    look = np.array([0.65, np.sqrt(1 - 0.65**2), 0.0], np.float32)
    uncertain = _door(service, "second", evening + timedelta(seconds=29), embedding=look)
    assert uncertain.identity_confidence == "low"
    assert service.finalize_pending(evening + timedelta(seconds=40))
    with service.database.connection() as db:
        status = db.execute(
            "select identity_status from visitor_identities where visitor_id=?",
            (uncertain.visitor_id,),
        ).fetchone()[0]
    assert status in {"confirmed", "merged"}


def test_an_unchanged_zone_visit_is_not_re_identified_every_checkpoint(tmp_path: Path) -> None:
    manager, registry, _session = _attached_manager(tmp_path)
    manager._area_run_id = "run"
    record = {
        "visit_id": "visit",
        "track_generation": 7,
        "qualified": True,
        "ended_at": None,
        "departure_observed": False,
        "arrival_observed": True,
        "first_inside_at": WHEN.isoformat(),
        "last_observed_at": WHEN.isoformat(),
    }
    try:
        with patch.object(registry, "observe") as observe:
            manager._save_establishment_visits([record])
            manager._save_establishment_visits([record])
            assert observe.call_count == 1
            manager._save_establishment_visits([{**record, "ended_at": WHEN.isoformat()}])
            assert observe.call_count == 2
    finally:
        manager.close()


def test_service_health_reports_the_camera_in_trouble_not_the_first_one() -> None:
    from app.camera.pipeline_manager import _representative_health

    healthy = {"counts": {"running": True}, "health": {"model_ready": True, "camera": 1}}
    stalled = {
        "counts": {"running": True},
        "health": {"model_ready": True, "reid_model_ready": False, "camera": 2},
    }
    assert _representative_health([healthy, stalled])["camera"] == 2


def test_overlay_frames_are_encoded_only_while_someone_watches(tmp_path: Path) -> None:
    manager = manager_with_store(str(tmp_path))
    try:
        assert not manager._overlay_stream_wanted()
        manager.wait_for_stream_frame((-1, 0), timeout=0)
        assert manager._overlay_stream_wanted()
        assert manager.model_status()["stream_frame_stale_ms"] is None  # nothing encoded yet
    finally:
        manager.close()


def test_alongside_path_respects_the_ends_of_straight_and_bent_paths() -> None:
    from app.counting.tripwire_counter import _alongside_path

    straight = ((0.2, 0.5), (0.6, 0.5))
    assert _alongside_path(Centroid(400, 300), straight, 1000, 1000, 6.0)
    assert not _alongside_path(Centroid(100, 300), straight, 1000, 1000, 6.0)  # before start
    assert not _alongside_path(Centroid(700, 300), straight, 1000, 1000, 6.0)  # past the end
    assert _alongside_path(Centroid(603, 300), straight, 1000, 1000, 6.0)  # within tolerance
    bent = ((0.2, 0.5), (0.4, 0.5), (0.4, 0.8))
    assert _alongside_path(Centroid(450, 600), bent, 1000, 1000, 6.0)
    assert not _alongside_path(Centroid(450, 950), bent, 1000, 1000, 6.0)
    assert not _alongside_path(Centroid(400, 500), ((0.4, 0.5),), 1000, 1000, 6.0)
    assert not _alongside_path(Centroid(400, 500), ((0.4, 0.5), (0.4, 0.5)), 1000, 1000, 6.0)


def test_a_failed_day_rebuild_is_retried_later(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    _door(service, "a", WHEN)
    repository = service.repository
    with patch.object(repository, "rebuild_day", side_effect=RuntimeError("busy")):
        with pytest.raises(RuntimeError):
            repository.rebuild_changed_days()
    assert repository.rebuild_changed_days() == 1
    assert repository.rebuild_changed_days() == 0


def test_recent_days_are_rebuilt_after_a_restart(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    _door(service, "a", WHEN)
    with patch.object(service.repository, "rebuild_day") as rebuild:
        service.repository.rebuild_recent_days(WHEN + timedelta(hours=1))
    rebuild.assert_called_once_with("2026-11-10", WHEN + timedelta(hours=1))


def test_a_doorway_cameras_estimate_counts_identified_and_unidentified_visitors(
    tmp_path: Path,
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    _door(service, "a", WHEN)
    _door(service, "b", WHEN + timedelta(minutes=1), embedding=None)
    estimate = service.repository.camera_visitor_estimate(1, "2026-11-10")
    assert estimate == {
        "estimated_unique_count": 2,
        "confirmed_unique_count": 1,
        "degraded_unique_count": 1,
        "repeat_entry_count": 0,
    }
    # Read again without any change: served from the cache, still a copy.
    estimate["estimated_unique_count"] = 99
    assert (
        service.repository.camera_visitor_estimate(1, "2026-11-10")["estimated_unique_count"] == 2
    )


def test_a_period_without_any_visitor_estimate_cannot_be_submitted(tmp_path: Path) -> None:
    from support.reports import request

    from app.storage.repositories.establishment_report_repository import (
        EstablishmentReportRepository,
    )

    service = EstablishmentRegistry(str(tmp_path), "park")
    october = datetime(2026, 10, 10, 2, tzinfo=UTC)
    # Only departures were seen, without appearance models: nobody could be estimated.
    _door(service, "out", october, kind="exit", embedding=None)
    repo = EstablishmentReportRepository(service.database)
    assert repo.period_summary("October 2026")["counting"]["identification_state"] == "unavailable"
    with pytest.raises(ValueError, match="visitor estimate is unavailable"):
        repo.submit(**request(repo, 0))
