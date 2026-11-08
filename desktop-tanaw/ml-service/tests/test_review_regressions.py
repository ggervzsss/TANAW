"""Regression coverage for the ML-service review, without cameras or model inference."""

import socket
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from time import monotonic
from unittest.mock import Mock, patch

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from test_camera_manager_session import (
    _FakeTracker,
    _flush_pending,
    _manager_with_store,
    _session,
    _track,
)
from test_open_space_integration import configuration
from test_pipeline_manager import FakePipeline, _config

from app.camera.camera_manager import CameraProcessingManager
from app.camera.capture_worker import CaptureWorker
from app.camera.frame_renderer import CameraFrameRenderer
from app.camera.pipeline_manager import CameraPipelineRegistry
from app.camera.stream_reader import open_capture
from app.config.camera_config import CameraStartRequest
from app.main import create_app
from app.storage.local_data_schema import LocalDatabaseResetRequiredError
from app.storage.local_data_store import LocalDataStore
from app.storage.session_store import SessionStore


def test_multiple_deferred_entries_are_durable_and_identity_does_not_recount(
    tmp_path: Path,
) -> None:
    manager = _manager_with_store(str(tmp_path))
    session = _session(1, camera_id=1)
    manager._config, manager._active_session = session.config, session
    manager._session_store.enterprise_occupancy()
    manager._tracker = _FakeTracker(
        [
            [_track(1, (50, 20, 90, 80)), _track(2, (50, 110, 90, 180))],
            [_track(1, (96, 20, 136, 80)), _track(2, (96, 110, 136, 180))],
        ]
    )  # type: ignore[assignment]
    try:
        with patch.object(manager, "_schedule_track_embedding"):
            for _ in range(2):
                manager._detect_and_count(session, np.zeros((200, 200, 3), dtype=np.uint8), 0.35)
        assert len(manager._pending_entry_events) == 2
        summary = manager.metrics_summary()
        assert summary["entries"] == 2
        assert summary["pending_unique_entries"] == 2
        assert summary["unique_count"] == 0
        assert summary["current_occupancy"] == 2
        _flush_pending(manager, session)
        _flush_pending(manager, session)
        summary = manager.metrics_summary()
        assert summary["entries"] == summary["unique_count"] == 2
        assert summary["pending_unique_entries"] == 0
        assert summary["current_occupancy"] == 2
    finally:
        manager.close()


def test_exit_cannot_overtake_an_entry_waiting_for_reid(tmp_path: Path) -> None:
    manager = _manager_with_store(str(tmp_path))
    manager._session_store = SessionStore(str(tmp_path), "review", camera_id=1)
    manager._session_store.enterprise_occupancy()
    session = _session(1, camera_id=1)
    manager._config, manager._active_session = session.config, session
    manager._tracker = _FakeTracker(
        [
            [_track(1, (70, 20, 110, 80))],
            [_track(1, (92, 20, 132, 80))],
            [_track(1, (70, 20, 110, 80))],
        ]
    )  # type: ignore[assignment]
    try:
        with (
            patch.object(manager, "_schedule_track_embedding"),
            patch("app.camera.camera_manager.time.monotonic", return_value=1000.0) as clock,
        ):
            for index in range(3):
                clock.return_value = 1000 + index * 0.1
                manager._detect_and_count(session, np.zeros((200, 200, 3), dtype=np.uint8), 0.35)
        assert manager._session_store.enterprise_occupancy() == 0
        _flush_pending(manager, session)
        assert manager._session_store.enterprise_occupancy() == 0
        assert manager.metrics_summary()["entries"] == manager.metrics_summary()["exits"] == 1
    finally:
        manager.close()


def _event(event_id: str, camera_id: int = 1) -> dict:
    return {
        "event_id": event_id,
        "camera_id": camera_id,
        "direction": "entry",
        "counts": {"entry": 1, "exit": 0, "occupancy": 1},
    }


def test_report_snapshot_does_not_consume_a_concurrent_crossing(tmp_path: Path) -> None:
    store = LocalDataStore(str(tmp_path), "review")
    writer = LocalDataStore(str(tmp_path), "review")
    store.append_count_event(_event("first"))
    summary = store.metrics_summary
    started, committed = threading.Event(), threading.Event()
    with ThreadPoolExecutor(max_workers=1) as pool:

        def append_later() -> None:
            started.set()
            writer.append_count_event(_event("later"))
            committed.set()

        futures = []

        def interleaved_summary(*args, **kwargs) -> dict:
            result = summary(*args, **kwargs)
            futures.append(pool.submit(append_later))
            assert started.wait(2)
            assert not committed.wait(0.05)
            return result

        with patch.object(store, "metrics_summary", side_effect=interleaved_summary):
            report = store.record_report_submission("review-report", "Current Period")
        futures[0].result(timeout=3)
    assert report["entries"] == 1
    assert report["camera_breakdown"][0]["entries"] == 1
    assert summary()["entries"] == 1
    with store._connection() as db:
        assert (
            db.execute(
                "select count(*) from count_events where submitted_report_id=?", ("review-report",)
            ).fetchone()[0]
            == 1
        )


def test_same_period_submissions_are_serialized(tmp_path: Path) -> None:
    stores = [LocalDataStore(str(tmp_path), "review") for _ in range(2)]
    stores[0].append_count_event(_event("first"))
    stores[1].metrics_summary()  # Initialize before the concurrent operations.

    def submit(index: int) -> bool:
        try:
            stores[index].record_report_submission(f"report-{index}", "Current Period")
            return True
        except ValueError:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(submit, range(2))) == [False, True]
    assert len(stores[0].list_report_submissions()) == 1


def test_pending_identity_is_frozen_when_report_is_submitted(tmp_path: Path) -> None:
    store = LocalDataStore(str(tmp_path), "review")
    store.append_count_event(
        {
            **_event("pending"),
            "is_unique_entry": False,
            "reid_decision": "pending",
            "identity_confidence": "pending",
        }
    )
    report = store.record_report_submission("report", "Current Period")
    assert report["entries"] == report["unique_count"] == 1
    assert not store.update_count_event_identity("pending", {"is_unique_entry": False})
    assert store.enterprise_occupancy() == 1


def test_fresh_manager_restores_counts_before_publishing_startup(tmp_path: Path) -> None:
    store = SessionStore(str(tmp_path), "review", camera_id=1)
    store.save_session(
        {
            "camera_id": 1,
            "running": False,
            "status": "stopped",
            "counts": {"entry": 5, "exit": 2, "occupancy": 3},
        }
    )
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    manager.bind_enterprise("review", restore_session=False)
    try:
        with (
            patch.object(manager, "_validate_config_stream", return_value=(True, "ok")),
            patch.object(manager._tracker, "warmup"),
            patch.object(threading.Thread, "start"),
        ):
            manager.start(
                CameraStartRequest(
                    camera_id=1, stream_url="rtsp://192.168.1.20/stream2", reid_mode="off"
                )
            )
        assert manager._counter.counts.entry == 5
        assert store.load_session()["counts"]["entry"] == 5
    finally:
        manager.close()


def test_start_is_rejected_during_enterprise_switch(tmp_path: Path) -> None:
    closing, release = threading.Event(), threading.Event()

    class BlockingClose(FakePipeline):
        def close(self) -> None:
            closing.set()
            assert release.wait(3)
            super().close()

    registry = CameraPipelineRegistry(str(tmp_path), pipeline_factory=BlockingClose)
    registry.bind_enterprise("A")
    registry.start(_config(1))
    with ThreadPoolExecutor(max_workers=1) as pool:
        switching = pool.submit(registry.bind_enterprise, "B")
        try:
            assert closing.wait(3)
            with pytest.raises(ValueError, match="context is changing"):
                registry.request_start(_config(2))
        finally:
            release.set()
        switching.result(timeout=3)
    assert registry.pipeline(2) is None
    registry.close()


def test_queued_start_cannot_survive_context_generation_change(tmp_path: Path) -> None:
    registry = CameraPipelineRegistry(str(tmp_path), pipeline_factory=FakePipeline)
    registry.bind_enterprise("A")
    with patch("app.camera.pipeline_manager.threading.Thread") as thread:
        registry.request_start(_config(1))
        pending_args = thread.call_args.kwargs["args"]
    registry.bind_enterprise("B")
    registry._run_requested_start(*pending_args)
    assert registry.pipeline(1) is None
    registry.close()


def test_cleanup_attempts_every_camera_and_can_retry_failure(tmp_path: Path) -> None:
    class FailsOnce(FakePipeline):
        def close(self) -> None:
            if self.camera_id == 1 and self.close_calls == 0:
                self.close_calls += 1
                raise RuntimeError("storage failure")
            super().close()

    registry = CameraPipelineRegistry(str(tmp_path), pipeline_factory=FailsOnce)
    registry.bind_enterprise("review")
    registry.start(_config(1))
    registry.start(_config(2))
    second = registry.require_pipeline(2)
    with patch.object(registry._reporting, "close") as reporting_close:
        with pytest.raises(ExceptionGroup):
            registry.close()
        reporting_close.assert_called_once()
    assert not second.running
    assert registry.pipeline(1) is not None
    assert registry.pipeline(2) is None
    registry.close()
    assert registry.pipeline(1) is None


def test_manager_disposes_reid_workers_when_stop_fails(tmp_path: Path) -> None:
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    with patch.object(manager, "stop", side_effect=RuntimeError("storage failure")):
        with pytest.raises(RuntimeError):
            manager.close()
    assert not manager._reid_worker.status()["reid_worker_alive"]
    assert not manager._quality_reid_worker.status()["reid_worker_alive"]
    manager.close()


def test_open_timeouts_are_passed_to_ffmpeg_and_open_errors_release_capture() -> None:
    capture = Mock()
    with patch("app.camera.stream_reader.cv2.VideoCapture", return_value=capture):
        assert open_capture("rtsp://192.168.1.20/stream2") is capture
    capture.open.assert_called_once_with(
        "rtsp://192.168.1.20/stream2",
        cv2.CAP_FFMPEG,
        [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000],
    )
    capture.open.side_effect = RuntimeError("backend error")
    with patch("app.camera.stream_reader.cv2.VideoCapture", return_value=capture):
        with pytest.raises(RuntimeError):
            open_capture("rtsp://192.168.1.20/stream2")
    capture.release.assert_called_once()


def test_rtsp_open_times_out_when_local_server_never_answers() -> None:
    release = threading.Event()
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        server.settimeout(3)
        with ThreadPoolExecutor(max_workers=1) as pool:

            def blackhole() -> None:
                connection, _ = server.accept()
                with connection:
                    release.wait(3)

            pending = pool.submit(blackhole)
            try:
                with (
                    patch("app.camera.stream_reader.OPEN_TIMEOUT_MS", 200),
                    patch("app.camera.stream_reader.READ_TIMEOUT_MS", 200),
                ):
                    start = monotonic()
                    capture = open_capture(f"rtsp://127.0.0.1:{server.getsockname()[1]}/stream")
                    try:
                        assert not capture.isOpened()
                        assert monotonic() - start < 3
                    finally:
                        capture.release()
            finally:
                release.set()
            pending.result(timeout=3)


def test_capture_open_exception_uses_reconnect_policy() -> None:
    session = _session(1, camera_id=1)
    notifications = []

    def reconnect(*args) -> None:
        notifications.append(args)
        session.stop_event.set()

    worker = CaptureWorker(
        CameraFrameRenderer(),
        is_current_session=lambda candidate: candidate is session,
        processing_width=lambda config: 200,
        publish_frame=lambda *args: None,
        mark_reconnecting=reconnect,
    )
    with patch("app.camera.capture_worker.open_capture", side_effect=RuntimeError("open failed")):
        worker.run(session, "rtsp://192.168.1.20/stream2")
    assert len(notifications) == 1
    assert notifications[0][1] == "open failed"


def test_runtime_totals_cache_invalidates_across_stores_and_identity_changes(
    tmp_path: Path,
) -> None:
    reader = LocalDataStore(str(tmp_path), "review")
    writer = LocalDataStore(str(tmp_path), "review")
    with patch.object(reader, "_connection", wraps=reader._connection) as connect:
        assert reader.runtime_metrics()["estimated_unique_count"] == 0
        assert reader.runtime_metrics()["estimated_unique_count"] == 0
        assert connect.call_count == 1
        writer.append_count_event(_event("one"))
        assert reader.runtime_metrics()["estimated_unique_count"] == 1
        assert connect.call_count == 2
        writer.append_count_event(
            {**_event("pending"), "is_unique_entry": False, "reid_decision": "pending"}
        )
        assert reader.runtime_metrics()["repeat_entry_count"] == 0
        writer.update_count_event_identity(
            "pending",
            {"is_unique_entry": True, "reid_decision": "new", "identity_confidence": "high"},
        )
        assert reader.runtime_metrics()["confirmed_unique_count"] == 1
        writer.record_report_submission("report", "Current Period")
        assert reader.runtime_metrics()["estimated_unique_count"] == 0


def test_websocket_database_reset_has_explicit_error_and_terminal_close(tmp_path: Path) -> None:
    registry = CameraPipelineRegistry(str(tmp_path))
    with TestClient(create_app(registry)) as client:
        with patch.object(
            registry, "camera_states", side_effect=LocalDatabaseResetRequiredError("Reset needed")
        ):
            with client.websocket_connect("/camera/ws") as socket:
                assert socket.receive_json() == {
                    "type": "service.error",
                    "code": "local_database_reset_required",
                    "message": "Reset needed",
                    "retryable": False,
                }
                with pytest.raises(WebSocketDisconnect) as error:
                    socket.receive_json()
                assert error.value.code == 4009


def test_report_failure_rolls_back_events_and_pending_identity(tmp_path: Path) -> None:
    store = LocalDataStore(str(tmp_path), "review")
    store.append_count_event(
        {**_event("pending"), "is_unique_entry": False, "reid_decision": "pending"}
    )
    original = store._record_report_submission

    def fail_after_writing(*args, **kwargs) -> None:
        original(*args, **kwargs)
        raise RuntimeError("simulated transaction failure")

    with patch.object(store, "_record_report_submission", side_effect=fail_after_writing):
        with pytest.raises(RuntimeError):
            store.record_report_submission("report", "Current Period")
    assert store.list_report_submissions() == []
    assert store.metrics_summary()["entries"] == 1
    assert store.metrics_summary()["pending_unique_entries"] == 1


def test_delayed_identity_cannot_reorder_occupancy_across_cameras(tmp_path: Path) -> None:
    manager = _manager_with_store(str(tmp_path))
    manager._session_store = SessionStore(str(tmp_path), "review", camera_id=1)
    manager._session_store.enterprise_occupancy()
    session = _session(1, camera_id=1)
    manager._config, manager._active_session = session.config, session
    manager._tracker = _FakeTracker(
        [
            [_track(1, (70, 20, 110, 80))],
            [_track(1, (92, 20, 132, 80))],
        ]
    )  # type: ignore[assignment]
    try:
        with patch.object(manager, "_schedule_track_embedding"):
            for _ in range(2):
                manager._detect_and_count(session, np.zeros((200, 200, 3), dtype=np.uint8), 0.35)
        other_camera = SessionStore(str(tmp_path), "review", camera_id=2)
        other_camera.append_event({**_event("exit", 2), "direction": "exit"})
        assert other_camera.enterprise_occupancy() == 0
        _flush_pending(manager, session)
        assert other_camera.enterprise_occupancy() == 0
    finally:
        manager.close()


def test_live_snapshot_never_uses_full_history_summaries(tmp_path: Path) -> None:
    registry = CameraPipelineRegistry(str(tmp_path))
    registry.bind_enterprise("review")
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    manager.bind_enterprise("review", restore_session=False)
    manager._config = _config(1)
    registry._pipelines[1] = manager
    try:
        with (
            patch.object(
                registry._reporting,
                "metrics_summary",
                side_effect=AssertionError("full report scan"),
            ),
            patch.object(
                manager._session_store,
                "metrics_summary",
                side_effect=AssertionError("full camera scan"),
            ),
        ):
            state = registry.camera_states()
        assert state["enterprise_occupancy"] == 0
        assert state["cameras"][0]["health"]["estimated_unique_count"] == 0
    finally:
        registry.close()


def test_area_status_read_does_not_wait_for_counting_lock(tmp_path: Path) -> None:
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    manager.bind_enterprise("review", restore_session=False)
    manager._config = configuration()
    manager._begin_area(manager._config)
    acquired, release = threading.Event(), threading.Event()

    def hold_counting_lock() -> None:
        with manager._counting_lock:
            acquired.set()
            release.wait(3)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            holding = pool.submit(hold_counting_lock)
            try:
                assert acquired.wait(3)
                snapshot = pool.submit(manager.area_state).result(timeout=1)
                assert snapshot is not None
                assert snapshot["presence"] is None
            finally:
                release.set()
            holding.result(timeout=3)
    finally:
        manager.close()


def test_capture_reconnect_uses_elapsed_time_not_ninety_failed_reads() -> None:
    session = _session(1, camera_id=1)
    capture = Mock()
    capture.read.return_value = (False, None)
    worker = CaptureWorker(
        CameraFrameRenderer(),
        is_current_session=lambda candidate: candidate is session,
        processing_width=lambda config: 200,
        publish_frame=lambda *args: None,
        mark_reconnecting=lambda *args: session.stop_event.set(),
    )
    with (
        patch("app.camera.capture_worker.open_capture", return_value=capture),
        patch("app.camera.capture_worker.monotonic", side_effect=[0, 0, 6]),
    ):
        worker.run(session, "rtsp://192.168.1.20/stream2")
    assert capture.read.call_count == 2
    capture.release.assert_called_once()
