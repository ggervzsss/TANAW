from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from app.features.realtime.contracts import RealtimeEnvelope, RealtimeEventType, RealtimeScope
from app.features.realtime.manager import RealtimeConnectionManager, RealtimeIdentity


def envelope(
    event_type: RealtimeEventType,
    *,
    scope: RealtimeScope | None = None,
    payload: dict[str, Any] | None = None,
) -> RealtimeEnvelope:
    return RealtimeEnvelope(
        event_id="evt-1",
        event_type=event_type,
        occurred_at=datetime.now(UTC),
        sequence=1,
        scope=scope or RealtimeScope(),
        payload=payload or {},
    )


def test_versioned_envelope_rejects_unknown_fields_and_invalid_sequences() -> None:
    with pytest.raises(ValidationError):
        RealtimeEnvelope.model_validate(
            {
                **envelope(RealtimeEventType.ALERT_CREATED).model_dump(),
                "password": "must-never-be-accepted",
            }
        )
    with pytest.raises(ValidationError):
        RealtimeEnvelope(
            event_id="evt-2",
            event_type=RealtimeEventType.ALERT_CREATED,
            occurred_at=datetime.now(UTC),
            sequence=0,
        )


def test_enterprise_tenant_and_recipient_scopes_are_enforced() -> None:
    identity = RealtimeIdentity(
        account_id="enterprise-account-a",
        role="enterprise",
        enterprise_account_id="enterprise-account-a",
        enterprise_id="enterprise-a",
    )
    ticket_event = envelope(
        RealtimeEventType.SUPPORT_TICKET_MESSAGE_CREATED,
        scope=RealtimeScope(
            enterprise_account_id="enterprise-account-b",
            enterprise_id="enterprise-b",
            ticket_id="ticket-b",
        ),
    )
    notification = envelope(
        RealtimeEventType.NOTIFICATION_CREATED,
        scope=RealtimeScope(recipient_account_id="enterprise-account-b"),
    )

    assert not RealtimeConnectionManager._is_authorized(identity, ticket_event, ["enterprise"])
    assert not RealtimeConnectionManager._is_authorized(identity, notification, ["enterprise"])


def test_admin_only_receives_escalated_ticket_events() -> None:
    identity = RealtimeIdentity(account_id="admin-1", role="admin")
    normal = envelope(
        RealtimeEventType.SUPPORT_TICKET_UPDATED,
        payload={"priority": "Normal"},
    )
    urgent = envelope(
        RealtimeEventType.SUPPORT_TICKET_UPDATED,
        payload={"priority": "Urgent"},
    )

    assert not RealtimeConnectionManager._is_authorized(identity, normal, ["admin"])
    assert RealtimeConnectionManager._is_authorized(identity, urgent, ["admin"])


@pytest.mark.asyncio
async def test_slow_client_queue_is_bounded_and_disconnected() -> None:
    manager = RealtimeConnectionManager(queue_size=8)
    websocket = MagicMock()
    websocket.send_json = AsyncMock()
    websocket.close = AsyncMock()
    await manager.connect(
        websocket,
        RealtimeIdentity(account_id="it-1", role="it"),
    )

    results = [
        await manager.send_protocol(websocket, {"type": "test", "index": index})
        for index in range(9)
    ]

    assert results == [True] * 8 + [False]
    websocket.close.assert_awaited_once_with(code=1013)
    assert manager.active_count == 0
