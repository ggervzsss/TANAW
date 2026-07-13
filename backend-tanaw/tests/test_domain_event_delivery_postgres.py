import asyncio
import hashlib
import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db.base import (
    DomainEvent,
    DomainEventConsumerReceipt,
    DomainEventDelivery,
    DomainEventDeliveryAttempt,
)
from app.features.events.contracts import (
    DeliveryResult,
    DomainEventDeliveryError,
    DomainEventEnvelope,
)
from app.features.events.delivery import (
    DeliveryEngineConfig,
    DispatchOutcome,
    DomainEventDeliveryEngine,
    read_delivery_queue_metrics,
)

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"


def _postgres_async_url(raw_url: str) -> str:
    normalized = raw_url.strip()
    if normalized.startswith("postgres://"):
        normalized = f"postgresql://{normalized.removeprefix('postgres://')}"
    if normalized.startswith("postgresql://"):
        normalized = normalized.replace("postgresql://", "postgresql+asyncpg://", 1)
    if not normalized.startswith("postgresql+asyncpg://"):
        raise pytest.UsageError(f"{TEST_DATABASE_ENV} must point to PostgreSQL via asyncpg.")
    return normalized


@dataclass(frozen=True)
class EventRuntime:
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    prefix: str


@pytest_asyncio.fixture
async def event_runtime() -> AsyncIterator[EventRuntime]:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")
    engine = create_async_engine(_postgres_async_url(raw_url), pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    runtime = EventRuntime(
        engine=engine,
        sessions=sessions,
        prefix=f"delivery-test:{uuid4()}:",
    )
    try:
        yield runtime
    finally:
        await _clean_runtime(runtime)
        await engine.dispose()


@dataclass
class RecordingHandler:
    destination: str
    consumer_name: str
    calls: list[str] = field(default_factory=list)

    async def deliver(
        self,
        *,
        db: AsyncSession,
        event: DomainEventEnvelope,
        idempotency_key: str,
    ) -> DeliveryResult:
        del db
        assert idempotency_key == event.event_key
        self.calls.append(event.id)
        return DeliveryResult(result_reference=f"projected:{event.aggregate_version}")


@dataclass
class RejectingHandler:
    destination: str
    consumer_name: str
    retryable: bool
    calls: int = 0

    async def deliver(
        self,
        *,
        db: AsyncSession,
        event: DomainEventEnvelope,
        idempotency_key: str,
    ) -> DeliveryResult:
        del db, event, idempotency_key
        self.calls += 1
        raise DomainEventDeliveryError(
            "The test destination rejected this event.",
            error_code="test_rejection",
            retryable=self.retryable,
        )


@pytest.mark.asyncio
async def test_two_workers_cannot_lease_or_deliver_one_destination_twice(
    event_runtime: EventRuntime,
) -> None:
    now = datetime.now(UTC)
    _event_id, delivery_id = await _enqueue(event_runtime, now=now)
    handler = RecordingHandler("test_projection", "test_projection_consumer")
    first = _engine(event_runtime, handler, worker_id="worker-a")
    second = _engine(event_runtime, handler, worker_id="worker-b")

    batches = await asyncio.gather(
        first.claim_batch(now=now),
        second.claim_batch(now=now),
    )

    assert sorted(len(batch.claims) for batch in batches) == [0, 1]
    claim = next(batch.claims[0] for batch in batches if batch.claims)
    owner = first if claim.lock_token in {item.lock_token for item in batches[0].claims} else second
    assert await owner.dispatch_claim(claim, now=now + timedelta(milliseconds=1)) == "delivered"
    assert handler.calls == [claim.domain_event_id]

    delivery, attempts, receipts = await _delivery_records(event_runtime, delivery_id)
    assert delivery.status == "delivered"
    assert delivery.attempt_count == 1
    assert [attempt.outcome for attempt in attempts] == ["succeeded"]
    assert len(receipts) == 1


@pytest.mark.asyncio
async def test_expired_process_lease_is_recorded_and_recovered_after_restart(
    event_runtime: EventRuntime,
) -> None:
    now = datetime.now(UTC)
    _event_id, delivery_id = await _enqueue(event_runtime, now=now)
    handler = RecordingHandler("test_projection", "restart_safe_projection")
    config = DeliveryEngineConfig(
        lease_duration=timedelta(seconds=1),
        max_attempts=3,
        jitter_ratio=0,
    )
    crashed_engine = _engine(
        event_runtime,
        handler,
        worker_id="crashed-worker",
        config=config,
    )
    first_claim = await crashed_engine.claim_batch(now=now)
    assert len(first_claim.claims) == 1

    restarted_engine = _engine(
        event_runtime,
        handler,
        worker_id="restart-worker",
        config=config,
    )
    restarted_at = now + timedelta(seconds=2)
    recovered = await restarted_engine.claim_batch(now=restarted_at)
    assert recovered.recovered_leases == 1
    assert recovered.recovered_to_dead_letter == 0
    assert len(recovered.claims) == 1
    assert recovered.claims[0].lock_token != first_claim.claims[0].lock_token

    outcome = await restarted_engine.dispatch_claim(
        recovered.claims[0],
        now=restarted_at + timedelta(milliseconds=1),
    )
    assert outcome == DispatchOutcome.DELIVERED
    assert handler.calls == [recovered.claims[0].domain_event_id]

    delivery, attempts, _receipts = await _delivery_records(event_runtime, delivery_id)
    assert delivery.status == "delivered"
    assert delivery.attempt_count == 2
    assert [(item.attempt_number, item.outcome, item.error_code) for item in attempts] == [
        (1, "retryable_failure", "lease_expired"),
        (2, "succeeded", None),
    ]


@pytest.mark.asyncio
async def test_retry_backoff_reaches_dead_letter_and_terminal_claim_is_fenced(
    event_runtime: EventRuntime,
) -> None:
    now = datetime.now(UTC)
    _event_id, delivery_id = await _enqueue(event_runtime, now=now)
    handler = RejectingHandler("test_projection", "rejecting_projection", retryable=True)
    engine = _engine(
        event_runtime,
        handler,
        worker_id="retry-worker",
        config=DeliveryEngineConfig(
            max_attempts=2,
            base_backoff=timedelta(seconds=2),
            max_backoff=timedelta(seconds=10),
            jitter_ratio=0,
        ),
    )

    first_batch = await engine.claim_batch(now=now)
    first_claim = first_batch.claims[0]
    assert await engine.dispatch_claim(first_claim, now=now) == DispatchOutcome.RETRY_SCHEDULED
    after_first, _attempts, _receipts = await _delivery_records(event_runtime, delivery_id)
    assert after_first.next_attempt_at == now + timedelta(seconds=2)

    second_at = now + timedelta(seconds=3)
    second_batch = await engine.claim_batch(now=second_at)
    second_claim = second_batch.claims[0]
    assert await engine.dispatch_claim(second_claim, now=second_at) == DispatchOutcome.DEAD_LETTERED
    assert await engine.dispatch_claim(second_claim, now=second_at) == DispatchOutcome.STALE_CLAIM
    assert (await engine.claim_batch(now=second_at + timedelta(days=1))).claims == ()

    delivery, attempts, receipts = await _delivery_records(event_runtime, delivery_id)
    assert delivery.status == "dead_letter"
    assert delivery.dead_lettered_at == second_at
    assert delivery.lock_token is None
    assert delivery.attempt_count == 2
    assert [item.outcome for item in attempts] == [
        "retryable_failure",
        "terminal_failure",
    ]
    assert receipts == []
    assert handler.calls == 2

    async with event_runtime.sessions() as db:
        metrics = await read_delivery_queue_metrics(db, now=second_at)
    assert metrics.dead_letter >= 1


@pytest.mark.asyncio
async def test_payload_hash_mismatch_is_terminal_before_destination_side_effect(
    event_runtime: EventRuntime,
) -> None:
    now = datetime.now(UTC)
    _event_id, delivery_id = await _enqueue(
        event_runtime,
        now=now,
        payload_hash=f"sha256:{'0' * 64}",
    )
    handler = RecordingHandler("test_projection", "hash_guard_projection")
    engine = _engine(event_runtime, handler, worker_id="hash-worker")

    result = await engine.run_batch(now=now)

    assert result.dead_lettered == 1
    assert handler.calls == []
    delivery, attempts, receipts = await _delivery_records(event_runtime, delivery_id)
    assert delivery.status == "dead_letter"
    assert delivery.last_error_code == "event_payload_hash_mismatch"
    assert attempts[0].outcome == "terminal_failure"
    assert receipts == []


@pytest.mark.asyncio
async def test_existing_consumer_receipt_short_circuits_duplicate_side_effect(
    event_runtime: EventRuntime,
) -> None:
    now = datetime.now(UTC)
    event_id, delivery_id = await _enqueue(event_runtime, now=now)
    event_hash = await _event_hash(event_runtime, event_id)
    async with event_runtime.sessions() as db:
        db.add(
            DomainEventConsumerReceipt(
                id=str(uuid4()),
                domain_event_id=event_id,
                consumer_name="receipt_projection",
                disposition="applied",
                event_payload_hash=event_hash,
                consumed_at=now,
                result_reference="existing-projection",
            )
        )
        await db.commit()
    handler = RecordingHandler("test_projection", "receipt_projection")
    engine = _engine(event_runtime, handler, worker_id="receipt-worker")

    result = await engine.run_batch(now=now)

    assert result.delivered == 1
    assert handler.calls == []
    delivery, attempts, receipts = await _delivery_records(event_runtime, delivery_id)
    assert delivery.status == "delivered"
    assert len(attempts) == 1
    assert len(receipts) == 1


def _engine(
    runtime: EventRuntime,
    handler: RecordingHandler | RejectingHandler,
    *,
    worker_id: str,
    config: DeliveryEngineConfig | None = None,
) -> DomainEventDeliveryEngine:
    return DomainEventDeliveryEngine(
        sessions=runtime.sessions,
        handlers=[handler],
        worker_id=worker_id,
        config=config,
    )


async def _enqueue(
    runtime: EventRuntime,
    *,
    now: datetime,
    payload_hash: str | None = None,
) -> tuple[str, str]:
    payload = {"contractVersion": 2, "reportRevisionId": str(uuid4())}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    event = DomainEvent(
        id=str(uuid4()),
        event_key=f"{runtime.prefix}{uuid4()}",
        event_type="enterprise_report.revision_submitted",
        contract_version=2,
        schema_version=1,
        aggregate_type="enterprise_report",
        aggregate_id=str(uuid4()),
        aggregate_version=1,
        classification="official",
        payload_json=canonical,
        payload_hash=payload_hash
        or f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}",
        occurred_at=now,
        available_at=now,
    )
    delivery = DomainEventDelivery(
        id=str(uuid4()),
        domain_event_id=event.id,
        destination="test_projection",
        status="pending",
        attempt_count=0,
        next_attempt_at=now,
    )
    async with runtime.sessions() as db:
        db.add(event)
        await db.flush()
        db.add(delivery)
        await db.commit()
    return event.id, delivery.id


async def _delivery_records(
    runtime: EventRuntime,
    delivery_id: str,
) -> tuple[
    DomainEventDelivery,
    list[DomainEventDeliveryAttempt],
    list[DomainEventConsumerReceipt],
]:
    async with runtime.sessions() as db:
        delivery = await db.get(DomainEventDelivery, delivery_id)
        assert delivery is not None
        attempts = list(
            await db.scalars(
                select(DomainEventDeliveryAttempt)
                .where(DomainEventDeliveryAttempt.domain_event_delivery_id == delivery_id)
                .order_by(DomainEventDeliveryAttempt.attempt_number)
            )
        )
        receipts = list(
            await db.scalars(
                select(DomainEventConsumerReceipt).where(
                    DomainEventConsumerReceipt.domain_event_id == delivery.domain_event_id
                )
            )
        )
        return delivery, attempts, receipts


async def _event_hash(runtime: EventRuntime, event_id: str) -> str:
    async with runtime.sessions() as db:
        event = await db.get(DomainEvent, event_id)
        assert event is not None
        return event.payload_hash


async def _clean_runtime(runtime: EventRuntime) -> None:
    async with runtime.sessions() as db:
        event_ids = list(
            await db.scalars(
                select(DomainEvent.id).where(DomainEvent.event_key.like(f"{runtime.prefix}%"))
            )
        )
        if event_ids:
            delivery_ids = list(
                await db.scalars(
                    select(DomainEventDelivery.id).where(
                        DomainEventDelivery.domain_event_id.in_(event_ids)
                    )
                )
            )
            await db.execute(
                delete(DomainEventConsumerReceipt).where(
                    DomainEventConsumerReceipt.domain_event_id.in_(event_ids)
                )
            )
            if delivery_ids:
                await db.execute(
                    delete(DomainEventDeliveryAttempt).where(
                        DomainEventDeliveryAttempt.domain_event_delivery_id.in_(delivery_ids)
                    )
                )
            await db.execute(
                delete(DomainEventDelivery).where(
                    DomainEventDelivery.domain_event_id.in_(event_ids)
                )
            )
            await db.execute(delete(DomainEvent).where(DomainEvent.id.in_(event_ids)))
        await db.commit()
