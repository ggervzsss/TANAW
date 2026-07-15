from __future__ import annotations

import logging
from typing import Any

import numpy as np

from app.camera.auth import build_authenticated_stream_url, redact_stream_credentials
from app.camera.reconnect import (
    CameraConnectionState,
    CameraFailureKind,
    CameraStreamFailure,
    classify_camera_failure,
)
from app.camera.runtime_types import (
    ProcessingSession,
    RuntimeState,
)
from app.camera.stream_reader import (
    build_ip_webcam_snapshot_url,
    is_mjpeg_http_stream,
    iter_mjpeg_frames,
    open_capture,
    read_http_jpeg_frame,
    validate_http_jpeg_snapshot,
    validate_stream,
)
from app.config.camera_config import CameraStartRequest

logger = logging.getLogger(__name__)


class CaptureRuntimeMixin:
    _latest_raw_frame: np.ndarray | None
    _latest_raw_frame_id: int
    _latest_raw_frame_captured_at: float | None
    _latest_stream_jpeg: bytes | None
    _latest_stream_frame_id: int

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)

    def _wait_for_clean_stream_frame(
        self, last_frame_id: int, timeout: float = 1.0
    ) -> tuple[bytes, int]:
        frame: np.ndarray | None = None
        frame_id = last_frame_id
        fallback: bytes | None = None
        with self._raw_frame_condition:
            self._raw_frame_condition.wait_for(
                lambda: self._latest_raw_frame_id > last_frame_id,
                timeout=timeout,
            )

            if self._latest_raw_frame is not None:
                frame = self._latest_raw_frame.copy()
                frame_id = self._latest_raw_frame_id

            elif self._latest_jpeg is not None:
                fallback = self._latest_jpeg

        if frame is not None:
            return self._encode_frame(frame), frame_id
        if fallback is not None:
            return fallback, last_frame_id
        return self._build_status_frame("No camera stream available."), last_frame_id

    def _capture_loop(self, session: ProcessingSession) -> None:
        if not self._is_current_session(session):
            return

        reconnect_attempt = 0
        terminal_error = False
        close_reason = "operator_stopped"
        try:
            while not session.stop_event.is_set() and self._is_current_session(session):
                try:
                    self._capture_once(session)
                    break
                except Exception as exc:
                    if session.stop_event.is_set() or not self._is_current_session(session):
                        break
                    failure = classify_camera_failure(exc)
                    safe_message = redact_stream_credentials(failure.message)
                    if failure.kind is CameraFailureKind.NONRECOVERABLE:
                        terminal_error = True
                        close_reason = failure.reason
                        self._record_coverage_gap(
                            session,
                            reason=failure.reason,
                            recoverable=False,
                            detail=safe_message,
                        )
                        with self._lock:
                            if self._is_current_session_locked(session):
                                self._connection_state.transition(
                                    CameraConnectionState.NONRECOVERABLE
                                )
                        self._set_session_error(
                            session,
                            f"Camera configuration requires attention: {safe_message}",
                        )
                        break

                    if self._connection_state.state is CameraConnectionState.RUNNING:
                        reconnect_attempt = 0
                    reconnect_attempt += 1
                    delay = self._reconnect_policy.delay_for_attempt(reconnect_attempt)
                    self._record_coverage_gap(
                        session,
                        reason=failure.reason,
                        recoverable=True,
                        detail=safe_message,
                    )
                    self._set_session_reconnecting(session, safe_message, delay)
                    if session.stop_event.wait(delay):
                        break
                    with self._lock:
                        if not self._is_current_session_locked(session):
                            break
                        self._connection_state.transition(CameraConnectionState.CONNECTING)
                        self._state.status = "connecting"
                        self._state.error = None
        finally:
            with self._lock:
                stopped_with_error = (
                    terminal_error
                    or self._connection_state.state is CameraConnectionState.NONRECOVERABLE
                )
            self._end_monitoring_coverage(
                session,
                reason=(
                    close_reason
                    if terminal_error or not stopped_with_error
                    else "processing_failure"
                ),
                error=stopped_with_error,
            )

    def _capture_once(self, session: ProcessingSession) -> None:
        config = session.config
        runtime_stream_url = self._runtime_stream_url(config)
        snapshot_url = (
            build_ip_webcam_snapshot_url(runtime_stream_url)
            if config.camera_type == "IP_WEBCAM"
            else None
        )
        if snapshot_url is not None:
            self._ip_webcam_snapshot_capture_once(session, snapshot_url)
            return
        if is_mjpeg_http_stream(runtime_stream_url):
            self._mjpeg_capture_once(session, runtime_stream_url)
            return
        self._opencv_capture_once(session, runtime_stream_url)

    def _validate_config_stream(self, config: CameraStartRequest) -> tuple[bool, str]:
        runtime_stream_url = self._runtime_stream_url(config)
        snapshot_url = (
            build_ip_webcam_snapshot_url(runtime_stream_url)
            if config.camera_type == "IP_WEBCAM"
            else None
        )
        if snapshot_url is not None:
            ok, message = validate_http_jpeg_snapshot(snapshot_url)
            return ok, redact_stream_credentials(message)

        ok, message = validate_stream(runtime_stream_url)
        return ok, redact_stream_credentials(message)

    def _runtime_stream_url(self, config: CameraStartRequest) -> str:
        return build_authenticated_stream_url(config.stream_url, config.username, config.password)

    def _ip_webcam_snapshot_capture_once(
        self, session: ProcessingSession, snapshot_url: str
    ) -> None:
        config = session.config
        failed_reads = 0
        last_error = "Camera snapshot endpoint stopped returning frames."
        frame_interval = 1.0 / self._processing_fps(config)

        while not session.stop_event.is_set() and self._is_current_session(session):
            started_at = self._monotonic()
            try:
                frame = read_http_jpeg_frame(snapshot_url)
            except Exception as exc:
                frame = None
                last_error = str(exc)
            if frame is None:
                failed_reads += 1
                if failed_reads >= 30:
                    raise CameraStreamFailure(
                        f"Camera snapshot endpoint stopped returning frames: {last_error}",
                        reason="snapshot_unavailable",
                    )
            else:
                failed_reads = 0
                frame = self._resize_for_processing(frame, self._max_frame_width(config))
                self._publish_raw_frame(session, frame)
            elapsed = self._monotonic() - started_at
            remaining = frame_interval - elapsed
            if remaining > 0:
                session.stop_event.wait(remaining)

    def _mjpeg_capture_once(self, session: ProcessingSession, stream_url: str) -> None:
        config = session.config
        for frame in iter_mjpeg_frames(stream_url, session.stop_event):
            if session.stop_event.is_set() or not self._is_current_session(session):
                return
            frame = self._resize_for_processing(frame, self._max_frame_width(config))
            self._publish_raw_frame(session, frame)
        if not session.stop_event.is_set() and self._is_current_session(session):
            raise CameraStreamFailure(
                "Camera stream stopped returning MJPEG frames.",
                reason="mjpeg_stream_ended",
            )

    def _opencv_capture_once(self, session: ProcessingSession, stream_url: str) -> None:
        config = session.config
        capture = open_capture(stream_url)
        failed_reads = 0

        try:
            if not capture.isOpened():
                raise CameraStreamFailure(
                    "Camera stream could not be opened.", reason="stream_open_failed"
                )

            while not session.stop_event.is_set() and self._is_current_session(session):
                ok, frame = capture.read()
                if not ok or frame is None:
                    failed_reads += 1
                    if failed_reads >= 90:
                        raise CameraStreamFailure(
                            "Camera stream stopped returning frames.",
                            reason="frame_read_timeout",
                        )
                    session.stop_event.wait(0.05)
                    continue

                failed_reads = 0
                frame = self._resize_for_processing(frame, self._max_frame_width(config))
                self._publish_raw_frame(session, frame)
        finally:
            capture.release()

    def _publish_raw_frame(
        self, session: ProcessingSession, frame: np.ndarray, captured_at: float | None = None
    ) -> None:
        with self._lock:
            should_mark_connected = (
                self._is_current_session_locked(session)
                and self._connection_state.state is not CameraConnectionState.RUNNING
            )
        if should_mark_connected and session.monitoring_session_id is not None:
            self._runtime_store.mark_monitoring_connected(
                session.monitoring_session_id,
                self._utc_now().isoformat(),
            )
        with self._raw_frame_condition:
            if not self._is_current_session_locked(session):
                return
            if self._connection_state.state is not CameraConnectionState.RUNNING:
                if self._connection_state.state is CameraConnectionState.STOPPED:
                    self._connection_state.transition(CameraConnectionState.CONNECTING)
                self._connection_state.transition(CameraConnectionState.RUNNING)
            self._latest_raw_frame = frame
            self._latest_raw_frame_id += 1
            self._latest_raw_frame_captured_at = (
                captured_at if captured_at is not None else self._monotonic()
            )
            self._state.status = "running"
            self._state.error = None
            self._raw_frame_condition.notify_all()

    def _set_session_reconnecting(
        self, session: ProcessingSession, message: str, delay_seconds: float
    ) -> None:
        with self._raw_frame_condition:
            if not self._is_current_session_locked(session):
                return
            self._connection_state.transition(CameraConnectionState.BACKOFF)
            safe_message = redact_stream_credentials(message)
            status_message = (
                f"Camera stream interrupted; reconnecting in {delay_seconds:.1f}s. {safe_message}"
            )
            self._state = RuntimeState(
                running=True,
                status="reconnecting",
                error=status_message,
            )
            self._latest_jpeg = self._build_status_frame(status_message)
            self._latest_stream_jpeg = self._latest_jpeg
            self._latest_stream_frame_id += 1
            self._persist_session_locked()
            self._raw_frame_condition.notify_all()
