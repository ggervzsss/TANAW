import os
import time
import urllib.request
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlparse, urlunparse

os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "16")
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|stimeout;5000000|max_delay;0|fflags;nobuffer|flags;low_delay",
)

import cv2
import numpy as np

OPEN_TIMEOUT_MS = 5000
READ_TIMEOUT_MS = 5000


def resolve_capture_source(stream_url: str) -> str | int:
    normalized = stream_url.strip()
    if normalized.isdigit():
        return int(normalized)
    return normalized


def open_capture(stream_url: str) -> Any:
    source = resolve_capture_source(stream_url)
    capture = cv2.VideoCapture()
    _configure_capture(capture)

    if _should_use_ffmpeg(source):
        capture.open(source, cv2.CAP_FFMPEG)
        if not capture.isOpened():
            capture.release()
            capture = cv2.VideoCapture()
            _configure_capture(capture)
            capture.open(source)
    else:
        capture.open(source)

    _configure_capture(capture)

    return capture


def _configure_capture(capture: Any) -> None:
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
        capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, OPEN_TIMEOUT_MS)
    if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
        capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, READ_TIMEOUT_MS)


def _should_use_ffmpeg(source: str | int) -> bool:
    if not isinstance(source, str):
        return False

    parsed = urlparse(source.strip())
    return parsed.scheme in {"rtsp", "http", "https"}


def is_mjpeg_http_stream(stream_url: str) -> bool:
    parsed = urlparse(stream_url.strip())
    return parsed.scheme in {"http", "https"}


def build_ip_webcam_snapshot_url(stream_url: str) -> str | None:
    parsed = urlparse(stream_url.strip())
    if parsed.scheme not in {"http", "https"}:
        return None

    normalized_path = parsed.path.rstrip("/")
    if normalized_path.endswith("/shot.jpg") or normalized_path == "/shot.jpg":
        return stream_url.strip()

    if normalized_path.endswith("/video"):
        next_path = f"{normalized_path.removesuffix('/video')}/shot.jpg"
        return urlunparse(parsed._replace(path=next_path))

    if normalized_path in {"", "/"}:
        return urlunparse(parsed._replace(path="/shot.jpg"))

    return None


def read_http_jpeg_frame(snapshot_url: str, timeout: float = 4.0) -> np.ndarray | None:
    request = urllib.request.Request(
        snapshot_url,
        headers={
            "Cache-Control": "no-cache",
            "Connection": "close",
            "Pragma": "no-cache",
            "User-Agent": "TANAW-ML-Service/1.0",
        },
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        jpeg_bytes = response.read()

    image = np.frombuffer(jpeg_bytes, dtype=np.uint8)
    return cv2.imdecode(image, cv2.IMREAD_COLOR)


def validate_http_jpeg_snapshot(snapshot_url: str) -> tuple[bool, str]:
    try:
        frame = read_http_jpeg_frame(snapshot_url)
    except Exception as exc:
        return False, f"Camera snapshot endpoint could not be opened: {exc}"

    if frame is None:
        return False, "Camera snapshot endpoint opened, but no JPEG frame was readable."

    return True, "Camera snapshot endpoint is reachable."


def iter_mjpeg_frames(
    stream_url: str, stop_event: Any, chunk_size: int = 8192, max_chunks: int | None = None
) -> Iterator[np.ndarray]:
    request = urllib.request.Request(
        stream_url,
        headers={
            "Connection": "close",
            "User-Agent": "TANAW-ML-Service/1.0",
        },
    )

    with urllib.request.urlopen(request, timeout=8) as response:
        buffer = b""
        max_buffer_size = 2 * 1024 * 1024

        chunks_read = 0

        while not stop_event.is_set():
            if max_chunks is not None and chunks_read >= max_chunks:
                break

            chunk = response.read(chunk_size)
            if not chunk:
                break

            chunks_read += 1
            buffer += chunk
            start = buffer.find(b"\xff\xd8")
            end = buffer.find(b"\xff\xd9", start + 2) if start != -1 else -1

            if start == -1:
                buffer = buffer[-chunk_size:]
                continue

            if end == -1:
                if len(buffer) > max_buffer_size:
                    buffer = buffer[start:]
                continue

            jpeg_bytes = buffer[start : end + 2]
            buffer = buffer[end + 2 :]
            image = np.frombuffer(jpeg_bytes, dtype=np.uint8)
            frame = cv2.imdecode(image, cv2.IMREAD_COLOR)

            if frame is not None:
                yield frame


def validate_stream(stream_url: str, attempts: int = 8) -> tuple[bool, str]:
    if is_mjpeg_http_stream(stream_url):
        try:
            for frame in iter_mjpeg_frames(stream_url, stop_event=_NeverStop(), max_chunks=256):
                if frame is not None:
                    return True, "Camera stream is reachable."
        except Exception as exc:
            return False, f"Camera stream could not be opened: {exc}"

        return False, "Camera stream opened, but no MJPEG frames were readable."

    capture = open_capture(stream_url)
    try:
        if not capture.isOpened():
            return False, _stream_open_error(stream_url)

        for _ in range(attempts):
            ok, frame = capture.read()
            if ok and frame is not None:
                return True, "Camera stream is reachable."
            time.sleep(0.15)

        return False, "Camera stream opened, but no frames were readable within the timeout."
    finally:
        capture.release()


def _stream_open_error(stream_url: str) -> str:
    parsed = urlparse(stream_url.strip())
    if parsed.scheme == "rtsp":
        return "RTSP camera stream could not be opened. Check the camera IP, RTSP path, username/password, and that RTSP is enabled on the camera."

    return "Camera stream could not be opened."


class _NeverStop:
    def is_set(self) -> bool:
        return False
