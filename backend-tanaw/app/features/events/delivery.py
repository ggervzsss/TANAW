"""PostgreSQL-safe leasing and state transitions for domain-event delivery."""

import hashlib
import json
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import cast
from uuid import uuid4

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.operational_observability import OperationalCounter, operational_observability
from app.features.events.contracts import (
    DeliveryResult,
    DomainEventDeliveryError,
    DomainEventDestinationHandler,
    DomainEventEnvelope,
    JSONValue,
)
from app.features.events.models import (
    DomainEvent,
    DomainEventConsumerReceipt,
    DomainEventDelivery,
    DomainEventDeliveryAttempt,
)

logger = logging.getLogger("uvicorn.error")


class DispatchOutcome(StrEnum):
    DELIVERED = "delivered"
    RETRY_SCHEDULED = "retry_scheduled"
    DEAD_LETTERED = "dead_lettered"
    STALE_CLAIM = "stale_claim"


@dataclass(frozen=True, slots=True)
class DeliveryEngineConfig:
    batch_size: int = 20
    lease_duration: timedelta = timedelta(seconds=60)
    max_attempts: int = 8
    base_backoff: timedelta = timedelta(seconds=1)
    max_backoff: timedelta = timedelta(minutes=5)
    jitter_ratio: float = 0.2

    def __post_init__(self) -> None:
        if not 1 <= self.batch_size <= 500:
            raise ValueError("Domain-event batch size must be between 1 and 500.")
        if self.lease_duration <= timedelta(0):
            raise ValueError("Domain-event lease duration must be positive.")
        if not 1 <= self.max_attempts <= 100:
            raise ValueError("Domain-event max attempts must be between 1 and 100.")
        if self.base_backoff <= timedelta(0) or self.max_backoff < self.base_backoff:
            raise ValueError("Domain-event backoff bounds are invalid.")
        if not 0 <= self.jitter_ratio <= 1:
            raise ValueError("Domain-event jitter ratio must be between 0 and 1.")


@dataclass(frozen=True, slots=True)
class DeliveryClaim:
    delivery_id: str
    domain_event_id: str
    destination: str
    lock_token: str
    attempt_number: int
    locked_at: datetime


@dataclass(frozen=True, slots=True)
class ClaimBatch:
    claims: tuple[DeliveryClaim, ...]
    recovered_leases: int = 0
    recovered_to_dead_letter: int = 0


@dataclass(frozen=True, slots=True)
class DeliveryBatchResult:
    claimed: int
    delivered: int
    retry_scheduled: int
    dead_lettered: int
    stale_claims: int
    recovered_leases: int


@dataclass(frozen=True, slots=True)
class DeliveryQueueMetrics:
    pending: int
    leased: int
    retry_scheduled: int
    delivered: int
    dead_letter: int
    oldest_pending_at: datetime | None
    oldest_ready_at: datetime | None
    oldest_lease_expiry_at: datetime | None


class DomainEventDeliveryEngine:
    """Claims delivery rows and commits one immutable attempt per completed claim."""

    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        handlers: Iterable[DomainEventDestinationHandler],
        worker_id: str,
        config: DeliveryEngineConfig | None = None,
    ) -> None:
        normalized_worker_id = worker_id.strip()
        if not normalized_worker_id or len(normalized_worker_id) > 120:
            raise ValueError("Domain-event worker IDs must contain 1 to 120 characters.")
        self._sessions = sessions
        self.worker_id = normalized_worker_id
        self.config = config or DeliveryEngineConfig()
        self._handlers = _handler_registry(handlers)

    async def claim_batch(self, *, now: datetime | None = None) -> ClaimBatch:
        claimed_at = _as_utc(now or datetime.now(UTC))
        lease_expires_at = claimed_at + self.config.lease_duration
        recovered_leases = 0
        recovered_to_dead_letter = 0
        claims: list[DeliveryClaim] = []

        async with self._sessions() as db, db.begin():
            deliveries = list(
                await db.scalars(
                    select(DomainEventDelivery)
                    .join(DomainEvent, DomainEvent.id == DomainEventDelivery.domain_event_id)
                    .where(
                        DomainEvent.available_at <= claimed_at,
                        DomainEventDelivery.destination.in_(tuple(self._handlers)),
                        or_(
                            and_(
                                DomainEventDelivery.status.in_(("pending", "retry_scheduled")),
                                DomainEventDelivery.next_attempt_at <= claimed_at,
                            ),
                            and_(
                                DomainEventDelivery.status == "leased",
                                DomainEventDelivery.lock_expires_at <= claimed_at,
                            ),
                        ),
                    )
                    .order_by(
                        DomainEventDelivery.next_attempt_at.asc(),
                        DomainEventDelivery.created_at.asc(),
                    )
                    .with_for_update(skip_locked=True)
                    .limit(self.config.batch_size)
                )
            )
            for delivery in deliveries:
                if delivery.status == "leased":
                    recovered_leases += 1
                    terminal = delivery.attempt_count >= self.config.max_attempts
                    db.add(
                        _attempt(
                            delivery,
                            worker_id=self.worker_id,
                            outcome="terminal_failure" if terminal else "retryable_failure",
                            error_code=(
                                "lease_expired_attempt_limit" if terminal else "lease_expired"
                            ),
                            error_message="The prior worker did not finish before its lease expired.",
                            started_at=delivery.locked_at or claimed_at,
                            completed_at=claimed_at,
                        )
                    )
                    if terminal:
                        _dead_letter(
                            delivery,
                            now=claimed_at,
                            error_code="lease_expired_attempt_limit",
                            error_message=(
                                "The delivery reached its attempt limit while recovering an "
                                "expired worker lease."
                            ),
                        )
                        recovered_to_dead_letter += 1
                        continue

                lock_token = str(uuid4())
                delivery.status = "leased"
                delivery.attempt_count += 1
                delivery.lock_token = lock_token
                delivery.locked_at = claimed_at
                delivery.lock_expires_at = lease_expires_at
                delivery.delivered_at = None
                delivery.dead_lettered_at = None
                claims.append(
                    DeliveryClaim(
                        delivery_id=delivery.id,
                        domain_event_id=delivery.domain_event_id,
                        destination=delivery.destination,
                        lock_token=lock_token,
                        attempt_number=delivery.attempt_count,
                        locked_at=claimed_at,
                    )
                )

        return ClaimBatch(
            claims=tuple(claims),
            recovered_leases=recovered_leases,
            recovered_to_dead_letter=recovered_to_dead_letter,
        )

    async def dispatch_claim(
        self,
        claim: DeliveryClaim,
        *,
        now: datetime | None = None,
    ) -> DispatchOutcome:
        checked_at = _as_utc(now or datetime.now(UTC))
        try:
            async with self._sessions() as db, db.begin():
                row = await db.execute(
                    select(DomainEventDelivery, DomainEvent)
                    .join(DomainEvent, DomainEvent.id == DomainEventDelivery.domain_event_id)
                    .where(
                        DomainEventDelivery.id == claim.delivery_id,
                        DomainEventDelivery.domain_event_id == claim.domain_event_id,
                        DomainEventDelivery.destination == claim.destination,
                        DomainEventDelivery.status == "leased",
                        DomainEventDelivery.lock_token == claim.lock_token,
                        DomainEventDelivery.lock_expires_at > checked_at,
                    )
                    .with_for_update()
                )
                claimed_row = row.one_or_none()
                if claimed_row is None:
                    return DispatchOutcome.STALE_CLAIM
                delivery, event = claimed_row
                envelope = _validated_envelope(event)
                handler = self._handlers.get(delivery.destination)
                if handler is None:
                    raise DomainEventDeliveryError(
                        f"No destination handler is registered for {delivery.destination!r}.",
                        error_code="destination_unavailable",
                        retryable=True,
                    )

                receipt = await db.scalar(
                    select(DomainEventConsumerReceipt).where(
                        DomainEventConsumerReceipt.domain_event_id == event.id,
                        DomainEventConsumerReceipt.consumer_name == handler.consumer_name,
                    )
                )
                if receipt is not None:
                    operational_observability.increment(
                        OperationalCounter.DOMAIN_EVENT_CONSUMER_DEDUPLICATION
                    )
                    if receipt.event_payload_hash != event.payload_hash:
                        raise DomainEventDeliveryError(
                            "The existing consumer receipt has a different event payload hash.",
                            error_code="consumer_receipt_hash_mismatch",
                            retryable=False,
                        )
                else:
                    result = await handler.deliver(
                        db=db,
                        event=envelope,
                        idempotency_key=event.event_key,
                    )
                    _validate_result(result)
                    db.add(
                        DomainEventConsumerReceipt(
                            id=str(uuid4()),
                            domain_event_id=event.id,
                            consumer_name=handler.consumer_name,
                            disposition=result.disposition,
                            event_payload_hash=event.payload_hash,
                            consumed_at=_completion_time(now, claim.locked_at),
                            result_reference=result.result_reference,
                        )
                    )

                completed_at = _completion_time(now, claim.locked_at)
                delivery.status = "delivered"
                delivery.delivered_at = completed_at
                delivery.dead_lettered_at = None
                delivery.last_error_code = None
                delivery.last_error_message = None
                _release_lease(delivery)
                db.add(
                    _attempt(
                        delivery,
                        worker_id=self.worker_id,
                        outcome="succeeded",
                        started_at=claim.locked_at,
                        completed_at=completed_at,
                    )
                )
                operational_observability.observe_domain_event_publish_lag(
                    available_at=event.available_at,
                    delivered_at=completed_at,
                )
            return DispatchOutcome.DELIVERED
        except DomainEventDeliveryError as exc:
            return await self._record_failure(
                claim,
                retryable=exc.retryable,
                error_code=exc.error_code,
                error_message=str(exc),
                completed_at=_completion_time(now, claim.locked_at),
            )
        except Exception:
            logger.exception(
                "Unexpected domain-event delivery failure delivery_id=%s destination=%s",
                claim.delivery_id,
                claim.destination,
            )
            return await self._record_failure(
                claim,
                retryable=True,
                error_code="internal_error",
                error_message="TANAW could not complete the domain-event destination.",
                completed_at=_completion_time(now, claim.locked_at),
            )

    async def run_batch(self, *, now: datetime | None = None) -> DeliveryBatchResult:
        batch = await self.claim_batch(now=now)
        outcomes: list[DispatchOutcome] = []
        for claim in batch.claims:
            outcomes.append(await self.dispatch_claim(claim, now=now))
        return DeliveryBatchResult(
            claimed=len(batch.claims),
            delivered=outcomes.count(DispatchOutcome.DELIVERED),
            retry_scheduled=outcomes.count(DispatchOutcome.RETRY_SCHEDULED),
            dead_lettered=(
                outcomes.count(DispatchOutcome.DEAD_LETTERED) + batch.recovered_to_dead_letter
            ),
            stale_claims=outcomes.count(DispatchOutcome.STALE_CLAIM),
            recovered_leases=batch.recovered_leases,
        )

    async def _record_failure(
        self,
        claim: DeliveryClaim,
        *,
        retryable: bool,
        error_code: str,
        error_message: str,
        completed_at: datetime,
    ) -> DispatchOutcome:
        async with self._sessions() as db, db.begin():
            delivery = await db.scalar(
                select(DomainEventDelivery)
                .where(
                    DomainEventDelivery.id == claim.delivery_id,
                    DomainEventDelivery.domain_event_id == claim.domain_event_id,
                    DomainEventDelivery.destination == claim.destination,
                    DomainEventDelivery.status == "leased",
                    DomainEventDelivery.lock_token == claim.lock_token,
                    DomainEventDelivery.lock_expires_at > completed_at,
                )
                .with_for_update()
            )
            if delivery is None:
                return DispatchOutcome.STALE_CLAIM

            terminal = not retryable or delivery.attempt_count >= self.config.max_attempts
            db.add(
                _attempt(
                    delivery,
                    worker_id=self.worker_id,
                    outcome="terminal_failure" if terminal else "retryable_failure",
                    error_code=error_code,
                    error_message=error_message,
                    started_at=claim.locked_at,
                    completed_at=completed_at,
                )
            )
            if terminal:
                _dead_letter(
                    delivery,
                    now=completed_at,
                    error_code=error_code,
                    error_message=error_message,
                )
                return DispatchOutcome.DEAD_LETTERED

            delivery.status = "retry_scheduled"
            delivery.next_attempt_at = completed_at + _retry_delay(
                delivery.id,
                delivery.attempt_count,
                self.config,
            )
            delivery.delivered_at = None
            delivery.dead_lettered_at = None
            delivery.last_error_code = error_code[:120]
            delivery.last_error_message = error_message[:2000]
            _release_lease(delivery)
            return DispatchOutcome.RETRY_SCHEDULED


async def read_delivery_queue_metrics(
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> DeliveryQueueMetrics:
    observed_at = _as_utc(now or datetime.now(UTC))
    count_rows = (
        await db.execute(
            select(DomainEventDelivery.status, func.count()).group_by(DomainEventDelivery.status)
        )
    ).all()
    counts: dict[str, int] = {status: int(count) for status, count in count_rows}
    oldest_ready_at = await db.scalar(
        select(func.min(DomainEventDelivery.next_attempt_at)).where(
            DomainEventDelivery.status.in_(("pending", "retry_scheduled")),
            DomainEventDelivery.next_attempt_at <= observed_at,
        )
    )
    oldest_pending_at = await db.scalar(
        select(func.min(DomainEventDelivery.created_at)).where(
            DomainEventDelivery.status.in_(("pending", "leased", "retry_scheduled"))
        )
    )
    oldest_lease_expiry_at = await db.scalar(
        select(func.min(DomainEventDelivery.lock_expires_at)).where(
            DomainEventDelivery.status == "leased"
        )
    )
    return DeliveryQueueMetrics(
        pending=int(counts.get("pending", 0)),
        leased=int(counts.get("leased", 0)),
        retry_scheduled=int(counts.get("retry_scheduled", 0)),
        delivered=int(counts.get("delivered", 0)),
        dead_letter=int(counts.get("dead_letter", 0)),
        oldest_pending_at=oldest_pending_at,
        oldest_ready_at=oldest_ready_at,
        oldest_lease_expiry_at=oldest_lease_expiry_at,
    )


def _handler_registry(
    handlers: Iterable[DomainEventDestinationHandler],
) -> dict[str, DomainEventDestinationHandler]:
    registry: dict[str, DomainEventDestinationHandler] = {}
    consumer_names: set[str] = set()
    for handler in handlers:
        destination = handler.destination.strip()
        consumer_name = handler.consumer_name.strip()
        if not destination or len(destination) > 120:
            raise ValueError("Event destinations must contain 1 to 120 characters.")
        if not consumer_name or len(consumer_name) > 120:
            raise ValueError("Event consumer names must contain 1 to 120 characters.")
        if destination in registry:
            raise ValueError(f"Duplicate event destination handler: {destination}.")
        if consumer_name in consumer_names:
            raise ValueError(f"Duplicate event consumer name: {consumer_name}.")
        registry[destination] = handler
        consumer_names.add(consumer_name)
    return registry


def _validated_envelope(event: DomainEvent) -> DomainEventEnvelope:
    try:
        raw_payload = json.loads(event.payload_json, parse_constant=_reject_json_constant)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise DomainEventDeliveryError(
            "The stored domain-event payload is not valid JSON.",
            error_code="invalid_event_payload",
            retryable=False,
        ) from exc
    if not isinstance(raw_payload, dict) or not all(isinstance(key, str) for key in raw_payload):
        raise DomainEventDeliveryError(
            "The stored domain-event payload must be a JSON object.",
            error_code="invalid_event_payload",
            retryable=False,
        )
    payload = cast(dict[str, JSONValue], raw_payload)
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    actual_hash = f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"
    if actual_hash != event.payload_hash:
        raise DomainEventDeliveryError(
            "The stored domain-event payload does not match its immutable hash.",
            error_code="event_payload_hash_mismatch",
            retryable=False,
        )
    return DomainEventEnvelope(
        id=event.id,
        event_key=event.event_key,
        event_type=event.event_type,
        contract_version=event.contract_version,
        schema_version=event.schema_version,
        aggregate_type=event.aggregate_type,
        aggregate_id=event.aggregate_id,
        aggregate_version=event.aggregate_version,
        enterprise_id=event.enterprise_id,
        site_id=event.site_id,
        classification=event.classification,
        actor_account_id=event.actor_account_id,
        correlation_id=event.correlation_id,
        causation_id=event.causation_id,
        payload=payload,
        payload_hash=event.payload_hash,
        occurred_at=event.occurred_at,
        recorded_at=event.recorded_at,
    )


def _attempt(
    delivery: DomainEventDelivery,
    *,
    worker_id: str,
    outcome: str,
    started_at: datetime,
    completed_at: datetime,
    error_code: str | None = None,
    error_message: str | None = None,
) -> DomainEventDeliveryAttempt:
    return DomainEventDeliveryAttempt(
        id=str(uuid4()),
        domain_event_id=delivery.domain_event_id,
        domain_event_delivery_id=delivery.id,
        attempt_number=delivery.attempt_count,
        worker_id=worker_id,
        outcome=outcome,
        error_code=error_code[:120] if error_code is not None else None,
        error_message=error_message[:2000] if error_message is not None else None,
        started_at=_as_utc(started_at),
        completed_at=_as_utc(completed_at),
    )


def _dead_letter(
    delivery: DomainEventDelivery,
    *,
    now: datetime,
    error_code: str,
    error_message: str,
) -> None:
    delivery.status = "dead_letter"
    delivery.delivered_at = None
    delivery.dead_lettered_at = now
    delivery.last_error_code = error_code[:120]
    delivery.last_error_message = error_message[:2000]
    _release_lease(delivery)


def _release_lease(delivery: DomainEventDelivery) -> None:
    delivery.lock_token = None
    delivery.locked_at = None
    delivery.lock_expires_at = None


def _retry_delay(
    delivery_id: str,
    attempt_number: int,
    config: DeliveryEngineConfig,
) -> timedelta:
    exponent = min(attempt_number - 1, 30)
    raw_seconds = min(
        config.max_backoff.total_seconds(),
        config.base_backoff.total_seconds() * (2**exponent),
    )
    digest = hashlib.sha256(f"{delivery_id}:{attempt_number}".encode()).digest()
    unit_interval = int.from_bytes(digest[:8], "big") / ((1 << 64) - 1)
    jitter = 1 + ((unit_interval * 2 - 1) * config.jitter_ratio)
    return timedelta(seconds=raw_seconds * jitter)


def _validate_result(result: DeliveryResult) -> None:
    if not isinstance(result, DeliveryResult):
        raise DomainEventDeliveryError(
            "The destination returned an invalid delivery result.",
            error_code="invalid_handler_result",
            retryable=False,
        )


def _reject_json_constant(value: str) -> JSONValue:
    raise ValueError(f"Invalid JSON constant: {value}")


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _completion_time(explicit: datetime | None, started_at: datetime) -> datetime:
    completed_at = _as_utc(explicit or datetime.now(UTC))
    return max(completed_at, _as_utc(started_at))
