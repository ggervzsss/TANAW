from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from typing import Any, cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import WebSocket
from starlette.websockets import WebSocketState

from app import main as app_main
from app.core.config import Settings
from app.features.events import runtime
from app.features.events.contracts import DomainEventEnvelope, JSONValue
from app.features.events.notification_projection import ReportingNotificationProjection
from app.features.events.operational_websocket import OperationalConnectionManager
from app.features.events.realtime import OperationalRealtimePublisher, RealtimeBroadcastHandler


def _event(
    *,
    event_type: str = "telemetry.observation_recorded.v2",
    classification: str = "official",
    payload: dict[str, JSONValue] | None = None,
) -> DomainEventEnvelope:
    now = datetime.now(UTC)
    event_id = str(uuid4())
    return DomainEventEnvelope(
        id=event_id,
        event_key=f"event:{event_id}",
        event_type=event_type,
        contract_version=2,
        schema_version=1,
        aggregate_type="telemetry_observation",
        aggregate_id=str(uuid4()),
        aggregate_version=3,
        enterprise_id=str(uuid4()),
        site_id=str(uuid4()),
        classification=classification,
        actor_account_id=None,
        correlation_id=None,
        causation_id=None,
        payload=payload
        or {
            "resource": {
                "becameCurrent": True,
                "liveStateVersion": 12,
            }
        },
        payload_hash=f"sha256:{'0' * 64}",
        occurred_at=now,
        recorded_at=now,
    )


@pytest.mark.asyncio
async def test_realtime_publisher_emits_refetch_only_resource_envelope_once() -> None:
    envelopes: list[dict[str, Any]] = []

    async def broadcast(envelope: Any) -> None:
        envelopes.append(envelope.model_dump(mode="json"))

    publisher = OperationalRealtimePublisher(broadcast=broadcast)
    event = _event()

    first = await publisher.publish(
        topic="operational.resource-invalidations.v2",
        event=event,
        idempotency_key=event.event_key,
    )
    replay = await publisher.publish(
        topic="operational.resource-invalidations.v2",
        event=event,
        idempotency_key=event.event_key,
    )

    assert first == replay == f"realtime:{event.id}"
    assert len(envelopes) == 1
    assert envelopes[0] == {
        "type": "resource.invalidated",
        "data": {
            "contractVersion": 2,
            "eventId": event.id,
            "eventKey": event.event_key,
            "eventType": "telemetry.observation_recorded.v2",
            "resource": {
                "type": "site_live_state",
                "id": event.site_id,
                "version": 12,
            },
            "scope": {
                "classification": "official",
                "enterpriseId": event.enterprise_id,
                "siteId": event.site_id,
                "recipientAccountId": None,
            },
            "invalidates": [
                "/operational/sites/v2",
                "/operational/live/sites/v2",
                f"/operational/live/sites/{event.site_id}/v2",
            ],
            "audienceRoles": ["admin", "it", "enterprise"],
            "occurredAt": event.occurred_at.isoformat(),
            "refetchRequired": True,
        },
    }


@pytest.mark.asyncio
async def test_artifact_lifecycle_event_invalidates_final_report_reads() -> None:
    envelopes: list[dict[str, Any]] = []

    async def broadcast(envelope: Any) -> None:
        envelopes.append(envelope.model_dump(mode="json"))

    finalization_id = str(uuid4())
    period_id = str(uuid4())
    artifact_id = str(uuid4())
    base = _event(
        event_type="final_report.artifact_ready",
        payload={
            "artifactId": artifact_id,
            "artifactStatus": "ready",
            "finalReportVersionId": str(uuid4()),
            "reportFinalizationId": finalization_id,
            "reportingPeriodId": period_id,
        },
    )
    event = replace(
        base,
        aggregate_type="report_finalization",
        aggregate_id=finalization_id,
        aggregate_version=2,
        enterprise_id=None,
        site_id=None,
    )

    await OperationalRealtimePublisher(broadcast=broadcast).publish(
        topic="operational.resource-invalidations.v2",
        event=event,
        idempotency_key=event.event_key,
    )

    assert len(envelopes) == 1
    assert envelopes[0]["data"]["resource"] == {
        "type": "final_report",
        "id": finalization_id,
        "version": 2,
    }
    assert envelopes[0]["data"]["invalidates"] == [
        "/operational/reports/v2",
        "/operational/reports/finalizations/v2",
        f"final-report:{finalization_id}",
        f"final-reports-period:{period_id}",
        f"reporting-period-compliance:{period_id}",
    ]
    assert envelopes[0]["data"]["audienceRoles"] == ["staff"]


@pytest.mark.asyncio
async def test_sync_health_transition_invalidates_alerts_and_summary() -> None:
    envelopes: list[dict[str, Any]] = []

    async def broadcast(envelope: Any) -> None:
        envelopes.append(envelope.model_dump(mode="json"))

    condition_id = str(uuid4())
    alert_id = str(uuid4())
    base = _event(
        event_type="sync_health.alert_opened",
        payload={
            "conditionStateId": condition_id,
            "operationalAlertId": alert_id,
            "enterpriseId": "placeholder",
            "siteId": "placeholder",
            "status": "active",
            "pendingCount": 10,
        },
    )
    event = replace(
        base,
        aggregate_type="site_sync_health",
        aggregate_id=condition_id,
        payload={
            **base.payload,
            "enterpriseId": base.enterprise_id,
            "siteId": base.site_id,
        },
    )

    await OperationalRealtimePublisher(broadcast=broadcast).publish(
        topic="operational.resource-invalidations.v2",
        event=event,
        idempotency_key=event.event_key,
    )

    assert envelopes[0]["data"]["resource"] == {
        "type": "operational_alert",
        "id": alert_id,
        "version": 3,
    }
    assert envelopes[0]["data"]["invalidates"] == [
        "/operational/alerts",
        "/operational/summary",
    ]
    assert envelopes[0]["data"]["audienceRoles"] == ["admin", "it"]


@pytest.mark.asyncio
async def test_realtime_handler_ignores_audit_and_out_of_order_events() -> None:
    broadcast = AsyncMock()
    handler = RealtimeBroadcastHandler(OperationalRealtimePublisher(broadcast=broadcast))
    db = AsyncMock()
    audit = _event(event_type="reporting_period.reminder_intents_recorded")
    out_of_order = _event(payload={"resource": {"becameCurrent": False}})

    audit_result = await handler.deliver(
        db=db,
        event=audit,
        idempotency_key=audit.event_key,
    )
    stale_result = await handler.deliver(
        db=db,
        event=out_of_order,
        idempotency_key=out_of_order.event_key,
    )

    assert audit_result.disposition == "ignored"
    assert stale_result.disposition == "ignored"
    broadcast.assert_not_awaited()


@pytest.mark.asyncio
async def test_official_realtime_publisher_does_not_mix_simulation_events() -> None:
    broadcast = AsyncMock()
    publisher = OperationalRealtimePublisher(broadcast=broadcast)
    event = _event(classification="simulation")

    result = await publisher.publish(
        topic="operational.resource-invalidations.v2",
        event=event,
        idempotency_key=event.event_key,
    )

    assert result is None
    broadcast.assert_not_awaited()


class _FakeSocket:
    application_state = WebSocketState.CONNECTING

    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    async def accept(self) -> None:
        self.application_state = WebSocketState.CONNECTED

    async def send_json(self, value: dict[str, Any]) -> None:
        self.messages.append(value)


@pytest.mark.asyncio
async def test_realtime_hub_enforces_audience_enterprise_and_classification_scope() -> None:
    manager = OperationalConnectionManager()
    event = _event()
    publisher = OperationalRealtimePublisher(broadcast=manager.broadcast)
    admin = _FakeSocket()
    staff = _FakeSocket()
    target = _FakeSocket()
    other_enterprise = _FakeSocket()
    simulation_membership = _FakeSocket()

    await manager.connect(cast(WebSocket, admin), "admin")
    await manager.connect(cast(WebSocket, staff), "staff")
    await manager.connect(
        cast(WebSocket, target),
        "enterprise",
        topology_enterprise_id=event.enterprise_id,
        classification="official",
    )
    await manager.connect(
        cast(WebSocket, other_enterprise),
        "enterprise",
        topology_enterprise_id=str(uuid4()),
        classification="official",
    )
    await manager.connect(
        cast(WebSocket, simulation_membership),
        "enterprise",
        topology_enterprise_id=event.enterprise_id,
        classification="simulation",
    )

    await publisher.publish(
        topic="operational.resource-invalidations.v2",
        event=event,
        idempotency_key=event.event_key,
    )

    assert len(admin.messages) == 1
    assert len(target.messages) == 1
    assert staff.messages == []
    assert other_enterprise.messages == []
    assert simulation_membership.messages == []


@pytest.mark.asyncio
async def test_notification_invalidation_reaches_only_the_recorded_account() -> None:
    manager = OperationalConnectionManager()
    notification_id = str(uuid4())
    target_account_id = str(uuid4())
    base = _event(
        event_type="user_notification.created.v2",
        payload={
            "contractVersion": 2,
            "eventType": "user_notification.created.v2",
            "notificationId": notification_id,
            "recipientAccountId": target_account_id,
            "recipientRole": "admin",
        },
    )
    event = replace(
        base,
        aggregate_type="user_notification",
        aggregate_id=notification_id,
        aggregate_version=1,
        enterprise_id=None,
        site_id=None,
    )
    target = _FakeSocket()
    other = _FakeSocket()
    await manager.connect(cast(WebSocket, target), "admin", target_account_id)
    await manager.connect(cast(WebSocket, other), "admin", str(uuid4()))

    await OperationalRealtimePublisher(broadcast=manager.broadcast).publish(
        topic="operational.resource-invalidations.v2",
        event=event,
        idempotency_key=event.event_key,
    )

    assert len(target.messages) == 1
    assert target.messages[0]["data"]["resource"] == {
        "type": "user_notification",
        "id": notification_id,
        "version": 1,
    }
    assert target.messages[0]["data"]["scope"]["recipientAccountId"] == target_account_id
    assert other.messages == []


@pytest.mark.asyncio
async def test_notification_projection_ignores_simulation_and_audit_events() -> None:
    projection = ReportingNotificationProjection()
    db = AsyncMock()

    simulation = await projection.apply(
        db=db,
        event=_event(
            event_type="reporting_obligation.reminder_requested",
            classification="simulation",
        ),
    )
    audit = await projection.apply(
        db=db,
        event=_event(event_type="reporting_period.reminder_intents_recorded"),
    )

    assert simulation.disposition == "ignored"
    assert audit.disposition == "ignored"
    db.get.assert_not_awaited()


class _FakeWorker:
    def __init__(self, *, fail_start: bool = False) -> None:
        self.ready = False
        self.starts = 0
        self.stops = 0
        self.fail_start = fail_start

    async def start(self) -> None:
        self.starts += 1
        if self.fail_start:
            raise RuntimeError("startup failed")
        self.ready = True

    async def stop(self) -> None:
        self.stops += 1
        self.ready = False


@pytest.mark.asyncio
async def test_domain_event_worker_lifecycle_owns_exactly_one_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workers: list[_FakeWorker] = []
    subscribers: list[_FakeWorker] = []

    def create(_: Settings) -> Any:
        worker = _FakeWorker()
        workers.append(worker)
        return worker

    def create_subscriber(_: Settings) -> Any:
        subscriber = _FakeWorker()
        subscribers.append(subscriber)
        return subscriber

    monkeypatch.setattr(runtime, "create_domain_event_delivery_worker", create)
    monkeypatch.setattr(runtime, "create_domain_event_realtime_subscriber", create_subscriber)
    await runtime.stop_domain_event_delivery_worker()
    settings = Settings()

    await runtime.start_domain_event_delivery_worker(settings)
    assert runtime.domain_event_delivery_worker_ready()
    await runtime.start_domain_event_delivery_worker(settings)

    assert workers[0].starts == 1
    assert workers[0].stops == 1
    assert workers[1].starts == 1
    assert subscribers[0].starts == 1
    assert subscribers[0].stops == 1
    assert subscribers[1].starts == 1
    assert runtime.domain_event_delivery_worker_ready()

    await runtime.stop_domain_event_delivery_worker()
    assert workers[1].stops == 1
    assert subscribers[1].stops == 1
    assert not runtime.domain_event_delivery_worker_ready()


@pytest.mark.asyncio
async def test_domain_event_runtime_cleans_subscriber_when_worker_start_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = _FakeWorker(fail_start=True)
    subscriber = _FakeWorker()
    monkeypatch.setattr(runtime, "create_domain_event_delivery_worker", lambda _: worker)
    monkeypatch.setattr(
        runtime,
        "create_domain_event_realtime_subscriber",
        lambda _: subscriber,
    )
    await runtime.stop_domain_event_delivery_worker()

    with pytest.raises(RuntimeError, match="startup failed"):
        await runtime.start_domain_event_delivery_worker(Settings())

    assert worker.stops == 1
    assert subscriber.starts == 1
    assert subscriber.stops == 1
    assert not runtime.domain_event_delivery_worker_ready()


@pytest.mark.asyncio
async def test_background_runtime_partial_startup_is_unwound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def record(name: str) -> None:
        calls.append(name)

    async def fail_domain_start(_: Settings) -> None:
        calls.append("start-domain")
        raise RuntimeError("domain startup failed")

    monkeypatch.setattr(app_main, "initialize_email_runtime", lambda _: record("init-email"))
    monkeypatch.setattr(app_main, "close_email_runtime", lambda: record("close-email"))
    monkeypatch.setattr(
        app_main,
        "TARGET_BACKGROUND_RUNTIMES",
        (
            app_main.BackgroundRuntime(
                "email_outbox",
                lambda _: record("start-email"),
                lambda: record("stop-email"),
            ),
            app_main.BackgroundRuntime(
                "final_report_artifacts",
                lambda _: record("start-artifacts"),
                lambda: record("stop-artifacts"),
            ),
            app_main.BackgroundRuntime(
                "retention_cleanup",
                lambda _: record("start-retention"),
                lambda: record("stop-retention"),
            ),
            app_main.BackgroundRuntime(
                "domain_event_delivery_and_realtime_subscription",
                fail_domain_start,
                lambda: record("stop-domain"),
            ),
        ),
    )

    with pytest.raises(RuntimeError, match="domain startup failed"):
        async with app_main._background_runtimes():
            pytest.fail("The runtime should not yield after a failed startup.")

    assert calls == [
        "init-email",
        "start-email",
        "start-artifacts",
        "start-retention",
        "start-domain",
        "stop-domain",
        "stop-retention",
        "stop-artifacts",
        "stop-email",
        "close-email",
    ]
