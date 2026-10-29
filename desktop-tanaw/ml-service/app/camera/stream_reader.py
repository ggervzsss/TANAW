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
    try:
        capture = open_capture(stream_url)
    except Exception:
        return False, "Unable to open the camera stream. Check the camera connection and try again."
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
