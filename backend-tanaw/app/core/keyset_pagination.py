"""Opaque, filter-bound keyset cursors shared by reporting readers."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID


class ReadCursorError(ValueError):
    """Raised when an opaque read cursor is malformed or belongs to other filters."""


def filter_fingerprint(filters: dict[str, str | None]) -> str:
    canonical = json.dumps(filters, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


def encode_cursor(*, occurred_at: datetime, resource_id: str, fingerprint: str) -> str:
    payload = {
        "filter": fingerprint,
        "id": str(UUID(resource_id)),
        "occurredAt": _as_utc(occurred_at).isoformat().replace("+00:00", "Z"),
        "v": 1,
    }
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def decode_cursor(cursor: str, *, fingerprint: str) -> tuple[datetime, str]:
    if not cursor or len(cursor) > 1024:
        raise ReadCursorError("The pagination cursor is invalid.")
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.b64decode(padded, altchars=b"-_", validate=True))
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReadCursorError("The pagination cursor is invalid.") from exc
    if not isinstance(payload, dict) or set(payload) != {"filter", "id", "occurredAt", "v"}:
        raise ReadCursorError("The pagination cursor is invalid.")
    if payload.get("v") != 1 or payload.get("filter") != fingerprint:
        raise ReadCursorError("The pagination cursor does not match this query.")
    occurred_at_raw = payload.get("occurredAt")
    resource_id_raw = payload.get("id")
    if not isinstance(occurred_at_raw, str) or not isinstance(resource_id_raw, str):
        raise ReadCursorError("The pagination cursor is invalid.")
    try:
        occurred_at = datetime.fromisoformat(occurred_at_raw.replace("Z", "+00:00"))
        resource_id = str(UUID(resource_id_raw))
        return _as_utc(occurred_at), resource_id
    except (ValueError, TypeError) as exc:
        raise ReadCursorError("The pagination cursor is invalid.") from exc


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ReadCursorError("The pagination cursor timestamp must include a UTC offset.")
    return value.astimezone(UTC)
