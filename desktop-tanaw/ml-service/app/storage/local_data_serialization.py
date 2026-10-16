import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from app.config.rtsp_source import normalize_rtsp_source


@dataclass
class _MetricsBucket:
    entries: int = 0
    exits: int = 0
    unique: int = 0
    peak_occupancy: int = 0
    current_occupancy: int = 0

    def add_event(self, row: sqlite3.Row) -> None:
        direction = row["direction"]
        occupancy = _safe_int(row["occupancy_count"])
        if direction == "entry":
            self.entries += 1
            if _safe_int(row["is_unique_entry"]) == 1:
                self.unique += 1
        elif direction == "exit":
            self.exits += 1

        self.peak_occupancy = max(self.peak_occupancy, occupancy)
        self.current_occupancy = occupancy


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _load_json_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, str):
        return {}
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _normalized_camera_profile(camera: dict[str, Any]) -> dict[str, Any]:
    required_string_fields = (
        "name",
        "status",
        "zone",
        "rtsp",
        "processingProfile",
    )
    if isinstance(camera.get("id"), bool) or not isinstance(camera.get("id"), int):
        raise ValueError("Camera ID must be an integer.")
    if int(camera["id"]) <= 0:
        raise ValueError("Camera ID must be positive.")
    for field in required_string_fields:
        if not isinstance(camera.get(field), str) or not str(camera[field]).strip():
            raise ValueError(f"Camera {field} is required.")
    raw_status = str(camera["status"])
    status = (
        "running"
        if raw_status in {"starting", "connecting", "degraded", "reconnecting"}
        else "error"
        if raw_status == "failed"
        else raw_status
    )
    if status not in {"untested", "online", "offline", "running", "stopped", "error"}:
        raise ValueError("Camera status is invalid.")
    if camera.get("username") is not None or camera.get("password") is not None:
        raise ValueError("Camera credentials must not be stored in SQLite.")
    if not isinstance(camera.get("config"), dict):
        raise ValueError("Camera configuration is required.")
    stream_url = str(camera["rtsp"]).strip()
    parsed_stream_url = urlparse(stream_url)
    if parsed_stream_url.username is not None or parsed_stream_url.password is not None:
        raise ValueError("Camera stream credentials must not be stored in SQLite.")

    source = {
        "camera_host": camera.get("cameraHost"),
        "camera_brand": camera.get("cameraBrand", "tapo"),
        "connection_profile": camera.get("connectionProfile"),
        "rtsp_stream": camera.get("rtspStream"),
        "stream_url": stream_url,
    }
    normalize_rtsp_source(source)

    return {
        **camera,
        "id": int(camera["id"]),
        "status": status,
        "cameraHost": source["camera_host"],
        "cameraBrand": source["camera_brand"],
        "connectionProfile": source["connection_profile"],
        "rtspStream": source["rtsp_stream"],
        "rtsp": source["stream_url"],
        "confidence": float(camera.get("confidence") or 0.35),
        "trackingConfidence": (
            float(camera["trackingConfidence"])
            if camera.get("trackingConfidence") is not None
            else None
        ),
    }


def _camera_breakdown_row(row: sqlite3.Row) -> dict[str, Any]:
    entries = _safe_int(row["entries"])
    exits = _safe_int(row["exits"])
    return {
        "camera_id": int(row["camera_id"]) if row["camera_id"] is not None else None,
        "camera_name": row["camera_name"],
        "entries": entries,
        "exits": exits,
        "peak_occupancy": _safe_int(row["peak_occupancy"]),
        "unique_count": _safe_int(row["unique_count"]),
        "total_events": entries + exits,
    }


def _summary_with_report_metrics(
    summary: dict[str, Any], metrics: dict[str, Any]
) -> dict[str, Any]:
    entries = _safe_int(metrics.get("entries"))
    exits = min(_safe_int(metrics.get("exits")), entries)
    peak_occupancy = _safe_int(metrics.get("peak_occupancy", metrics.get("peakOccupancy")))
    unique_count = _safe_int(metrics.get("unique_count", metrics.get("uniqueCount")))
    return {
        **summary,
        "entries": entries,
        "exits": exits,
        "peak_occupancy": peak_occupancy,
        "current_occupancy": max(0, entries - exits),
        "unique_count": unique_count,
        "estimated_unique_count": unique_count,
    }


def _safe_scope(value: str | None) -> str:
    if not value:
        return "unbound"
    normalized = "".join(
        character if character.isalnum() or character in "._-" else "_"
        for character in value.strip()
    )
    return normalized[:160] or "unbound"


def _period_for_payload_rows(rows: list[sqlite3.Row]) -> str | None:
    for row in rows:
        try:
            payload = json.loads(str(row["payload_json"]))
        except (json.JSONDecodeError, TypeError):
            continue
        period = payload.get("period") if isinstance(payload, dict) else None
        if isinstance(period, str) and period.strip():
            return period
    return None


def _submitted_filter_sql(include_submitted: bool) -> str:
    return "" if include_submitted else "where submitted_report_id is null"


def _safe_int(value: Any) -> int:
    return value if isinstance(value, int) else 0


def _safe_float(value: Any) -> float | None:
    if isinstance(value, int | float):
        return float(value)
    return None


def _parse_recorded_at(value: Any) -> datetime:
    if not isinstance(value, str):
        return datetime.fromtimestamp(0, UTC)

    try:
        return _normalize_datetime(datetime.fromisoformat(value))
    except ValueError:
        return datetime.fromtimestamp(0, UTC)


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _format_hour_label(value: datetime) -> str:
    hour = value.hour % 12 or 12
    suffix = "AM" if value.hour < 12 else "PM"
    return f"{hour} {suffix}"


def _format_day_label(value: datetime) -> str:
    return value.strftime("%a")


def _format_month_day_label(value: datetime) -> str:
    return f"{value.strftime('%b')} {value.day}"


def _trend_point(label: str, bucket: _MetricsBucket) -> dict[str, int | str]:
    return {
        "label": label,
        "visitors": bucket.unique,
        "entries": bucket.entries,
        "exits": bucket.exits,
        "peak_occupancy": bucket.peak_occupancy,
        "current_occupancy": bucket.current_occupancy,
    }


def _report_submission_row(row: sqlite3.Row) -> dict[str, Any]:
    try:
        payload = json.loads(row["payload_json"]) if row["payload_json"] else {}
    except json.JSONDecodeError:
        payload = {}

    return {
        "report_id": row["report_id"],
        "submission_id": row["submission_id"],
        "period": row["period"],
        "submitted_at": row["submitted_at"],
        "entries": _safe_int(row["entries"]),
        "exits": _safe_int(row["exits"]),
        "peak_occupancy": _safe_int(row["peak_occupancy"]),
        "unique_count": _safe_int(row["unique_count"]),
        "notes": row["notes"],
        "payload": payload if isinstance(payload, dict) else {},
        "sync_status": row["sync_status"],
        "synced_at": row["synced_at"],
        "raw_purged_at": row["raw_purged_at"],
    }


def _report_draft_row(row: sqlite3.Row) -> dict[str, Any]:
    try:
        payload = json.loads(row["payload_json"]) if row["payload_json"] else {}
    except json.JSONDecodeError:
        payload = {}

    return {
        "draft_key": row["draft_key"],
        "period": row["period"],
        "report_id": row["report_id"],
        "payload": payload if isinstance(payload, dict) else {},
        "updated_at": row["updated_at"],
    }
