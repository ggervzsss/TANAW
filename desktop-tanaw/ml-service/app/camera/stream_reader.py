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

OPEN_TIMEOUT_MS = 5000
READ_TIMEOUT_MS = 5000


def open_capture(stream_url: str) -> Any:
    source = stream_url.strip()
    capture = cv2.VideoCapture()
    _configure_capture(capture)

    capture.open(source, cv2.CAP_FFMPEG)
    if not capture.isOpened():
        capture.release()
        capture = cv2.VideoCapture()
        _configure_capture(capture)
        capture.open(source)

    _configure_capture(capture)

    return capture


def _configure_capture(capture: Any) -> None:
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
        capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, OPEN_TIMEOUT_MS)
    if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
        capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, READ_TIMEOUT_MS)


def validate_stream(stream_url: str, attempts: int = 8) -> tuple[bool, str]:
    capture = open_capture(stream_url)
    try:
        if not capture.isOpened():
            return (
                False,
                "RTSP camera stream could not be opened. Check the camera IP, RTSP path, username/password, and that RTSP is enabled on the camera.",
            )

        for _ in range(attempts):
            ok, frame = capture.read()
            if ok and frame is not None:
                return True, "Camera stream is reachable."
            time.sleep(0.15)

        return False, "Camera stream opened, but no frames were readable within the timeout."
    finally:
        capture.release()
