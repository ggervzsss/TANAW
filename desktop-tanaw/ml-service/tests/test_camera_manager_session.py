import tempfile
import threading
import time
import unittest
from pathlib import Path
from typing import Any, cast

import numpy as np

from app.camera.camera_manager import CameraProcessingManager, ProcessingSession
from app.config.camera_config import CameraStartRequest
from app.counting.geometry import Centroid
from app.counting.tripwire_counter import TripwireCounter
from app.detection.yolo_detector import TrackResult
from app.identity import UniqueVisitorRegistry
from app.reid import PersonReIdentifier, TrackAppearanceBuffer
from app.storage.session_store import SessionStore


class CameraProcessingManagerSessionTest(unittest.TestCase):
    def test_initial_enterprise_binding_does_not_write_unbound_retired_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            retired_database = Path(directory) / "ml-service" / "tanaw_metrics.sqlite3"
            retired_database.parent.mkdir(parents=True)
            retired_database.write_bytes(b"retired")
            manager = CameraProcessingManager(directory)

            result = manager.bind_enterprise("enterprise-a@tanaw.test", "Enterprise A")

            self.assertTrue(result["changed"])
            self.assertEqual(
                manager.enterprise_context()["enterprise_id"], "enterprise-a@tanaw.test"
            )
            self.assertEqual(retired_database.read_bytes(), b"retired")

    def test_health_status_does_not_open_an_unbound_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            retired_database = Path(directory) / "ml-service" / "tanaw_metrics.sqlite3"
            retired_database.parent.mkdir(parents=True)
            retired_database.write_bytes(b"retired")
            manager = CameraProcessingManager(directory)

            status = manager.model_status()

            self.assertEqual(status["estimated_unique_count"], 0)
            self.assertEqual(status["confirmed_unique_count"], 0)
            self.assertEqual(retired_database.read_bytes(), b"retired")

    def test_enterprise_binding_switches_session_store_scope(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = CameraProcessingManager(directory)

            first = manager.bind_enterprise("enterprise-a@tanaw.test", "Enterprise A")
            manager._session_store.append_event(_event_payload())
            second = manager.bind_enterprise("enterprise-b@tanaw.test", "Enterprise B")

            self.assertTrue(first["changed"])
            self.assertTrue(second["changed"])
            self.assertEqual(manager.metrics_summary()["entries"], 0)

    def test_prepared_counts_require_matching_enterprise_but_not_camera(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            manager._enterprise_id = "target@tanaw.test"
            manager._enterprise_name = "Target Enterprise"
            manager._session_store = SessionStore(directory, "target@tanaw.test")

            result = manager.prepare_sample_counts(
                report_id="SAMPLE-REPORT-1",
                enterprise_id="target@tanaw.test",
                enterprise_name="Target Enterprise",
                entries=20,
                exits=15,
                unique_count=12,
                peak_occupancy=8,
                period="Current Period",
            )

            self.assertEqual(result["entries"], 20)
            self.assertEqual(result["exits"], 15)
            self.assertEqual(result["enterprise_id"], "target@tanaw.test")

            with self.assertRaisesRegex(ValueError, "Desktop is bound"):
                manager.prepare_sample_counts(
                    report_id="SAMPLE-REPORT-1",
                    enterprise_id="other@tanaw.test",
                    enterprise_name="Other Enterprise",
                    entries=20,
                    exits=15,
                    unique_count=12,
                    peak_occupancy=8,
                    period="Current Period",
                )

    def test_stale_session_cannot_publish_raw_frame(self) -> None:
        manager = CameraProcessingManager()
        current_session = _session(1)
        stale_session = _session(2)

        with manager._lock:
            manager._active_session = current_session

        frame = np.zeros((8, 8, 3), dtype=np.uint8)
        manager._publish_raw_frame(stale_session, frame)

        self.assertIsNone(manager._latest_raw_frame)
        self.assertEqual(manager._latest_raw_frame_id, 0)

        manager._publish_raw_frame(current_session, frame)

        self.assertIs(manager._latest_raw_frame, frame)
        self.assertEqual(manager._latest_raw_frame_id, 1)

    def test_stale_session_cannot_replace_current_error_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = CameraProcessingManager()
            manager._session_store = SessionStore(directory)
            current_session = _session(1)
            stale_session = _session(2)

            with manager._lock:
                manager._config = current_session.config
                manager._active_session = current_session

            manager._set_session_error(stale_session, "stale failure")

            self.assertIs(manager._active_session, current_session)
            self.assertNotEqual(manager._state.status, "error")

            manager._set_session_error(current_session, "current failure")

            self.assertIsNone(manager._active_session)
            self.assertEqual(manager._state.status, "error")
            self.assertEqual(manager._state.error, "current failure")
            self.assertTrue(current_session.stop_event.is_set())

    def test_entry_event_gets_unique_visitor_decision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(1, (50, 20, 90, 180))],
                        [_track(1, (96, 20, 136, 180))],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertEqual(manager._detect_and_count(session, frame, 0.35)[0].direction, None)
            entry_track = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertEqual(entry_track.direction, "entry")
            self.assertIsNone(entry_track.is_unique_entry)
            self.assertEqual(entry_track.reid_decision, "pending")
            self.assertEqual(len(manager._pending_entry_events), 1)
            _flush_pending(manager, session)
            summary = manager.metrics_summary()
            self.assertEqual(summary["entries"], 1)
            self.assertEqual(summary["unique_count"], 1)
            self.assertEqual(summary["confirmed_unique_count"], 0)
            self.assertEqual(summary["degraded_unique_count"], 1)
            self.assertEqual(len(manager._pending_entry_events), 0)

    def test_entry_event_with_ready_embedding_commits_unique_decision_immediately(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(1, (50, 20, 90, 180))],
                        [_track(1, (96, 20, 136, 180))],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertIsNone(manager._detect_and_count(session, frame, 0.35)[0].direction)
            manager._appearance_buffer.record_sample(1, _embedding([1.0, 0.0, 0.0]), 0.95, 1)
            entry_track = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertEqual(entry_track.direction, "entry")
            self.assertTrue(entry_track.is_unique_entry)
            self.assertEqual(entry_track.reid_decision, "new")
            self.assertEqual(len(manager._pending_entry_events), 0)
            summary = manager.metrics_summary()
            self.assertEqual(summary["entries"], 1)
            self.assertEqual(summary["unique_count"], 1)
            self.assertEqual(summary["confirmed_unique_count"], 1)
            self.assertEqual(summary["degraded_unique_count"], 0)

    def test_pending_entry_resolves_when_embedding_arrives_before_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(1, (50, 20, 90, 180))],
                        [_track(1, (96, 20, 136, 180))],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertIsNone(manager._detect_and_count(session, frame, 0.35)[0].direction)
            entry_track = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertEqual(entry_track.reid_decision, "pending")
            self.assertEqual(len(manager._pending_entry_events), 1)

            manager._appearance_buffer.record_sample(1, _embedding([1.0, 0.0, 0.0]), 0.95, 2)
            manager._flush_pending_entry_events(session, time.monotonic())

            summary = manager.metrics_summary()
            self.assertEqual(len(manager._pending_entry_events), 0)
            self.assertEqual(summary["total_events"], 1)
            self.assertEqual(summary["unique_count"], 1)
            self.assertEqual(summary["confirmed_unique_count"], 1)
            self.assertEqual(summary["degraded_unique_count"], 0)

            manager._flush_pending_entry_events(session, time.monotonic() + 10.0, force=True)
            self.assertEqual(manager.metrics_summary()["total_events"], 1)

    def test_pending_entries_are_cleared_when_session_stops(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(1, (50, 20, 90, 180))],
                        [_track(1, (96, 20, 136, 180))],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertIsNone(manager._detect_and_count(session, frame, 0.35)[0].direction)
            self.assertEqual(manager._detect_and_count(session, frame, 0.35)[0].direction, "entry")
            self.assertEqual(len(manager._pending_entry_events), 1)

            manager.stop()

            self.assertEqual(len(manager._pending_entry_events), 0)
            self.assertEqual(manager.metrics_summary()["entries"], 1)

    def test_slow_entry_crossing_is_counted_through_detection_pipeline(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track_with_center(1, 80)],
                        [_track_with_center(1, 90)],
                        [_track_with_center(1, 96)],
                        [_track_with_center(1, 102)],
                        [_track_with_center(1, 108)],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            for _ in range(4):
                self.assertEqual(manager._detect_and_count(session, frame, 0.35)[0].direction, None)
            entry_track = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertEqual(entry_track.direction, "entry")
            _flush_pending(manager, session)
            self.assertEqual(manager.metrics_summary()["entries"], 1)

    def test_configured_entry_to_exit_line_sequence_counts_exit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _custom_tripwire_session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track_with_center(1, 50)],
                        [_track_with_center(1, 90)],
                        [_track_with_center(1, 150)],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._counter = _counter_for_config(session.config)
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertIsNone(manager._detect_and_count(session, frame, 0.35)[0].direction)
            pending_track = manager._detect_and_count(session, frame, 0.35)[0]
            exit_track = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertIsNone(pending_track.direction)
            self.assertEqual(exit_track.direction, "exit")
            summary = manager.metrics_summary()
            self.assertEqual(summary["entries"], 0)
            self.assertEqual(summary["exits"], 1)

    def test_configured_entry_to_exit_sequence_waits_for_center_trigger_point(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _custom_tripwire_session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(1, (20, 20, 60, 180))],
                        [_track(1, (30, 20, 90, 180))],
                        [_track(1, (80, 20, 120, 180))],
                        [_track(1, (120, 20, 160, 180))],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._counter = _counter_for_config(session.config)
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertIsNone(manager._detect_and_count(session, frame, 0.35)[0].direction)
            pending_track = manager._detect_and_count(session, frame, 0.35)[0]
            debug_state = manager._counter.debug_state(1)
            self.assertIsNotNone(debug_state)
            assert debug_state is not None
            self.assertIsNone(debug_state["pending_line"])
            self.assertIsNone(manager._detect_and_count(session, frame, 0.35)[0].direction)
            exit_track = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertIsNone(pending_track.direction)
            self.assertEqual(exit_track.direction, "exit")
            summary = manager.metrics_summary()
            self.assertEqual(summary["entries"], 0)
            self.assertEqual(summary["exits"], 1)

    def test_configured_exit_to_entry_line_sequence_counts_entry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _custom_tripwire_session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track_with_center(1, 150)],
                        [_track_with_center(1, 110)],
                        [_track_with_center(1, 50)],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._counter = _counter_for_config(session.config)
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertIsNone(manager._detect_and_count(session, frame, 0.35)[0].direction)
            pending_track = manager._detect_and_count(session, frame, 0.35)[0]
            entry_track = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertIsNone(pending_track.direction)
            self.assertEqual(entry_track.direction, "entry")
            _flush_pending(manager, session)
            summary = manager.metrics_summary()
            self.assertEqual(summary["entries"], 1)
            self.assertEqual(summary["exits"], 0)

    def test_track_with_bottom_point_outside_roi_can_count_when_centroid_is_inside(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(1, (50, 120, 90, 198))],
                        [_track(1, (96, 120, 136, 198))],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertEqual(manager._detect_and_count(session, frame, 0.35)[0].direction, None)
            entry_track = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertTrue(entry_track.inside_roi)
            self.assertEqual(entry_track.direction, "entry")
            _flush_pending(manager, session)
            self.assertEqual(manager.metrics_summary()["entries"], 1)

    def test_exit_event_skips_unique_visitor_decision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(1, (96, 20, 136, 180))],
                        [_track(1, (50, 20, 90, 180))],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertEqual(manager._detect_and_count(session, frame, 0.35)[0].direction, None)
            exit_track = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertEqual(exit_track.direction, "exit")
            self.assertIsNone(exit_track.is_unique_entry)
            self.assertIsNone(exit_track.reid_decision)
            summary = manager.metrics_summary()
            self.assertEqual(summary["exits"], 1)
            self.assertEqual(summary["unique_count"], 0)

    def test_track_outside_roi_is_not_counted_or_sampled_for_reid(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1, roi={"top": 0.1, "left": 0.65, "width": 0.25, "height": 0.8})
            reidentifier = _SpyReIdentifier()
            manager._reidentifier = cast(Any, reidentifier)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(1, (50, 20, 90, 180))],
                        [_track(1, (96, 20, 136, 180))],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            first_track = manager._detect_and_count(session, frame, 0.35)[0]
            second_track = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertFalse(first_track.inside_roi)
            self.assertFalse(first_track.counting_eligible)
            self.assertFalse(second_track.inside_roi)
            self.assertFalse(second_track.counting_eligible)
            self.assertIsNone(second_track.direction)
            self.assertEqual(reidentifier.embed_calls, 0)
            summary = manager.metrics_summary()
            self.assertEqual(summary["entries"], 0)
            self.assertEqual(summary["exits"], 0)
            self.assertEqual(summary["unique_count"], 0)

    def test_raw_id_reset_during_crossing_keeps_stable_id_and_counts_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(11, (40, 20, 80, 180))],
                        [_track(29, (88, 20, 128, 180))],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            first = manager._detect_and_count(session, frame, 0.35)[0]
            second = manager._detect_and_count(session, frame, 0.35)[0]

            self.assertEqual(first.track_id, second.track_id)
            self.assertNotEqual(first.source_track_id, second.source_track_id)
            self.assertEqual(second.direction, "entry")
            _flush_pending(manager, session)
            self.assertEqual(manager.metrics_summary()["entries"], 1)

    def test_low_confidence_track_is_kept_internal_but_not_displayed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            fake_tracker = _FakeTracker([[_track(1, (50, 20, 90, 180), confidence=0.15)]])
            manager._tracker = cast(Any, fake_tracker)
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            tracks = manager._detect_and_count(session, frame, 0.15, 0.35)

            self.assertEqual(tracks, [])
            self.assertEqual(fake_tracker.seen_confidences, [0.15])
            self.assertEqual(manager._identity_resolver.status()["identity_active_tracks"], 1)

    def test_entry_only_unique_mode_records_degraded_unique_without_reid_queue(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1, unique_counting_mode="entry_only")
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(1, (50, 20, 90, 180))],
                        [_track(1, (96, 20, 136, 180))],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertIsNone(manager._detect_and_count(session, frame, 0.15, 0.35)[0].direction)
            entry_track = manager._detect_and_count(session, frame, 0.15, 0.35)[0]
            summary = manager.metrics_summary()

            self.assertEqual(entry_track.reid_decision, "entry_only")
            self.assertEqual(len(manager._pending_entry_events), 0)
            self.assertEqual(summary["entries"], 1)
            self.assertEqual(summary["estimated_unique_count"], 1)
            self.assertEqual(summary["degraded_unique_count"], 1)

    def test_manual_occupancy_correction_updates_live_count_and_summary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            manager.bind_enterprise("enterprise-a", "Enterprise A")

            correction = manager.record_occupancy_correction(
                new_occupancy=4,
                reason="Manual doorway headcount",
                actor_name="Manager",
                camera_id=1,
            )

            self.assertEqual(correction["old_occupancy"], 0)
            self.assertEqual(correction["new_occupancy"], 4)
            self.assertEqual(manager.counts()["occupancy"], 4)
            self.assertEqual(manager.metrics_summary()["current_occupancy"], 4)

    def test_unconfirmed_detection_is_visible_only_above_configured_confidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            manager._tracker = cast(
                Any,
                _FakeTracker(
                    [
                        [_track(-1, (50, 20, 90, 180), confidence=0.20)],
                        [_track(-1, (50, 20, 90, 180), confidence=0.60)],
                    ],
                ),
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            self.assertEqual(manager._detect_and_count(session, frame, 0.35), [])
            visible = manager._detect_and_count(session, frame, 0.35)

            self.assertEqual(len(visible), 1)
            self.assertEqual(visible[0].track_id, -1)
            self.assertFalse(visible[0].counting_eligible)
            self.assertEqual(manager._identity_resolver.status()["identity_active_tracks"], 0)


def _session(session_id: int, **config_values: Any) -> ProcessingSession:
    return ProcessingSession(
        session_id=session_id,
        config=CameraStartRequest(stream_url="000", **config_values),
        stop_event=threading.Event(),
    )


def _custom_tripwire_session(session_id: int) -> ProcessingSession:
    return _session(
        session_id,
        entry_line={"start": {"x": 0.35, "y": 0.0}, "end": {"x": 0.35, "y": 1.0}},
        exit_line={"start": {"x": 0.65, "y": 0.0}, "end": {"x": 0.65, "y": 1.0}},
    )


def _counter_for_config(config: CameraStartRequest) -> TripwireCounter:
    counter = TripwireCounter(
        tripwire_position=config.tripwire_position,
        entry_line=(
            (config.entry_line.start.x, config.entry_line.start.y),
            (config.entry_line.end.x, config.entry_line.end.y),
        )
        if config.entry_line
        else None,
        exit_line=(
            (config.exit_line.start.x, config.exit_line.start.y),
            (config.exit_line.end.x, config.exit_line.end.y),
        )
        if config.exit_line
        else None,
        reverse_direction=config.reverse_direction,
    )
    counter.reset()
    return counter


def _flush_pending(manager: CameraProcessingManager, session: ProcessingSession) -> None:
    manager._flush_pending_entry_events(session, time.monotonic() + 1.0, force=True)


def _manager_with_store(directory: str) -> CameraProcessingManager:
    manager = CameraProcessingManager(directory)
    manager._session_store = SessionStore(str(Path(directory)))
    manager._visitor_registry = UniqueVisitorRegistry(manager._session_store, model_name="test")
    manager._reidentifier = PersonReIdentifier(model_path=str(Path(directory) / "missing.onnx"))
    manager._appearance_buffer = TrackAppearanceBuffer()
    manager._counter = TripwireCounter(tripwire_position=0.5)
    manager._counter.reset()
    return manager


def _track(track_id: int, bbox: tuple[int, int, int, int], confidence: float = 0.9) -> TrackResult:
    x1, y1, x2, y2 = bbox
    center = Centroid((x1 + x2) / 2, (y1 + y2) / 2)
    return TrackResult(
        track_id=track_id,
        bbox=bbox,
        confidence=confidence,
        centroid=center,
        counting_point=center,
    )


def _track_with_center(track_id: int, center_x: int, confidence: float = 0.9) -> TrackResult:
    return _track(track_id, (center_x - 20, 20, center_x + 20, 180), confidence)


def _embedding(values: list[float]) -> np.ndarray:
    embedding = np.array(values, dtype=np.float32)
    norm = float(np.linalg.norm(embedding))
    return embedding / max(norm, 1e-6)


class _FakeTracker:
    def __init__(self, responses: list[list[TrackResult]]) -> None:
        self._responses = responses
        self.seen_confidences: list[float] = []

    def track_people(self, frame: np.ndarray, confidence: float) -> list[TrackResult]:
        self.seen_confidences.append(confidence)
        return self._responses.pop(0)


class _SpyReIdentifier:
    def __init__(self) -> None:
        self.embed_calls = 0

    def embed(self, frame: np.ndarray, bbox: tuple[int, int, int, int]) -> None:
        self.embed_calls += 1
        return None


def _event_payload() -> dict[str, Any]:
    return {
        "camera_id": 1,
        "camera_name": "Test Camera",
        "counts": {"entry": 1, "exit": 0, "occupancy": 1},
        "direction": "entry",
        "track_id": 1,
    }


if __name__ == "__main__":
    unittest.main()
