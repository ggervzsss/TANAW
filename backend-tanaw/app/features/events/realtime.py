"""Reconnect-safe domain-event invalidations for the operational realtime hub."""

from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

import asyncpg  # type: ignore[import-untyped]
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.events.contracts import (
    DeliveryResult,
    DomainEventDeliveryError,
    DomainEventEnvelope,
    JSONValue,
)
from app.features.events.operational_websocket import operational_ws_manager
from app.features.events.realtime_envelopes import OperationalWebSocketEnvelope

Broadcast = Callable[[OperationalWebSocketEnvelope], Awaitable[None]]
REALTIME_TOPIC = "operational.resource-invalidations.v2"
POSTGRES_REALTIME_CHANNEL = "tanaw_operational_invalidations_v2"
POSTGRES_NOTIFY_PAYLOAD_LIMIT = 7_900

logger = logging.getLogger("uvicorn.error")


@dataclass(frozen=True, slots=True)
class _Invalidation:
    resource_type: str
    resource_id: str
    resource_version: int
    invalidates: tuple[str, ...]
    audience_roles: tuple[str, ...]
    recipient_account_id: str | None = None


class RealtimePublisher(Protocol):
    async def publish(
        self,
        *,
        db: AsyncSession,
        topic: str,
        event: DomainEventEnvelope,
        idempotency_key: str,
    ) -> str | None: ...


class OperationalRealtimePublisher:
    """In-process publisher used by focused tests, never by the multi-worker runtime."""

    def __init__(
        self,
        *,
        broadcast: Broadcast | None = None,
        deduplication_capacity: int = 10_000,
    ) -> None:
        if not 100 <= deduplication_capacity <= 100_000:
            raise ValueError("Realtime deduplication capacity must be between 100 and 100000.")
        self._broadcast = broadcast or operational_ws_manager.broadcast
        self._deduplication_capacity = deduplication_capacity
        self._published: OrderedDict[str, None] = OrderedDict()
        self._lock = asyncio.Lock()

    async def publish(
        self,
        *,
        db: AsyncSession | None = None,
        topic: str,
        event: DomainEventEnvelope,
        idempotency_key: str,
    ) -> str | None:
        del db
        if topic != REALTIME_TOPIC:
            return None
        invalidation = _invalidation(event)
        if invalidation is None:
            return None

        async with self._lock:
            if idempotency_key in self._published:
                self._published.move_to_end(idempotency_key)
                return f"realtime:{event.id}"
            # Reserve before awaiting the hub so concurrent deliveries cannot both emit.
            self._published[idempotency_key] = None
            while len(self._published) > self._deduplication_capacity:
                self._published.popitem(last=False)
        try:
            await self._broadcast(_envelope(event, invalidation))
        except Exception:
            async with self._lock:
                self._published.pop(idempotency_key, None)
            raise
        return f"realtime:{event.id}"


class PostgresOperationalRealtimePublisher:
    """Publishes only when the delivery receipt transaction commits.

    PostgreSQL defers ``pg_notify`` until transaction commit. A worker crash or
    rollback therefore leaves both the delivery and the broker publish pending,
    while every listening API process receives a committed invalidation.
    """

    async def publish(
        self,
        *,
        db: AsyncSession,
        topic: str,
        event: DomainEventEnvelope,
        idempotency_key: str,
    ) -> str | None:
        del idempotency_key
        if topic != REALTIME_TOPIC:
            return None
        invalidation = _invalidation(event)
        if invalidation is None:
            return None
        payload = _envelope(event, invalidation).model_dump_json()
        if len(payload.encode("utf-8")) > POSTGRES_NOTIFY_PAYLOAD_LIMIT:
            raise DomainEventDeliveryError(
                "The operational invalidation exceeds the PostgreSQL payload limit.",
                error_code="realtime_payload_too_large",
                retryable=False,
            )
        await db.execute(
            text("SELECT pg_notify(:channel, :payload)"),
            {"channel": POSTGRES_REALTIME_CHANNEL, "payload": payload},
        )
        return f"realtime:{event.id}"


class OperationalRealtimeSubscriber:
    """Fans one PostgreSQL broker subscription out to this process's sockets."""

    def __init__(
        self,
        database_url: str,
        *,
        broadcast: Broadcast | None = None,
        reconnect_interval_seconds: float = 1.0,
        deduplication_capacity: int = 10_000,
    ) -> None:
        if not 0.1 <= reconnect_interval_seconds <= 60:
            raise ValueError("Realtime reconnect interval must be between 0.1 and 60 seconds.")
        if not 100 <= deduplication_capacity <= 100_000:
            raise ValueError("Realtime deduplication capacity must be between 100 and 100000.")
        self._database_dsn = _asyncpg_dsn(database_url)
        self._broadcast = broadcast or operational_ws_manager.broadcast
        self._reconnect_interval_seconds = reconnect_interval_seconds
        self._deduplication_capacity = deduplication_capacity
        self._published: OrderedDict[str, None] = OrderedDict()
        self._deduplication_lock = asyncio.Lock()
        self._connection: asyncpg.Connection | None = None
        self._task: asyncio.Task[None] | None = None
        self._stop_event: asyncio.Event | None = None
        self._dispatch_tasks: set[asyncio.Task[None]] = set()

    @property
    def ready(self) -> bool:
        connection = self._connection
        return bool(
            self._task is not None
            and not self._task.done()
            and connection is not None
            and not connection.is_closed()
        )

    async def start(self) -> None:
        await self.stop()
        stop_event = asyncio.Event()
        self._stop_event = stop_event
        try:
            await self._connect()
        except Exception:
            self._stop_event = None
            await self._disconnect()
            raise
        self._task = asyncio.create_task(
            self._run(stop_event),
            name="tanaw-operational-realtime-subscriber",
        )

    async def stop(self) -> None:
        task = self._task
        stop_event = self._stop_event
        self._task = None
        self._stop_event = None
        if stop_event is not None:
            stop_event.set()
        if task is not None:
            await task
        else:
            await self._disconnect()
        pending = tuple(self._dispatch_tasks)
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    async def _run(self, stop_event: asyncio.Event) -> None:
        try:
            while not stop_event.is_set():
                connection = self._connection
                if connection is None or connection.is_closed():
                    await self._disconnect()
                    try:
                        await self._connect()
                    except Exception:
                        logger.exception("Operational realtime subscriber reconnect failed.")
                try:
                    await asyncio.wait_for(
                        stop_event.wait(),
                        timeout=self._reconnect_interval_seconds,
                    )
                except TimeoutError:
                    pass
        finally:
            await self._disconnect()

    async def _connect(self) -> None:
        connection = await asyncpg.connect(self._database_dsn, timeout=5)
        try:
            await connection.add_listener(POSTGRES_REALTIME_CHANNEL, self._on_notification)
        except Exception:
            await connection.close()
            raise
        self._connection = connection

    async def _disconnect(self) -> None:
        connection = self._connection
        self._connection = None
        if connection is None or connection.is_closed():
            return
        try:
            await connection.remove_listener(POSTGRES_REALTIME_CHANNEL, self._on_notification)
        finally:
            await connection.close()

    def _on_notification(
        self,
        _: asyncpg.Connection,
        _process_id: int,
        channel: str,
        payload: str,
    ) -> None:
        if channel != POSTGRES_REALTIME_CHANNEL or self._stop_event is None:
            return
        task = asyncio.create_task(
            self._dispatch(payload),
            name="tanaw-operational-realtime-dispatch",
        )
        self._dispatch_tasks.add(task)
        task.add_done_callback(self._dispatch_tasks.discard)

    async def _dispatch(self, payload: str) -> None:
        try:
            envelope = OperationalWebSocketEnvelope.model_validate_json(payload)
        except ValidationError:
            logger.warning("Discarded an invalid operational realtime broker payload.")
            return
        if envelope.type != "resource.invalidated":
            logger.warning("Discarded an unexpected operational realtime broker event type.")
            return
        event_key = envelope.data.get("eventKey")
        if not isinstance(event_key, str) or not event_key:
            logger.warning("Discarded an operational invalidation without an event key.")
            return
        async with self._deduplication_lock:
            if event_key in self._published:
                self._published.move_to_end(event_key)
                return
            self._published[event_key] = None
            while len(self._published) > self._deduplication_capacity:
                self._published.popitem(last=False)
        try:
            await self._broadcast(envelope)
        except Exception:
            async with self._deduplication_lock:
                self._published.pop(event_key, None)
            logger.exception("Operational realtime broker fan-out failed.")


class RealtimeBroadcastHandler:
    """Delivery handler that records unsupported/audit events as deliberate ignores."""

    destination = "realtime_broadcast"
    consumer_name = "realtime_broadcast"

    def __init__(self, publisher: RealtimePublisher) -> None:
        self._publisher = publisher

    async def deliver(
        self,
        *,
        db: AsyncSession,
        event: DomainEventEnvelope,
        idempotency_key: str,
    ) -> DeliveryResult:
        reference = await self._publisher.publish(
            db=db,
            topic=REALTIME_TOPIC,
            event=event,
            idempotency_key=idempotency_key,
        )
        return DeliveryResult(
            disposition="applied" if reference is not None else "ignored",
            result_reference=reference,
        )


def _invalidation(event: DomainEventEnvelope) -> _Invalidation | None:
    roles = _audience_roles(event)
    if not roles:
        return None
    payload = event.payload

    if event.event_type == "telemetry.observation_recorded.v2":
        resource = _mapping(payload.get("resource"))
        if resource is None:
            raise _invalid_realtime_event("A telemetry event has no resource payload.")
        if resource.get("becameCurrent") is False:
            return None
        if (
            resource.get("becameCurrent") is not True
            or event.aggregate_type != "telemetry_observation"
            or event.enterprise_id is None
            or event.site_id is None
        ):
            raise _invalid_realtime_event("A telemetry event has an invalid resource scope.")
        version = _positive_int(resource.get("liveStateVersion"))
        if version is None:
            raise _invalid_realtime_event("A current telemetry event has no live-state version.")
        return _Invalidation(
            resource_type="site_live_state",
            resource_id=event.site_id,
            resource_version=version,
            invalidates=(
                "/operational/sites/v2",
                "/operational/live/sites/v2",
                f"/operational/live/sites/{event.site_id}/v2",
            ),
            audience_roles=roles,
        )

    if event.event_type == "telemetry.epoch_registered.v2":
        if (
            event.aggregate_type != "device_telemetry_epoch"
            or event.enterprise_id is None
            or event.site_id is None
        ):
            raise _invalid_realtime_event("A telemetry epoch event has an invalid resource scope.")
        return _Invalidation(
            resource_type="site_live_state",
            resource_id=event.site_id,
            resource_version=event.aggregate_version,
            invalidates=(
                "/operational/sites/v2",
                "/operational/live/sites/v2",
                f"/operational/live/sites/{event.site_id}/v2",
            ),
            audience_roles=roles,
        )

    if event.event_type in {
        "sync_health.alert_opened",
        "sync_health.alert_updated",
        "sync_health.alert_resolved",
    }:
        condition_state_id = _string(payload.get("conditionStateId"))
        operational_alert_id = _string(payload.get("operationalAlertId"))
        enterprise_id = _string(payload.get("enterpriseId"))
        site_id = _string(payload.get("siteId"))
        if (
            condition_state_id is None
            or condition_state_id != event.aggregate_id
            or operational_alert_id is None
            or enterprise_id != event.enterprise_id
            or site_id != event.site_id
            or event.aggregate_type != "site_sync_health"
            or event.enterprise_id is None
            or event.site_id is None
        ):
            raise _invalid_realtime_event(
                "A sync-health alert event has an invalid resource scope."
            )
        return _Invalidation(
            resource_type="operational_alert",
            resource_id=operational_alert_id,
            resource_version=event.aggregate_version,
            invalidates=("/operational/alerts", "/operational/summary"),
            audience_roles=roles,
        )

    if event.event_type in {
        "operational_alert.created.v2",
        "operational_alert.updated.v2",
        "operational_alert.resolved.v2",
    }:
        alert_id = _string(payload.get("operationalAlertId"))
        if (
            alert_id is None
            or alert_id != event.aggregate_id
            or event.aggregate_type != "operational_alert"
            or event.enterprise_id is not None
            or event.site_id is not None
        ):
            raise _invalid_realtime_event("An operational-alert event has an invalid scope.")
        return _Invalidation(
            resource_type="operational_alert",
            resource_id=alert_id,
            resource_version=event.aggregate_version,
            invalidates=("/operational/alerts", "/operational/summary"),
            audience_roles=roles,
        )

    if event.event_type in {
        "user_notification.created.v2",
        "user_notification.updated.v2",
    }:
        notification_id = _string(payload.get("notificationId"))
        recipient_account_id = _string(payload.get("recipientAccountId"))
        recipient_role = _string(payload.get("recipientRole"))
        if (
            notification_id is None
            or notification_id != event.aggregate_id
            or recipient_account_id is None
            or recipient_role is None
            or event.aggregate_type != "user_notification"
            or event.site_id is not None
        ):
            raise _invalid_realtime_event("A user-notification event has an invalid scope.")
        return _Invalidation(
            resource_type="user_notification",
            resource_id=notification_id,
            resource_version=event.aggregate_version,
            invalidates=("/operational/notifications",),
            audience_roles=roles,
            recipient_account_id=recipient_account_id,
        )

    if event.event_type.startswith("enterprise_report."):
        if event.event_type not in {
            "enterprise_report.revision_submitted",
            "enterprise_report.returned",
            "enterprise_report.accepted",
            "enterprise_report.reopened",
        }:
            return None
        report_id = _string(payload.get("enterpriseReportId"))
        if (
            report_id is None
            or report_id != event.aggregate_id
            or event.aggregate_type != "enterprise_report"
            or event.enterprise_id is None
            or event.site_id is None
        ):
            raise _invalid_realtime_event("A report event has an invalid resource scope.")
        period_id = _string(payload.get("reportingPeriodId"))
        keys = [
            "/operational/reports/v2",
            "/operational/enterprise/reports/v2",
            f"enterprise-report:{report_id}",
        ]
        if period_id:
            keys.append(f"reporting-period-compliance:{period_id}")
        return _Invalidation(
            resource_type="enterprise_report",
            resource_id=report_id,
            resource_version=event.aggregate_version,
            invalidates=tuple(keys),
            audience_roles=roles,
        )

    if event.event_type == "final_report.version_finalized" or event.event_type in {
        "final_report.artifact_ready",
        "final_report.artifact_failed",
        "final_report.artifact_retry_scheduled",
        "final_report.artifact_repair_requested",
    }:
        finalization_id = _string(payload.get("reportFinalizationId"))
        period_id = _string(payload.get("reportingPeriodId"))
        artifact_id = _string(payload.get("artifactId"))
        if (
            finalization_id is None
            or finalization_id != event.aggregate_id
            or period_id is None
            or event.aggregate_type != "report_finalization"
            or event.enterprise_id is not None
            or event.site_id is not None
            or (event.event_type != "final_report.version_finalized" and artifact_id is None)
        ):
            raise _invalid_realtime_event("A final-report event has an invalid resource scope.")
        keys = [
            "/operational/reports/v2",
            "/operational/reports/finalizations/v2",
            f"final-report:{finalization_id}",
            f"final-reports-period:{period_id}",
            f"reporting-period-compliance:{period_id}",
        ]
        return _Invalidation(
            resource_type="final_report",
            resource_id=finalization_id,
            resource_version=event.aggregate_version,
            invalidates=tuple(keys),
            audience_roles=roles,
        )

    if event.event_type in {
        "reporting_period.obligations_frozen",
        "reporting_period.obligations_reconciled",
    }:
        period_id = _string(payload.get("reportingPeriodId"))
        if (
            period_id is None
            or period_id != event.aggregate_id
            or event.aggregate_type != "reporting_period"
            or event.enterprise_id is not None
            or event.site_id is not None
        ):
            raise _invalid_realtime_event("A reporting-period event has an invalid resource scope.")
        return _Invalidation(
            resource_type="reporting_period_compliance",
            resource_id=period_id,
            resource_version=event.aggregate_version,
            invalidates=(f"reporting-period-compliance:{period_id}",),
            audience_roles=roles,
        )

    if event.event_type == "reporting_obligation.reminder_requested":
        target_path = _string(payload.get("targetPath"))
        period_id = _string(payload.get("reportingPeriodId"))
        if (
            target_path is None
            or period_id is None
            or event.aggregate_type != "reporting_obligation"
            or event.enterprise_id is None
            or event.site_id is None
        ):
            raise _invalid_realtime_event("A reporting reminder has an invalid resource scope.")
        if target_path != f"/enterprise/reports?periodId={period_id}":
            raise _invalid_realtime_event("A reporting reminder has an invalid target path.")
        return _Invalidation(
            resource_type="reporting_obligation",
            resource_id=event.aggregate_id,
            resource_version=event.aggregate_version,
            invalidates=(target_path,),
            audience_roles=roles,
        )
    return None


def _audience_roles(event: DomainEventEnvelope) -> tuple[str, ...]:
    # This channel backs official REST resources. Simulation requires a visibly
    # separate subscription and is never mixed into this stream.
    if event.classification != "official":
        return ()
    if event.event_type.startswith("telemetry."):
        return ("admin", "it", "enterprise")
    if event.event_type.startswith("sync_health."):
        return ("admin", "it")
    if event.event_type.startswith("operational_alert."):
        return ("admin", "it")
    if event.event_type.startswith("user_notification."):
        recipient_role = _string(event.payload.get("recipientRole"))
        return (recipient_role,) if recipient_role in {"admin", "it", "staff", "enterprise"} else ()
    if event.event_type == "enterprise_report.revision_submitted":
        return ("staff", "enterprise")
    if event.event_type.startswith("enterprise_report."):
        return ("staff", "enterprise")
    if event.event_type == "final_report.version_finalized" or event.event_type.startswith(
        "final_report.artifact_"
    ):
        return ("staff",)
    if event.event_type == "reporting_obligation.reminder_requested":
        return ("enterprise",)
    if event.event_type.startswith("reporting_period."):
        return ("staff", "admin")
    return ()


def _envelope(
    event: DomainEventEnvelope,
    invalidation: _Invalidation,
) -> OperationalWebSocketEnvelope:
    return OperationalWebSocketEnvelope(
        type="resource.invalidated",
        data={
            "contractVersion": 2,
            "eventId": event.id,
            "eventKey": event.event_key,
            "eventType": event.event_type,
            "resource": {
                "type": invalidation.resource_type,
                "id": invalidation.resource_id,
                "version": invalidation.resource_version,
            },
            "scope": {
                "classification": event.classification,
                "enterpriseId": event.enterprise_id,
                "siteId": event.site_id,
                "recipientAccountId": invalidation.recipient_account_id,
            },
            "invalidates": list(invalidation.invalidates),
            "audienceRoles": list(invalidation.audience_roles),
            "occurredAt": event.occurred_at.isoformat(),
            "refetchRequired": True,
        },
    )


def _mapping(value: JSONValue | None) -> dict[str, JSONValue] | None:
    return value if isinstance(value, dict) else None


def _string(value: JSONValue | None) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _positive_int(value: JSONValue | None) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 1 else None


def _asyncpg_dsn(database_url: str) -> str:
    normalized = database_url.strip()
    if normalized.startswith("postgresql+asyncpg://"):
        return normalized.replace("postgresql+asyncpg://", "postgresql://", 1)
    if normalized.startswith("postgres://"):
        return f"postgresql://{normalized.removeprefix('postgres://')}"
    if normalized.startswith("postgresql://"):
        return normalized
    raise ValueError("The realtime subscriber requires a PostgreSQL database URL.")


def _invalid_realtime_event(message: str) -> DomainEventDeliveryError:
    return DomainEventDeliveryError(
        message,
        error_code="realtime_event_scope_invalid",
        retryable=False,
    )
