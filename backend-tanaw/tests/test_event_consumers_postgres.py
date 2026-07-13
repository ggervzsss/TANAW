from __future__ import annotations

import asyncio
import hashlib
import json
import os
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.events.contracts import ProjectionDestinationHandler
from app.features.events.delivery import DomainEventDeliveryEngine
from app.features.events.models import (
    DomainEvent,
    DomainEventConsumerReceipt,
    DomainEventDelivery,
    DomainEventDeliveryAttempt,
)
from app.features.events.notification_projection import ReportingNotificationProjection
from app.features.events.realtime import (
    OperationalRealtimeSubscriber,
    PostgresOperationalRealtimePublisher,
    RealtimeBroadcastHandler,
)
from app.features.operational.models import UserNotification
from app.features.operational.schemas import OperationalWebSocketEnvelope
from app.features.reporting.models import ReportingObligation, ReportingPeriod
from app.features.topology.models import Enterprise, EnterpriseMembership, EnterpriseSite

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


@dataclass
class ConsumerRuntime:
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    prefix: str
    account_ids: list[str] = field(default_factory=list)
    enterprise_ids: list[str] = field(default_factory=list)
    site_ids: list[str] = field(default_factory=list)
    obligation_ids: list[str] = field(default_factory=list)
    event_ids: list[str] = field(default_factory=list)


@pytest_asyncio.fixture
async def consumer_runtime() -> AsyncIterator[ConsumerRuntime]:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")
    engine = create_async_engine(_postgres_async_url(raw_url), pool_pre_ping=True)
    runtime = ConsumerRuntime(
        engine=engine,
        sessions=async_sessionmaker(engine, expire_on_commit=False),
        prefix=f"consumer-test:{uuid4()}",
    )
    try:
        yield runtime
    finally:
        async with runtime.sessions() as db, db.begin():
            if runtime.event_ids:
                delivery_ids = list(
                    await db.scalars(
                        select(DomainEventDelivery.id).where(
                            DomainEventDelivery.domain_event_id.in_(runtime.event_ids)
                        )
                    )
                )
                await db.execute(
                    delete(DomainEventConsumerReceipt).where(
                        DomainEventConsumerReceipt.domain_event_id.in_(runtime.event_ids)
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
                        DomainEventDelivery.domain_event_id.in_(runtime.event_ids)
                    )
                )
                await db.execute(delete(DomainEvent).where(DomainEvent.id.in_(runtime.event_ids)))
            if runtime.account_ids:
                await db.execute(
                    delete(UserNotification).where(
                        UserNotification.recipient_account_id.in_(runtime.account_ids)
                    )
                )
                await db.execute(
                    delete(EnterpriseMembership).where(
                        EnterpriseMembership.account_id.in_(runtime.account_ids)
                    )
                )
            if runtime.obligation_ids:
                await db.execute(
                    delete(ReportingObligation).where(
                        ReportingObligation.id.in_(runtime.obligation_ids)
                    )
                )
            if runtime.site_ids:
                await db.execute(
                    delete(EnterpriseSite).where(EnterpriseSite.id.in_(runtime.site_ids))
                )
            if runtime.enterprise_ids:
                await db.execute(
                    delete(Enterprise).where(Enterprise.id.in_(runtime.enterprise_ids))
                )
            if runtime.account_ids:
                await db.execute(delete(Account).where(Account.id.in_(runtime.account_ids)))
        await engine.dispose()


@pytest.mark.asyncio
async def test_reminder_projection_is_exact_once_and_topology_scoped_with_two_workers(
    consumer_runtime: ConsumerRuntime,
) -> None:
    now = datetime.now(UTC)
    official_enterprise = await _enterprise(consumer_runtime, "official")
    unrelated_enterprise = await _enterprise(consumer_runtime, "official")
    simulation_enterprise = await _enterprise(consumer_runtime, "simulation")
    official_site = await _site(consumer_runtime, official_enterprise)
    simulation_site = await _site(consumer_runtime, simulation_enterprise)
    period = await _reporting_period(consumer_runtime, now)
    official_obligation = await _obligation(consumer_runtime, official_site, period)
    simulation_obligation = await _obligation(consumer_runtime, simulation_site, period)
    target = await _account(consumer_runtime, role=AccountRole.ENTERPRISE)
    unrelated = await _account(consumer_runtime, role=AccountRole.ENTERPRISE)
    simulation_target = await _account(consumer_runtime, role=AccountRole.ENTERPRISE)
    await _membership(consumer_runtime, target, official_enterprise, "official", now)
    await _membership(consumer_runtime, unrelated, unrelated_enterprise, "official", now)
    await _membership(consumer_runtime, simulation_target, simulation_enterprise, "simulation", now)

    official_event = await _reminder_event(
        consumer_runtime,
        obligation=official_obligation,
        period=period,
        now=now,
    )
    handler = ProjectionDestinationHandler(
        destination="notification_projection",
        projection=ReportingNotificationProjection(),
    )
    first = DomainEventDeliveryEngine(
        sessions=consumer_runtime.sessions,
        handlers=(handler,),
        worker_id="notification-worker-a",
    )
    second = DomainEventDeliveryEngine(
        sessions=consumer_runtime.sessions,
        handlers=(handler,),
        worker_id="notification-worker-b",
    )

    results = await asyncio.gather(first.run_batch(now=now), second.run_batch(now=now))

    assert sum(result.delivered for result in results) == 1
    async with consumer_runtime.sessions() as db:
        notifications = list(
            await db.scalars(
                select(UserNotification).where(
                    UserNotification.recipient_account_id.in_(
                        [target.id, unrelated.id, simulation_target.id]
                    )
                )
            )
        )
        receipts = list(
            await db.scalars(
                select(DomainEventConsumerReceipt).where(
                    DomainEventConsumerReceipt.domain_event_id == official_event.id
                )
            )
        )
    assert len(notifications) == 1
    assert notifications[0].recipient_account_id == target.id
    assert notifications[0].recipient_enterprise_id == official_enterprise.id
    assert notifications[0].source_id == f"/enterprise/reports?periodId={period.id}"
    assert len(receipts) == 1
    assert receipts[0].disposition == "applied"

    restarted = DomainEventDeliveryEngine(
        sessions=consumer_runtime.sessions,
        handlers=(handler,),
        worker_id="notification-worker-after-restart",
    )
    replay_result = await restarted.run_batch(now=now)
    assert replay_result.claimed == 0
    async with consumer_runtime.sessions() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(UserNotification)
                .where(UserNotification.recipient_account_id == target.id)
            )
            == 1
        )

    simulation_event = await _reminder_event(
        consumer_runtime,
        obligation=simulation_obligation,
        period=period,
        now=now + timedelta(seconds=1),
    )
    ignored = await first.run_batch(now=now + timedelta(seconds=1))
    assert ignored.delivered == 1
    async with consumer_runtime.sessions() as db:
        simulation_receipt = await db.scalar(
            select(DomainEventConsumerReceipt).where(
                DomainEventConsumerReceipt.domain_event_id == simulation_event.id
            )
        )
        simulation_count = await db.scalar(
            select(func.count())
            .select_from(UserNotification)
            .where(UserNotification.recipient_account_id == simulation_target.id)
        )
    assert simulation_receipt is not None
    assert simulation_receipt.disposition == "ignored"
    assert simulation_count == 0

    tampered_event = await _reminder_event(
        consumer_runtime,
        obligation=official_obligation,
        period=period,
        now=now + timedelta(seconds=2),
        payload_enterprise_id=unrelated_enterprise.id,
    )
    rejected = await first.run_batch(now=now + timedelta(seconds=2))
    assert rejected.dead_lettered == 1
    async with consumer_runtime.sessions() as db:
        tampered_delivery = await db.scalar(
            select(DomainEventDelivery).where(
                DomainEventDelivery.domain_event_id == tampered_event.id
            )
        )
        assert tampered_delivery is not None
        assert tampered_delivery.status == "dead_letter"
        assert tampered_delivery.last_error_code == "notification_source_scope_invalid"
        assert (
            await db.scalar(
                select(func.count())
                .select_from(UserNotification)
                .where(UserNotification.recipient_account_id == target.id)
            )
            == 1
        )


@pytest.mark.asyncio
async def test_postgres_broker_fans_one_delivery_out_to_two_api_runtimes(
    consumer_runtime: ConsumerRuntime,
) -> None:
    now = datetime.now(UTC)
    event = await _realtime_event(consumer_runtime, now=now)
    received_a: list[dict[str, Any]] = []
    received_b: list[dict[str, Any]] = []
    ready_a = asyncio.Event()
    ready_b = asyncio.Event()

    async def broadcast_a(envelope: OperationalWebSocketEnvelope) -> None:
        received_a.append(envelope.model_dump(mode="json"))
        ready_a.set()

    async def broadcast_b(envelope: OperationalWebSocketEnvelope) -> None:
        received_b.append(envelope.model_dump(mode="json"))
        ready_b.set()

    database_url = consumer_runtime.engine.url.render_as_string(hide_password=False)
    subscriber_a = OperationalRealtimeSubscriber(
        database_url,
        broadcast=broadcast_a,
        reconnect_interval_seconds=0.1,
    )
    subscriber_b = OperationalRealtimeSubscriber(
        database_url,
        broadcast=broadcast_b,
        reconnect_interval_seconds=0.1,
    )
    await subscriber_a.start()
    await subscriber_b.start()
    try:
        handler = RealtimeBroadcastHandler(PostgresOperationalRealtimePublisher())
        first = DomainEventDeliveryEngine(
            sessions=consumer_runtime.sessions,
            handlers=(handler,),
            worker_id="realtime-worker-a",
        )
        second = DomainEventDeliveryEngine(
            sessions=consumer_runtime.sessions,
            handlers=(handler,),
            worker_id="realtime-worker-b",
        )

        results = await asyncio.gather(first.run_batch(now=now), second.run_batch(now=now))
        await asyncio.wait_for(asyncio.gather(ready_a.wait(), ready_b.wait()), timeout=5)

        assert sum(result.delivered for result in results) == 1
        assert received_a == received_b
        assert len(received_a) == 1
        assert received_a[0]["type"] == "resource.invalidated"
        assert received_a[0]["data"] == {
            "contractVersion": 2,
            "eventId": event.id,
            "eventKey": event.event_key,
            "eventType": "reporting_period.obligations_frozen",
            "resource": {
                "type": "reporting_period_compliance",
                "id": event.aggregate_id,
                "version": 1,
            },
            "scope": {
                "classification": "official",
                "enterpriseId": None,
                "siteId": None,
            },
            "invalidates": [f"reporting-period-compliance:{event.aggregate_id}"],
            "audienceRoles": ["staff", "admin"],
            "occurredAt": event.occurred_at.isoformat(),
            "refetchRequired": True,
        }

        subscriber_a_connection = subscriber_a._connection
        assert subscriber_a_connection is not None
        await subscriber_a_connection.close()
        await _wait_until(lambda: subscriber_a.ready)
        ready_a.clear()
        ready_b.clear()
        second_event = await _realtime_event(
            consumer_runtime,
            now=now + timedelta(seconds=1),
        )
        second_results = await asyncio.gather(
            first.run_batch(now=now + timedelta(seconds=1)),
            second.run_batch(now=now + timedelta(seconds=1)),
        )
        await asyncio.wait_for(asyncio.gather(ready_a.wait(), ready_b.wait()), timeout=5)
        assert sum(result.delivered for result in second_results) == 1
        assert received_a[-1]["data"]["eventId"] == second_event.id
        assert received_b[-1]["data"]["eventId"] == second_event.id

        restarted = DomainEventDeliveryEngine(
            sessions=consumer_runtime.sessions,
            handlers=(handler,),
            worker_id="realtime-worker-after-restart",
        )
        assert (await restarted.run_batch(now=now)).claimed == 0
        await asyncio.sleep(0.05)
        assert len(received_a) == len(received_b) == 2
    finally:
        await subscriber_a.stop()
        await subscriber_b.stop()


async def _enterprise(runtime: ConsumerRuntime, classification: str) -> Enterprise:
    enterprise = Enterprise(
        id=str(uuid4()),
        official_code=f"{runtime.prefix}:{uuid4()}",
        name=f"Consumer Test {classification}",
        classification=classification,
        lifecycle_state="active",
    )
    runtime.enterprise_ids.append(enterprise.id)
    async with runtime.sessions() as db:
        db.add(enterprise)
        await db.commit()
    return enterprise


async def _account(runtime: ConsumerRuntime, *, role: AccountRole) -> Account:
    account = Account(
        id=str(uuid4()),
        email=f"{uuid4()}@consumer.test",
        password_hash="not-used",
        role=role,
        display_name="Consumer Test",
        title="Test",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )
    runtime.account_ids.append(account.id)
    async with runtime.sessions() as db:
        db.add(account)
        await db.commit()
    return account


async def _site(runtime: ConsumerRuntime, enterprise: Enterprise) -> EnterpriseSite:
    site = EnterpriseSite(
        id=str(uuid4()),
        enterprise_id=enterprise.id,
        classification=enterprise.classification,
        site_code=f"SITE-{str(uuid4())[:8]}",
        name="Consumer Test Site",
        barangay="San Antonio",
        timezone_name="Asia/Manila",
        building_capacity=100,
        location_version=1,
        effective_from=datetime.now(UTC) - timedelta(days=30),
    )
    runtime.site_ids.append(site.id)
    async with runtime.sessions() as db:
        db.add(site)
        await db.commit()
    return site


async def _reporting_period(runtime: ConsumerRuntime, now: datetime) -> ReportingPeriod:
    suffix = str(uuid4())[:8]
    starts_at = now - timedelta(days=31)
    ends_at = now - timedelta(days=1)
    period = ReportingPeriod(
        id=str(uuid4()),
        natural_key=f"consumer-test:{suffix}",
        cadence="month",
        timezone_name="Asia/Manila",
        local_start_date=date(2026, 6, 1),
        local_end_date=date(2026, 7, 1),
        starts_at=starts_at,
        ends_at=ends_at,
        submission_opens_at=ends_at,
        label=f"Consumer Test {suffix}",
    )
    async with runtime.sessions() as db:
        db.add(period)
        await db.commit()
    return period


async def _obligation(
    runtime: ConsumerRuntime,
    site: EnterpriseSite,
    period: ReportingPeriod,
) -> ReportingObligation:
    obligation = ReportingObligation(
        id=str(uuid4()),
        reporting_period_id=period.id,
        enterprise_id=site.enterprise_id,
        site_id=site.id,
        classification=site.classification,
        eligibility_status="eligible",
        eligibility_basis="registry_snapshot",
        frozen_barangay=site.barangay,
        timezone_name="Asia/Manila",
        registration_effective_at=site.effective_from,
        acceptance_blocked=False,
    )
    runtime.obligation_ids.append(obligation.id)
    async with runtime.sessions() as db:
        db.add(obligation)
        await db.commit()
    return obligation


async def _membership(
    runtime: ConsumerRuntime,
    account: Account,
    enterprise: Enterprise,
    classification: str,
    now: datetime,
) -> None:
    async with runtime.sessions() as db:
        db.add(
            EnterpriseMembership(
                id=str(uuid4()),
                enterprise_id=enterprise.id,
                account_id=account.id,
                classification=classification,
                membership_role="manager",
                started_at=now - timedelta(days=1),
            )
        )
        await db.commit()


async def _reminder_event(
    runtime: ConsumerRuntime,
    *,
    obligation: ReportingObligation,
    period: ReportingPeriod,
    now: datetime,
    payload_enterprise_id: str | None = None,
) -> DomainEvent:
    payload = {
        "contractVersion": 2,
        "eventType": "reporting_obligation.reminder_requested",
        "phase": "overdue",
        "reportingPeriodId": period.id,
        "periodKey": period.natural_key,
        "periodLabel": period.label,
        "submissionOpensAt": period.submission_opens_at.isoformat(),
        "obligationId": obligation.id,
        "enterpriseId": payload_enterprise_id or obligation.enterprise_id,
        "siteId": obligation.site_id,
        "complianceStatus": "not_submitted",
        "targetPath": f"/enterprise/reports?periodId={period.id}",
    }
    canonical = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    event = DomainEvent(
        id=str(uuid4()),
        event_key=f"{runtime.prefix}:reminder:{uuid4()}",
        event_type="reporting_obligation.reminder_requested",
        contract_version=2,
        schema_version=1,
        aggregate_type="reporting_obligation",
        aggregate_id=obligation.id,
        aggregate_version=1,
        enterprise_id=obligation.enterprise_id,
        site_id=obligation.site_id,
        classification=obligation.classification,
        actor_account_id=None,
        payload_json=canonical,
        payload_hash=f"sha256:{hashlib.sha256(canonical.encode()).hexdigest()}",
        occurred_at=now,
        available_at=now,
    )
    runtime.event_ids.append(event.id)
    async with runtime.sessions() as db:
        db.add(event)
        await db.flush()
        db.add(
            DomainEventDelivery(
                id=str(uuid4()),
                domain_event_id=event.id,
                destination="notification_projection",
                status="pending",
                attempt_count=0,
                next_attempt_at=now,
            )
        )
        await db.commit()
    return event


async def _realtime_event(runtime: ConsumerRuntime, *, now: datetime) -> DomainEvent:
    period_id = str(uuid4())
    payload = {
        "contractVersion": 2,
        "eventType": "reporting_period.obligations_frozen",
        "reportingPeriodId": period_id,
    }
    canonical = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    event = DomainEvent(
        id=str(uuid4()),
        event_key=f"{runtime.prefix}:realtime:{uuid4()}",
        event_type="reporting_period.obligations_frozen",
        contract_version=2,
        schema_version=1,
        aggregate_type="reporting_period",
        aggregate_id=period_id,
        aggregate_version=1,
        enterprise_id=None,
        site_id=None,
        classification="official",
        actor_account_id=None,
        payload_json=canonical,
        payload_hash=f"sha256:{hashlib.sha256(canonical.encode()).hexdigest()}",
        occurred_at=now,
        available_at=now,
    )
    runtime.event_ids.append(event.id)
    async with runtime.sessions() as db:
        db.add(event)
        await db.flush()
        db.add(
            DomainEventDelivery(
                id=str(uuid4()),
                domain_event_id=event.id,
                destination="realtime_broadcast",
                status="pending",
                attempt_count=0,
                next_attempt_at=now,
            )
        )
        await db.commit()
    return event


async def _wait_until(predicate: Callable[[], bool], *, timeout: float = 5) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() >= deadline:
            raise TimeoutError("The condition did not become true before the timeout.")
        await asyncio.sleep(0.02)
