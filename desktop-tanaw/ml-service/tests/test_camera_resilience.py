import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from app.camera.camera_manager import CameraProcessingManager, ProcessingSession
from app.camera.reconnect import (
    CameraConnectionState,
    CameraConnectionStateMachine,
    CameraFailureKind,
    CameraStreamFailure,
    InvalidCameraStateTransition,
    ReconnectPolicy,
    classify_camera_failure,
)
from app.config.camera_config import CameraStartRequest
from app.storage.session_store import SessionStore


class CameraReconnectPolicyTest(unittest.TestCase):
    def test_backoff_is_exponential_jittered_and_bounded(self) -> None:
        low = ReconnectPolicy(
            initial_delay_seconds=1,
            maximum_delay_seconds=8,
            jitter_ratio=0.25,
            random_value=lambda: 0.0,
        )
        high = ReconnectPolicy(
            initial_delay_seconds=1,
            maximum_delay_seconds=8,
            jitter_ratio=0.25,
            random_value=lambda: 1.0,
        )

        self.assertEqual(
            [low.delay_for_attempt(value) for value in range(1, 6)], [0.75, 1.5, 3, 6, 6]
        )
        self.assertEqual(
            [high.delay_for_attempt(value) for value in range(1, 6)],
            [1.25, 2.5, 5, 8, 8],
        )

    def test_state_machine_rejects_implicit_or_invalid_transitions(self) -> None:
        state = CameraConnectionStateMachine()
        with self.assertRaises(InvalidCameraStateTransition):
            state.transition(CameraConnectionState.RUNNING)

        state.transition(CameraConnectionState.CONNECTING)
        state.transition(CameraConnectionState.RUNNING)
        state.transition(CameraConnectionState.BACKOFF)
        state.transition(CameraConnectionState.CONNECTING)
        state.transition(CameraConnectionState.NONRECOVERABLE)
        state.transition(CameraConnectionState.STOPPED)

        self.assertEqual(state.state, CameraConnectionState.STOPPED)

    def test_authentication_and_configuration_errors_are_nonrecoverable(self) -> None:
        credential = classify_camera_failure(PermissionError("Camera permission denied"))
        invalid_config = classify_camera_failure(ValueError("Malformed stream URL"))
        interruption = classify_camera_failure(
            CameraStreamFailure("connection reset", reason="frame_read_timeout")
        )

        self.assertEqual(credential.kind, CameraFailureKind.NONRECOVERABLE)
        self.assertEqual(invalid_config.kind, CameraFailureKind.NONRECOVERABLE)
        self.assertEqual(interruption.kind, CameraFailureKind.RECOVERABLE)
        self.assertEqual(interruption.reason, "frame_read_timeout")


class CameraCaptureRecoveryTest(unittest.TestCase):
    def test_interrupted_stream_reconnects_without_restarting_manager(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager, session = _active_manager(directory)
            attempts = 0

            def capture_once(active_session: ProcessingSession) -> None:
                nonlocal attempts
                attempts += 1
                frame = np.zeros((8, 8, 3), dtype=np.uint8)
                manager._publish_raw_frame(active_session, frame)
                if attempts == 1:
                    raise CameraStreamFailure("connection reset", reason="frame_read_timeout")
                active_session.stop_event.set()

            with patch.object(manager, "_capture_once", side_effect=capture_once):
                manager._capture_loop(session)

            self.assertEqual(attempts, 2)
            self.assertEqual(manager._latest_raw_frame_id, 2)
            self.assertEqual(manager._connection_state.state, CameraConnectionState.RUNNING)
            coverage = manager._session_store.monitoring_coverage("month:Asia/Manila:2026-07")
            self.assertEqual(coverage["evidenceStatus"], "recorded")
            self.assertGreaterEqual(coverage["gapCount"], 1)

    def test_permanent_failure_is_actionable_and_does_not_spin(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager, session = _active_manager(directory)
            attempts = 0

            def fail_once(_active_session: ProcessingSession) -> None:
                nonlocal attempts
                attempts += 1
                raise PermissionError("Camera authentication failed")

            with patch.object(manager, "_capture_once", side_effect=fail_once):
                manager._capture_loop(session)

            self.assertEqual(attempts, 1)
            self.assertEqual(manager._state.status, "error")
            self.assertIn("requires attention", manager._state.error or "")
            self.assertEqual(
                manager._connection_state.state,
                CameraConnectionState.NONRECOVERABLE,
            )

    def test_safe_session_config_never_persists_camera_username(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = CameraProcessingManager(directory)
            manager._session_store = SessionStore(directory)
            manager._config = CameraStartRequest(
                stream_url="rtsp://camera.example.test/live",
                username="camera-admin",
                password="secret",
            )

            payload = manager._safe_config_dump()
            with manager._lock:
                manager._persist_session_locked()
            persisted = manager._session_store.load_session()

            self.assertIsNone(payload["username"])
            self.assertTrue(payload["username_redacted"])
            self.assertIsNone(payload["password"])
            self.assertTrue(payload["password_redacted"])
            assert persisted is not None
            self.assertEqual(persisted["camera_config"], payload)
            self.assertNotIn("camera-admin", str(persisted))
            self.assertNotIn("secret", str(persisted))


def _active_manager(directory: str) -> tuple[CameraProcessingManager, ProcessingSession]:
    manager = CameraProcessingManager(
        directory,
        reconnect_policy=ReconnectPolicy(
            initial_delay_seconds=0,
            maximum_delay_seconds=0,
            jitter_ratio=0,
            random_value=lambda: 0.5,
        ),
    )
    manager._session_store = SessionStore(str(Path(directory)))
    session = ProcessingSession(
        session_id=1,
        config=CameraStartRequest(stream_url="000", camera_id=1, camera_name="Entrance"),
        stop_event=threading.Event(),
        monitoring_session_id="monitoring-session-1",
    )
    with manager._lock:
        manager._active_session = session
        manager._config = session.config
        manager._connection_state.transition(CameraConnectionState.CONNECTING)
    manager._start_monitoring_coverage(session)
    return manager, session
