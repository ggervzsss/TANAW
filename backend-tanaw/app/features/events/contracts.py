"""Stable contracts for durable domain-event destinations."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]
type ConsumerDisposition = Literal["applied", "already_applied", "ignored"]


@dataclass(frozen=True, slots=True)
class DomainEventEnvelope:
    """Validated immutable event data exposed to destination handlers."""

    id: str
    event_key: str
    event_type: str
    contract_version: int
    schema_version: int
    aggregate_type: str
    aggregate_id: str
    aggregate_version: int
    enterprise_id: str | None
    site_id: str | None
    classification: str
    actor_account_id: str | None
    correlation_id: str | None
    causation_id: str | None
    payload: Mapping[str, JSONValue]
    payload_hash: str
    occurred_at: datetime
    recorded_at: datetime


@dataclass(frozen=True, slots=True)
class DeliveryResult:
    """Result persisted as the destination's idempotent consumer receipt."""

    disposition: ConsumerDisposition = "applied"
    result_reference: str | None = None

    def __post_init__(self) -> None:
        if self.disposition not in {"applied", "already_applied", "ignored"}:
            raise ValueError("Unsupported consumer disposition.")
        if self.result_reference is not None and len(self.result_reference) > 240:
            raise ValueError("Consumer result references cannot exceed 240 characters.")


class DomainEventDestinationHandler(Protocol):
    """A destination that must be idempotent for the supplied event key."""

    destination: str
    consumer_name: str

    async def deliver(
        self,
        *,
        db: AsyncSession,
        event: DomainEventEnvelope,
        idempotency_key: str,
    ) -> DeliveryResult: ...


class TransactionalProjection(Protocol):
    """A database projection applied in the receipt transaction."""

    consumer_name: str

    async def apply(
        self,
        *,
        db: AsyncSession,
        event: DomainEventEnvelope,
    ) -> DeliveryResult: ...


class EventBrokerPublisher(Protocol):
    """Broker boundary; implementations deduplicate on ``idempotency_key``."""

    async def publish(
        self,
        *,
        topic: str,
        event: DomainEventEnvelope,
        idempotency_key: str,
    ) -> str | None: ...


@dataclass(frozen=True, slots=True)
class ProjectionDestinationHandler:
    """Adapts an in-database projection to the delivery engine."""

    destination: str
    projection: TransactionalProjection

    @property
    def consumer_name(self) -> str:
        return self.projection.consumer_name

    async def deliver(
        self,
        *,
        db: AsyncSession,
        event: DomainEventEnvelope,
        idempotency_key: str,
    ) -> DeliveryResult:
        del idempotency_key
        return await self.projection.apply(db=db, event=event)


@dataclass(frozen=True, slots=True)
class BrokerDestinationHandler:
    """Adapts a broker topic while preserving the event key as deduplication key."""

    destination: str
    consumer_name: str
    topic: str
    publisher: EventBrokerPublisher

    async def deliver(
        self,
        *,
        db: AsyncSession,
        event: DomainEventEnvelope,
        idempotency_key: str,
    ) -> DeliveryResult:
        del db
        reference = await self.publisher.publish(
            topic=self.topic,
            event=event,
            idempotency_key=idempotency_key,
        )
        return DeliveryResult(disposition="applied", result_reference=reference)


class DomainEventDeliveryError(RuntimeError):
    """An expected destination failure with an explicit retry policy."""

    def __init__(self, message: str, *, error_code: str, retryable: bool) -> None:
        super().__init__(message)
        normalized_code = error_code.strip()
        if not normalized_code or len(normalized_code) > 120:
            raise ValueError("Delivery error codes must contain 1 to 120 characters.")
        self.error_code = normalized_code
        self.retryable = retryable
