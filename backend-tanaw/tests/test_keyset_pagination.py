import base64
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.keyset_pagination import (
    ReadCursorError,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.core.pagination_schemas import CursorPageInfo


def test_keyset_cursor_round_trip_normalizes_uuid_and_timestamp() -> None:
    resource_id = uuid4()
    occurred_at = datetime(2026, 7, 15, 20, 30, tzinfo=UTC) + timedelta(hours=8)
    fingerprint = filter_fingerprint(
        {"role": "staff", "reportingPeriodId": str(uuid4()), "status": None}
    )

    cursor = encode_cursor(
        occurred_at=occurred_at,
        resource_id=str(resource_id),
        fingerprint=fingerprint,
    )

    decoded_at, decoded_id = decode_cursor(cursor, fingerprint=fingerprint)
    assert decoded_at == occurred_at.astimezone(UTC)
    assert decoded_id == str(resource_id)


def test_filter_fingerprint_is_canonical_and_query_bound() -> None:
    first = filter_fingerprint({"status": "submitted", "period": "period-1"})
    reordered = filter_fingerprint({"period": "period-1", "status": "submitted"})
    changed = filter_fingerprint({"period": "period-1", "status": "accepted"})

    assert first == reordered
    assert first != changed
    cursor = encode_cursor(
        occurred_at=datetime(2026, 7, 15, tzinfo=UTC),
        resource_id=str(uuid4()),
        fingerprint=first,
    )
    with pytest.raises(ReadCursorError, match="does not match"):
        decode_cursor(cursor, fingerprint=changed)


@pytest.mark.parametrize(
    "cursor",
    [
        "",
        "a" * 1025,
        "not/base64!",
        base64.urlsafe_b64encode(b"[]").decode(),
        base64.urlsafe_b64encode(b'{"filter":"x"}').decode(),
    ],
)
def test_keyset_cursor_rejects_malformed_envelopes(cursor: str) -> None:
    with pytest.raises(ReadCursorError, match="invalid"):
        decode_cursor(cursor, fingerprint="expected")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("v", 2),
        ("id", "not-a-uuid"),
        ("occurredAt", "2026-07-15T12:00:00"),
        ("occurredAt", 42),
    ],
)
def test_keyset_cursor_rejects_unsupported_or_invalid_values(field: str, value: object) -> None:
    payload: dict[str, object] = {
        "filter": "expected",
        "id": str(uuid4()),
        "occurredAt": "2026-07-15T12:00:00Z",
        "v": 1,
    }
    payload[field] = value
    cursor = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()

    with pytest.raises(ReadCursorError):
        decode_cursor(cursor, fingerprint="expected")


@pytest.mark.parametrize(
    "page",
    [
        {"limit": 1, "returnedCount": 2, "hasMore": False, "nextCursor": None},
        {"limit": 1, "returnedCount": 1, "hasMore": True, "nextCursor": None},
        {"limit": 1, "returnedCount": 1, "hasMore": False, "nextCursor": "cursor"},
        {"limit": 1, "returnedCount": 0, "hasMore": True, "nextCursor": "cursor"},
        {"limit": 1, "returnedCount": 1, "hasMore": True, "nextCursor": ""},
    ],
)
def test_cursor_page_metadata_rejects_inconsistent_state(page: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        CursorPageInfo.model_validate(page)


def test_cursor_page_metadata_accepts_terminal_and_continuing_pages() -> None:
    terminal = CursorPageInfo(limit=2, returnedCount=1, hasMore=False, nextCursor=None)
    continuing = CursorPageInfo(limit=2, returnedCount=2, hasMore=True, nextCursor="cursor")

    assert terminal.nextCursor is None
    assert continuing.hasMore is True
