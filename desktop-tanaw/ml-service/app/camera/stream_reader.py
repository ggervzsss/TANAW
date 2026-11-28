import os
import time
from typing import Any

os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "16")
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|stimeout;5000000|max_delay;0|fflags;nobuffer|flags;low_delay",
)

import cv2

from app.camera.rtsp_diagnosis import FAILURE_MESSAGES, diagnose_rtsp
from app.camera.stream_candidates import StreamProbe

OPEN_TIMEOUT_MS = 5000
READ_TIMEOUT_MS = 5000


def open_capture(stream_url: str) -> Any:
    source = stream_url.strip()
    capture = cv2.VideoCapture()
    try:
        capture.open(
            source,
            cv2.CAP_FFMPEG,
            [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
                OPEN_TIMEOUT_MS,
                cv2.CAP_PROP_READ_TIMEOUT_MSEC,
                READ_TIMEOUT_MS,
            ],
        )
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        capture.release()
        raise
    return capture


def validate_stream(stream_url: str, attempts: int = 8) -> tuple[bool, str]:
    result = probe_stream(stream_url, attempts)
    return result.ok, result.message


def probe_stream(stream_url: str, attempts: int = 8) -> StreamProbe:
    """Open a stream, read one frame, and report its size."""
    try:
        capture = open_capture(stream_url)
    except Exception:
        return StreamProbe(
            False,
            "Unable to open the camera stream. Check the camera connection and try again.",
            reason="unknown",
        )
    try:
        if not capture.isOpened():
            # OpenCV cannot say why; ask the camera so the user is sent to the right field.
            reason = diagnose_rtsp(stream_url)
            return StreamProbe(False, FAILURE_MESSAGES[reason], reason=reason)

        for _ in range(attempts):
            ok, frame = capture.read()
            if ok and frame is not None:
                height, width = frame.shape[:2]
                return StreamProbe(True, "Camera stream is reachable.", int(width), int(height))
            time.sleep(0.15)

        return StreamProbe(
            False,
            "Camera stream opened, but no frames were readable within the timeout.",
            reason="unknown",
        )
    finally:
        capture.release()
