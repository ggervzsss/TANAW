from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.telemetry.envelopes import canonical_payload_hash, canonical_payload_json

_OPERATIONAL_RESOURCE_EVENTS = {
    "operational_alert.created.v2",
    "operational_alert.updated.v2",
    "operational_alert.resolved.v2",
    "user_notification.created.v2",
    "user_notification.updated.v2",
    "activity_log.created.v2",
}


async def enqueue_operational_resource_event(
    db: AsyncSession,
    *,
    event_type: str,
    aggregate_type: str,
    aggregate_id: str,
    aggregate_version: int,
    payload: dict[str, object],
    actor_account_id: str | None,
    enterprise_id: str | None = None,
) -> DomainEvent:
    """Record one resource invalidation in the caller's transaction."""

    if event_type not in _OPERATIONAL_RESOURCE_EVENTS:
        raise ValueError(f"Unsupported operational resource event type: {event_type}")
    if aggregate_version < 1:
        raise ValueError("Operational resource event versions must be positive.")
    occurred_at = datetime.now(UTC)
    event_id = str(uuid4())
    event_payload = {
        "contractVersion": 2,
        "eventType": event_type,
        **payload,
    }
    event = DomainEvent(
        id=event_id,
        event_key=f"{event_type}:{aggregate_id}:{event_id}",
        event_type=event_type,
        contract_version=2,
        schema_version=1,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        aggregate_version=aggregate_version,
        enterprise_id=enterprise_id,
        site_id=None,
        classification="official",
        actor_account_id=actor_account_id,
        correlation_id=None,
        causation_id=None,
        payload_json=canonical_payload_json(event_payload),
        payload_hash=canonical_payload_hash(event_payload),
        occurred_at=occurred_at,
        available_at=occurred_at,
        retention_expires_at=None,
    )
    db.add(event)
    await db.flush([event])
    db.add(
        DomainEventDelivery(
            id=str(uuid4()),
            domain_event_id=event.id,
            destination="realtime_broadcast",
            status="pending",
            attempt_count=0,
            next_attempt_at=occurred_at,
        )
    )
    return event
