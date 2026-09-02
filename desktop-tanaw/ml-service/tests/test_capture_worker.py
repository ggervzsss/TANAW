import threading
import unittest
from unittest.mock import patch

import numpy as np

from app.camera.capture_worker import CaptureWorker
from app.camera.frame_renderer import CameraFrameRenderer
from app.camera.models import ProcessingSession
from app.config.camera_config import CameraStartRequest


class _Capture:
    def __init__(self, frames: list[tuple[bool, np.ndarray | None]], opened: bool = True) -> None:
        self._frames = iter(frames)
        self._opened = opened
        self.released = False

    def isOpened(self) -> bool:
        return self._opened

    def read(self) -> tuple[bool, np.ndarray | None]:
        return next(self._frames)

    def release(self) -> None:
        self.released = True


class CaptureWorkerTest(unittest.TestCase):
    def test_publishes_frames_and_releases_capture_on_stop(self) -> None:
        stop_event = threading.Event()
        session = _session(stop_event)
        frame = np.zeros((24, 32, 3), dtype=np.uint8)
        capture = _Capture([(True, frame)])
        published: list[np.ndarray] = []

        def publish(_session: ProcessingSession, resized: np.ndarray) -> None:
            published.append(resized)
            stop_event.set()

        worker = CaptureWorker(
            CameraFrameRenderer(),
            is_current_session=lambda candidate: candidate is session,
            processing_width=lambda _config: 32,
            publish_frame=publish,
            mark_reconnecting=lambda _session, _message: None,
        )
        with patch("app.camera.capture_worker.open_capture", return_value=capture):
            worker.run(session, "rtsp://camera")

        self.assertEqual(len(published), 1)
        self.assertTrue(capture.released)

    def test_unavailable_capture_notifies_reconnect_and_stops_cleanly(self) -> None:
        stop_event = threading.Event()
        session = _session(stop_event)
        capture = _Capture([], opened=False)
        messages: list[str] = []

        def reconnect(_session: ProcessingSession, message: str) -> None:
            messages.append(message)
            stop_event.set()

        worker = CaptureWorker(
            CameraFrameRenderer(),
            is_current_session=lambda candidate: candidate is session,
            processing_width=lambda _config: 32,
            publish_frame=lambda _session, _frame: None,
            mark_reconnecting=reconnect,
        )
        with patch("app.camera.capture_worker.open_capture", return_value=capture):
            worker.run(session, "rtsp://camera")

        self.assertEqual(messages, ["Camera stream could not be opened."])
        self.assertTrue(capture.released)

    def test_reconnect_backoff_is_bounded(self) -> None:
        self.assertEqual(
            [CaptureWorker.reconnect_delay(value) for value in (1, 2, 3)], [1.0, 2.0, 4.0]
        )
        self.assertEqual(CaptureWorker.reconnect_delay(20), 15.0)


def _session(stop_event: threading.Event) -> ProcessingSession:
    return ProcessingSession(
        session_id=1,
        config=CameraStartRequest(
            camera_id=1,
            camera_name="Test Camera",
            stream_url="rtsp://192.168.1.20/stream2",
        ),
        stop_event=stop_event,
        event_scope="test",
    )


if __name__ == "__main__":
    unittest.main()
