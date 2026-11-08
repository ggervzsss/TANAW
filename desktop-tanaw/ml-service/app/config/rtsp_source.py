from ipaddress import IPv4Address
from typing import Any
from urllib.parse import urlsplit, urlunsplit

CAMERA_BRANDS = {"tapo", "tenda", "dahua", "custom"}
CONNECTION_PROFILES = {"channel", "channel_ampersand", "profile", "h264", "manual"}


def normalize_rtsp_source(data: dict[str, Any]) -> None:
    """Validate one credential-free endpoint for runtime requests and saved profiles."""
    stream_url = str(data.get("stream_url") or "").strip()
    if not stream_url.startswith("rtsp://"):
        raise ValueError("Stream URL must start with rtsp://.")
    if any(
        character.isspace() or ord(character) < 32 or ord(character) == 127
        for character in stream_url
    ):
        raise ValueError("Stream URL must not contain whitespace or control characters.")
    parsed = urlsplit(stream_url)
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Camera stream credentials must be supplied separately.")
    if "#" in stream_url:
        raise ValueError("Stream URL must not contain a fragment (#).")
    port = parsed.port
    if parsed.netloc.endswith(":"):
        raise ValueError("RTSP port must be between 1 and 65535.")
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("RTSP port must be between 1 and 65535.")
    raw_host = str(data.get("camera_host") or parsed.hostname or "").strip()
    try:
        camera_host = str(IPv4Address(raw_host))
        stream_host = str(IPv4Address(parsed.hostname or ""))
    except ValueError as exc:
        raise ValueError("Camera IP / Host must be a valid IPv4 address.") from exc
    if camera_host != stream_host:
        raise ValueError("Stream URL conflicts with Camera IP / Host.")

    brand = data.get("camera_brand") or "tapo"
    if not isinstance(brand, str) or brand not in CAMERA_BRANDS:
        raise ValueError("Camera brand must be tapo, tenda, dahua, or custom.")
    profile = data.get("connection_profile")
    if profile is not None and (not isinstance(profile, str) or profile not in CONNECTION_PROFILES):
        raise ValueError("Camera connection profile is invalid.")
    raw_stream = data.get("rtsp_stream")
    if raw_stream is None:
        path = parsed.path.strip("/")
        raw_stream = path if path in {"stream1", "stream2"} else "stream2"
    if not isinstance(raw_stream, str) or raw_stream not in {"stream1", "stream2"}:
        raise ValueError("RTSP Stream must be stream1 or stream2.")
    if brand == "tapo":
        canonical_url = f"rtsp://{camera_host}/{raw_stream}"
        if stream_url != canonical_url:
            raise ValueError(
                "Stream URL conflicts with Camera IP / Host and the selected RTSP Stream."
            )
    else:
        authority = f"{camera_host}:{port}" if port is not None else camera_host
        canonical_url = urlunsplit(("rtsp", authority, parsed.path, parsed.query, ""))

    data.update(
        camera_host=camera_host,
        camera_brand=brand,
        connection_profile=profile if brand == "tenda" else None,
        rtsp_stream=raw_stream,
        stream_url=canonical_url,
    )
