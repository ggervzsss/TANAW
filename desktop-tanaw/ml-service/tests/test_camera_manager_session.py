import tempfile
import threading
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

            result = manager.prepare_mock_counts(
                mock_run_id="run-1",
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
                manager.prepare_mock_counts(
                    mock_run_id="run-1",
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
            self.assertTrue(entry_track.is_unique_entry)
            self.assertEqual(entry_track.reid_decision, "degraded_no_embedding")
            summary = manager.metrics_summary()
            self.assertEqual(summary["entries"], 1)
            self.assertEqual(summary["unique_count"], 1)

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
            self.assertEqual(manager.metrics_summary()["entries"], 1)

    def test_low_confidence_track_is_kept_internal_but_not_displayed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = _manager_with_store(directory)
            session = _session(1)
            manager._tracker = cast(
                Any, _FakeTracker([[_track(1, (50, 20, 90, 180), confidence=0.15)]])
            )
            with manager._lock:
                manager._config = session.config
                manager._active_session = session

            frame = np.zeros((200, 200, 3), dtype=np.uint8)
            tracks = manager._detect_and_count(session, frame, 0.35)

            self.assertEqual(tracks, [])
            self.assertEqual(manager._identity_resolver.status()["identity_active_tracks"], 1)

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
    return TrackResult(
        track_id=track_id,
        bbox=bbox,
        confidence=confidence,
        centroid=Centroid((x1 + x2) / 2, (y1 + y2) / 2),
        counting_point=Centroid((x1 + x2) / 2, y2),
    )


class _FakeTracker:
    def __init__(self, responses: list[list[TrackResult]]) -> None:
        self._responses = responses

    def track_people(self, frame: np.ndarray, confidence: float) -> list[TrackResult]:
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
