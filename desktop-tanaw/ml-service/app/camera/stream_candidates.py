"""Choose a camera stream automatically from the brand and IP address.

Users enter only the brand, IP address, and credentials. TANAW tries the brand's
known stream addresses, preferring the lighter sub-stream, and keeps the first
one whose frames are large enough for reliable people detection.
"""

from collections.abc import Callable
from dataclasses import dataclass

from app.camera.auth import build_authenticated_stream_url, redact_stream_credentials

MIN_DETECTION_WIDTH = 640
MAX_PREFERRED_WIDTH = 1920

# (sub-stream, main-stream) address templates, in the order they are tried.
_BRAND_STREAMS: dict[str, list[tuple[str, str]]] = {
    "tapo": [("rtsp://{host}/stream2", "rtsp://{host}/stream1")],
    "dahua": [
        (
            "rtsp://{host}:554/cam/realmonitor?channel=1&subtype=1",
            "rtsp://{host}:554/cam/realmonitor?channel=1&subtype=0",
        )
    ],
    "tenda": [
        ("rtsp://{host}:554/ch=1?subtype=1", "rtsp://{host}:554/ch=1?subtype=0"),
        ("rtsp://{host}:8554/profile1", "rtsp://{host}:8554/profile0"),
        ("rtsp://{host}:554/ch=1&subtype=1", "rtsp://{host}:554/ch=1&subtype=0"),
        ("rtsp://{host}:554/H264?ch=1&subtype=1", "rtsp://{host}:554/H264?ch=1&subtype=0"),
    ],
}


@dataclass(frozen=True)
class StreamProbe:
    ok: bool
    message: str
    width: int | None = None
    height: int | None = None


@dataclass(frozen=True)
class StreamSelection:
    ok: bool
    message: str
    stream_url: str | None = None
    width: int | None = None
    height: int | None = None


def stream_candidates(brand: str, host: str, preferred: str | None = None) -> list[str]:
    """Credential-free addresses to try, sub-streams first.

    A previously chosen address is tried first. Custom RTSP uses only the address the
    user entered.
    """
    if brand not in _BRAND_STREAMS:
        return [preferred] if preferred else []
    sub_streams = [sub.format(host=host) for sub, _ in _BRAND_STREAMS[brand]]
    ordered = [preferred] if preferred and preferred in known_stream_addresses(brand, host) else []
    return ordered + [url for url in sub_streams if url not in ordered]


def main_stream_for(brand: str, host: str, sub_stream: str) -> str | None:
    for sub, main in _BRAND_STREAMS.get(brand, []):
        if sub.format(host=host) == sub_stream:
            return main.format(host=host)
    return None


def select_stream(
    *,
    brand: str,
    host: str,
    username: str | None,
    password: str | None,
    preferred: str | None,
    probe: Callable[[str], StreamProbe],
) -> StreamSelection:
    """Return the first working stream suitable for counting.

    A sub-stream narrower than ``MIN_DETECTION_WIDTH`` is replaced by its main
    stream when that one works. If no stream has an ideal size, the first working
    stream is still used rather than failing the connection.
    """
    fallback: StreamSelection | None = None
    last_message = "Camera stream could not be opened."
    for candidate in stream_candidates(brand, host, preferred):
        result = _probe(candidate, username, password, probe)
        if not result.ok:
            last_message = result.message
            continue
        if _suitable(result):
            return result
        fallback = fallback or result
        main = main_stream_for(brand, host, candidate)
        if main is not None and (result.width or 0) < MIN_DETECTION_WIDTH:
            upgraded = _probe(main, username, password, probe)
            if upgraded.ok and _suitable(upgraded):
                return upgraded
    if fallback is not None:
        return fallback
    return StreamSelection(False, last_message)


def _probe(
    url: str, username: str | None, password: str | None, probe: Callable[[str], StreamProbe]
) -> StreamSelection:
    result = probe(build_authenticated_stream_url(url, username, password))
    return StreamSelection(
        result.ok,
        redact_stream_credentials(result.message),
        url if result.ok else None,
        result.width,
        result.height,
    )


def _suitable(result: StreamSelection) -> bool:
    return result.width is not None and MIN_DETECTION_WIDTH <= result.width <= MAX_PREFERRED_WIDTH


def known_stream_addresses(brand: str, host: str) -> set[str]:
    """Every preset stream address for a vendor brand; empty for custom RTSP."""
    return {
        template.format(host=host) for pair in _BRAND_STREAMS.get(brand, []) for template in pair
    }
