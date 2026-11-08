from collections.abc import Callable
from time import monotonic
from typing import Any

import numpy as np

from app.camera.frame_renderer import CameraFrameRenderer
from app.camera.models import ProcessingSession
from app.camera.stream_reader import open_capture
from app.config.camera_config import CameraStartRequest

RECONNECT_MAX_DELAY_SECONDS = 15.0
FAILED_READ_GRACE_SECONDS = 5.0


class CaptureWorker:
    """Owns the OpenCV capture/reconnect loop, but not camera session state or locks."""

    def __init__(
        self,
        frame_renderer: CameraFrameRenderer,
        *,
        is_current_session: Callable[[ProcessingSession], bool],
        processing_width: Callable[[CameraStartRequest], int],
        publish_frame: Callable[[ProcessingSession, np.ndarray], None],
        mark_reconnecting: Callable[[ProcessingSession, str], None],
    ) -> None:
        self._frame_renderer = frame_renderer
        self._is_current_session = is_current_session
        self._processing_width = processing_width
        self._publish_frame = publish_frame
        self._mark_reconnecting = mark_reconnecting

    def run(self, session: ProcessingSession, stream_url: str) -> None:
        reconnect_attempt = 0
        while not session.stop_event.is_set() and self._is_current_session(session):
            capture: Any | None = None
            failed_since: float | None = None
            reconnect_message = "Camera stream could not be opened."
            try:
                capture = open_capture(stream_url)
                if capture.isOpened():
                    while not session.stop_event.is_set() and self._is_current_session(session):
                        ok, frame = capture.read()
                        if not ok or frame is None:
                            failed_since = failed_since if failed_since is not None else monotonic()
                            if monotonic() - failed_since >= FAILED_READ_GRACE_SECONDS:
                                reconnect_message = "Camera stream stopped returning frames."
                                break
                            session.stop_event.wait(0.05)
                            continue

                        failed_since = None
                        reconnect_attempt = 0
                        resized = self._frame_renderer.resize_for_processing(
                            frame, self._processing_width(session.config)
                        )
                        self._publish_frame(session, resized)
            except Exception as exc:
                reconnect_message = str(exc)
            finally:
                if capture is not None:
                    capture.release()

            if session.stop_event.is_set() or not self._is_current_session(session):
                return
            reconnect_attempt += 1
            self._mark_reconnecting(session, reconnect_message)
            if session.stop_event.wait(self.reconnect_delay(reconnect_attempt)):
                return

    @staticmethod
    def reconnect_delay(attempt: int) -> float:
        return float(min(2 ** max(0, attempt - 1), RECONNECT_MAX_DELAY_SECONDS))
