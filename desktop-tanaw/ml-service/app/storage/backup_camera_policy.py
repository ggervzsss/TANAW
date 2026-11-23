"""Which camera settings may leave this computer in the server backup.

Only an allowlist of setup fields is copied. Usernames, passwords, runtime status,
tracking records, and any stream-address part that could hold a secret stay here:

- A vendor camera (Tapo, Tenda, Dahua) keeps its address only when it is one of
  TANAW's preset stream addresses for its host; otherwise it falls back to the
  brand's first preset, which the next connection test replaces.
- A custom RTSP camera keeps only its host and port. Its path and query are
  free-form and can carry access tokens, so they are entered again after a restore.
"""

import math
from typing import Any
from urllib.parse import urlsplit

from app.camera.stream_candidates import known_stream_addresses, stream_candidates

_BRANDS = frozenset({"tapo", "tenda", "dahua", "custom"})
_PROCESSING_PROFILES = frozenset(
    {"auto", "compatibility", "balanced", "high_accuracy", "emergency"}
)
_REID_MODES = frozenset({"auto", "off", "fast", "quality"})
_UNIQUE_MODES = frozenset({"entry_only", "estimated_reid"})
_CONNECTION_PROFILES = frozenset({"channel", "channel_ampersand", "profile", "h264", "manual"})
_OPEN_SPACE_NUMBERS = (
    "entry_confirmation_seconds",
    "exit_confirmation_seconds",
    "minimum_visit_seconds",
    "gap_grace_seconds",
    "boundary_tolerance",
)
MAX_TRIPWIRE_POINTS = 80
MAX_TRIPWIRE_SAMPLED_POINTS = 320


def backup_camera_profile(profile: dict[str, Any]) -> dict[str, Any] | None:
    """The allowlisted copy of one saved camera profile, or None when it cannot be copied."""
    camera_id = profile.get("id")
    host = profile.get("cameraHost")
    brand = profile.get("cameraBrand") or "tapo"
    if isinstance(camera_id, bool) or not isinstance(camera_id, int) or camera_id <= 0:
        return None
    if not isinstance(host, str) or not host or brand not in _BRANDS:
        return None
    stream_url = backup_stream_address(brand, host, str(profile.get("rtsp") or ""))
    if stream_url is None:
        return None
    name = _text(profile.get("name"), 120)
    if not name:
        return None
    camera: dict[str, Any] = {
        "id": camera_id,
        "name": name,
        "zone": _text(profile.get("zone"), 120) or "",
        "cameraHost": host,
        "cameraBrand": brand,
        "rtsp": stream_url,
        "processingProfile": _choice(profile.get("processingProfile"), _PROCESSING_PROFILES)
        or "auto",
        "confidence": _unit(profile.get("confidence")) or 0.35,
        "config": _config(profile.get("config")),
    }
    optional = {
        "connectionProfile": _choice(profile.get("connectionProfile"), _CONNECTION_PROFILES)
        if brand == "tenda"
        else None,
        "rtspStream": _choice(profile.get("rtspStream"), frozenset({"stream1", "stream2"})),
        "trackingConfidence": _unit(profile.get("trackingConfidence")),
        "reidMode": _choice(profile.get("reidMode"), _REID_MODES),
        "uniqueCountingMode": _choice(profile.get("uniqueCountingMode"), _UNIQUE_MODES),
        "analysisMode": _choice(
            profile.get("analysisMode"), frozenset({"entrance_exit", "open_space"})
        ),
    }
    if brand == "tapo":
        # A Tapo address is fixed by its host and stream, so the two must agree.
        optional["rtspStream"] = stream_url.rsplit("/", 1)[-1]
    camera.update({key: value for key, value in optional.items() if value is not None})
    if camera.get("analysisMode") == "open_space":
        camera["openSpace"] = _open_space(profile.get("openSpace"))
    return camera


def backup_stream_address(brand: str, host: str, stream_url: str) -> str | None:
    try:
        parsed = urlsplit(stream_url)
        port = parsed.port
    except ValueError:
        port, parsed = None, None
    if brand == "custom":
        if parsed is None or parsed.scheme != "rtsp" or parsed.hostname != host:
            return None
        return f"rtsp://{host}:{port}" if port is not None else f"rtsp://{host}"
    if stream_url in known_stream_addresses(brand, host):
        return stream_url
    candidates = stream_candidates(brand, host)
    return candidates[0] if candidates else None


def _config(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    config: dict[str, Any] = {}
    tripwire = _number(value.get("tripwire"))
    if tripwire is not None:
        config["tripwire"] = tripwire
    tripwires = value.get("tripwires")
    if isinstance(tripwires, dict):
        entry, exit_line = _line(tripwires.get("entry")), _line(tripwires.get("exit"))
        if entry is not None and exit_line is not None:
            config["tripwires"] = {"entry": entry, "exit": exit_line}
    roi = value.get("roi")
    if isinstance(roi, dict):
        region = {key: _number(roi.get(key)) for key in ("top", "left", "width", "height")}
        if all(item is not None for item in region.values()):
            config["roi"] = region
    if isinstance(value.get("reverse"), bool):
        config["reverse"] = value["reverse"]
    return config


def _line(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    start, end = _point(value.get("start")), _point(value.get("end"))
    if start is None or end is None:
        return None
    line: dict[str, Any] = {"start": start, "end": end}
    points = _points(value.get("points"), MAX_TRIPWIRE_POINTS)
    if points is not None:
        line["points"] = points
    sampled = _points(value.get("sampledPoints"), MAX_TRIPWIRE_SAMPLED_POINTS)
    if sampled is not None:
        line["sampledPoints"] = sampled
    curve = _choice(value.get("curve"), frozenset({"linear", "smooth"}))
    if curve is not None:
        line["curve"] = curve
    return line


def _open_space(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    zone_id, zone_name = _text(value.get("zone_id"), 80), _text(value.get("zone_name"), 120)
    polygon = _points(value.get("polygon"), 12)
    if not zone_id or not zone_name or polygon is None or len(polygon) < 3:
        return None
    area: dict[str, Any] = {"zone_id": zone_id, "zone_name": zone_name, "polygon": polygon}
    for key in _OPEN_SPACE_NUMBERS:
        number = _number(value.get(key))
        if number is not None:
            area[key] = number
    return area


def _points(value: Any, limit: int) -> list[dict[str, float]] | None:
    if not isinstance(value, list) or len(value) > limit:
        return None
    points = [_point(item) for item in value]
    return None if any(point is None for point in points) else points  # type: ignore[return-value]


def _point(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    x, y = _number(value.get("x")), _number(value.get("y"))
    return None if x is None or y is None else {"x": x, "y": y}


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _unit(value: Any) -> float | None:
    number = _number(value)
    return number if number is not None and 0 <= number <= 1 else None


def _choice(value: Any, allowed: frozenset[str]) -> str | None:
    return value if isinstance(value, str) and value in allowed else None


def _text(value: Any, limit: int) -> str | None:
    return value.strip()[:limit] if isinstance(value, str) else None
