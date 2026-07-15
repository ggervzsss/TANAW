from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal, cast
from uuid import UUID, uuid4

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.operational_observability import OperationalCounter, operational_observability
from app.features.accounts.models import Account
from app.features.alerts.sync_health import reconcile_site_sync_alert
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.telemetry.contracts import (
    ERROR_CAMERA_HEALTH_STATES,
    TELEMETRY_METRIC_CATALOG,
)
from app.features.telemetry.envelopes import (
    CoverageResponse,
    EnterpriseSitePage,
    EnterpriseSiteResource,
    EpochAcknowledgementResource,
    EpochStartAcknowledgement,
    EpochStartCommand,
    SiteLiveStatePage,
    SiteLiveStateResponse,
    SyncHealthResponse,
    TelemetryAcknowledgement,
    TelemetryAcknowledgementResource,
    TelemetryCommand,
    TelemetryMetric,
    canonical_payload_hash,
    canonical_payload_json,
)
from app.features.telemetry.models import (
    DeviceHealthSample,
    DeviceTelemetryEpoch,
    SiteLiveState,
    TelemetryMetricFact,
    TelemetryObservation,
)
from app.features.topology.access import (
    EnterpriseAccessScope,
    EnterpriseTopologyAccessError,
    require_effective_enterprise_access,
)
from app.features.topology.models import (
    Camera,
    EdgeDevice,
    Enterprise,
    EnterpriseSite,
    SiteLocationVersion,
)

LIVE_FRESH_FOR = timedelta(seconds=90)
LIVE_OFFLINE_AFTER = timedelta(minutes=5)
MAX_FUTURE_CLOCK_SKEW = timedelta(minutes=5)
EVENT_DESTINATIONS = ("notification_projection", "realtime_broadcast")


class TelemetryIntakeError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class TelemetryIntakeConflict(TelemetryIntakeError):
    pass


async def register_epoch_command(
    db: AsyncSession,
    *,
    account: Account,
    command: EpochStartCommand,
    acknowledged_at: datetime | None = None,
) -> EpochStartAcknowledgement:
    acknowledged_at = _as_utc(acknowledged_at or datetime.now(UTC))
    payload_hash = canonical_payload_hash(command.payload)
    access = await _enterprise_access_scope(
        db,
        account_id=account.id,
        evaluated_at=acknowledged_at,
        lock=True,
    )
    device, site = await _owned_device_scope(
        db,
        access=access,
        device_id=str(command.payload.deviceId),
        evaluated_at=acknowledged_at,
        lock=True,
    )
    await _reject_cross_kind_command_id(db, command_id=str(command.commandId), kind="epoch")

    replay = await _resolve_epoch_replay(
        db,
        device_id=device.id,
        command=command,
        payload_hash=payload_hash,
    )
    if replay is not None:
        return replay

    latest = await db.scalar(
        select(DeviceTelemetryEpoch)
        .where(DeviceTelemetryEpoch.edge_device_id == device.id)
        .order_by(DeviceTelemetryEpoch.generation.desc())
        .limit(1)
    )
    active = await db.scalar(
        select(DeviceTelemetryEpoch).where(
            DeviceTelemetryEpoch.edge_device_id == device.id,
            DeviceTelemetryEpoch.status == "active",
        )
    )
    current_version = latest.generation if latest is not None else 0
    if latest is not None and active is None:
        raise TelemetryIntakeConflict(
            "TELEMETRY_EPOCH_STATE_INVALID",
            "The device has epoch history but no active epoch; explicit recovery is required.",
        )
    if command.expectedVersion != current_version:
        raise TelemetryIntakeConflict(
            "STALE_RESOURCE_VERSION",
            f"The current telemetry epoch generation is {current_version}.",
        )
    expected_previous = (
        str(command.payload.expectedPreviousEpoch)
        if command.payload.expectedPreviousEpoch is not None
        else None
    )
    current_counter_epoch = active.counter_epoch if active is not None else None
    if expected_previous != current_counter_epoch:
        raise TelemetryIntakeConflict(
            "TELEMETRY_PREVIOUS_EPOCH_MISMATCH",
            "The expected previous epoch does not match the active server epoch.",
        )
    if active is not None and active.counter_epoch == str(command.payload.counterEpoch):
        raise TelemetryIntakeConflict(
            "TELEMETRY_EPOCH_ALREADY_ACTIVE",
            "A reset must rotate to a new counter epoch UUID.",
        )

    if active is not None:
        active.status = "retired"
        active.retired_at = acknowledged_at
        await db.flush([active])

    epoch = DeviceTelemetryEpoch(
        id=str(uuid4()),
        edge_device_id=device.id,
        site_id=site.id,
        classification=site.classification,
        counter_epoch=str(command.payload.counterEpoch),
        generation=current_version + 1,
        previous_epoch_id=active.id if active is not None else None,
        command_id=str(command.commandId),
        idempotency_key=command.idempotencyKey,
        payload_hash=payload_hash,
        status="active",
        registered_at=acknowledged_at,
    )
    device.counter_epoch = epoch.counter_epoch
    device.contract_version = 2
    device.last_authenticated_at = acknowledged_at
    db.add(epoch)
    await db.flush([device, epoch])

    resource = EpochAcknowledgementResource(
        telemetryEpochId=UUID(epoch.id),
        deviceId=UUID(device.id),
        counterEpoch=UUID(epoch.counter_epoch),
        epochGeneration=epoch.generation,
    )
    event = _domain_event(
        event_key=f"telemetry-epoch:{epoch.id}",
        event_type="telemetry.epoch_registered.v2",
        aggregate_type="device_telemetry_epoch",
        aggregate_id=epoch.id,
        aggregate_version=epoch.generation,
        enterprise_id=access.enterprise_id,
        site_id=site.id,
        classification=site.classification,
        actor_account_id=account.id,
        occurred_at=command.occurredAt,
        available_at=acknowledged_at,
        payload=_command_event_payload(
            command_id=command.commandId,
            idempotency_key=command.idempotencyKey,
            expected_version=command.expectedVersion,
            occurred_at=command.occurredAt,
            acknowledged_at=acknowledged_at,
            payload_hash=payload_hash,
            resource=resource.model_dump(mode="python"),
        ),
    )
    await _add_event_with_deliveries(db, event, acknowledged_at)
    return EpochStartAcknowledgement(
        contractVersion=2,
        commandId=command.commandId,
        disposition="created",
        payloadHash=payload_hash,
        acknowledgedAt=acknowledged_at,
        resource=resource,
    )


async def ingest_telemetry_command(
    db: AsyncSession,
    *,
    account: Account,
    command: TelemetryCommand,
    acknowledged_at: datetime | None = None,
) -> TelemetryAcknowledgement:
    acknowledged_at = _as_utc(acknowledged_at or datetime.now(UTC))
    settings = get_settings()
    payload_hash = canonical_payload_hash(command.payload)
    access = await _enterprise_access_scope(
        db,
        account_id=account.id,
        evaluated_at=acknowledged_at,
        lock=True,
    )
    device, site = await _owned_device_scope(
        db,
        access=access,
        device_id=str(command.payload.deviceId),
        evaluated_at=acknowledged_at,
        lock=True,
    )
    await _reject_cross_kind_command_id(db, command_id=str(command.commandId), kind="observation")

    replay = await _resolve_observation_replay(
        db,
        device_id=device.id,
        command=command,
        payload_hash=payload_hash,
    )
    if replay is not None:
        return replay

    if _as_utc(command.payload.observedAt) > acknowledged_at + MAX_FUTURE_CLOCK_SKEW:
        raise TelemetryIntakeError(
            "TELEMETRY_CLOCK_SKEW_INVALID",
            "The observation timestamp is too far in the future.",
        )
    epoch = await db.scalar(
        select(DeviceTelemetryEpoch).where(
            DeviceTelemetryEpoch.edge_device_id == device.id,
            DeviceTelemetryEpoch.counter_epoch == str(command.payload.counterEpoch),
            DeviceTelemetryEpoch.generation == command.payload.epochGeneration,
        )
    )
    if epoch is None:
        raise TelemetryIntakeConflict(
            "TELEMETRY_EPOCH_NOT_REGISTERED",
            "The telemetry counter epoch and generation have not been registered.",
        )
    if command.expectedVersion != epoch.generation:
        raise TelemetryIntakeConflict(
            "STALE_RESOURCE_VERSION",
            f"The acknowledged telemetry epoch generation is {epoch.generation}.",
        )

    sequence_owner = await db.scalar(
        select(TelemetryObservation).where(
            TelemetryObservation.edge_device_id == device.id,
            TelemetryObservation.telemetry_epoch_id == epoch.id,
            TelemetryObservation.sequence == command.payload.sequence,
        )
    )
    if sequence_owner is not None:
        raise TelemetryIntakeConflict(
            "TELEMETRY_SEQUENCE_CONFLICT",
            "The device epoch sequence is already bound to another command.",
        )

    await _validate_camera_lineage(db, device=device, command=command)
    current = await db.scalar(
        select(SiteLiveState).where(SiteLiveState.site_id == site.id).with_for_update()
    )
    observed_at = _as_utc(command.payload.observedAt)
    ordering = (epoch.generation, command.payload.sequence)
    current_ordering = (current.epoch_generation, current.sequence) if current is not None else None
    evidence_is_fresh = observed_at + LIVE_FRESH_FOR > acknowledged_at
    became_current = (
        epoch.status == "active"
        and evidence_is_fresh
        and (
            current_ordering is None
            or current is not None
            and current.edge_device_id != device.id
            or ordering > current_ordering
        )
    )
    if (
        epoch.status == "active"
        and evidence_is_fresh
        and current_ordering is not None
        and current is not None
        and current.edge_device_id == device.id
        and ordering <= current_ordering
    ):
        operational_observability.increment(OperationalCounter.TELEMETRY_PROJECTION_OUT_OF_ORDER)
    live_state_version = (
        (current.live_state_version + 1 if current is not None else 1) if became_current else None
    )

    observation = TelemetryObservation(
        id=str(uuid4()),
        enterprise_id=access.enterprise_id,
        site_id=site.id,
        edge_device_id=device.id,
        classification=site.classification,
        telemetry_epoch_id=epoch.id,
        epoch_generation=epoch.generation,
        sequence=command.payload.sequence,
        command_id=str(command.commandId),
        idempotency_key=command.idempotencyKey,
        payload_hash=payload_hash,
        observed_at=observed_at,
        received_at=acknowledged_at,
        payload_json=canonical_payload_json(command.payload),
        became_current=became_current,
        retention_expires_at=acknowledged_at
        + timedelta(days=settings.telemetry_raw_observation_retention_days),
    )
    device.contract_version = 2
    device.last_authenticated_at = acknowledged_at
    db.add(observation)
    await db.flush([device, observation])

    db.add_all(
        _metric_facts(
            command,
            observation,
            site.classification,
            retention=timedelta(days=settings.telemetry_metric_fact_retention_days),
        )
    )
    db.add(
        _health_sample(
            command,
            observation,
            site.classification,
            acknowledged_at,
            retention=timedelta(days=settings.telemetry_device_health_retention_days),
        )
    )
    if became_current:
        assert live_state_version is not None
        _apply_live_state(
            current=current,
            command=command,
            observation=observation,
            epoch=epoch,
            enterprise_id=access.enterprise_id,
            site_id=site.id,
            classification=site.classification,
            received_at=acknowledged_at,
            live_state_version=live_state_version,
            db=db,
        )
        await reconcile_site_sync_alert(
            db,
            enterprise=access.enterprise,
            site=site,
            device=device,
            sync=command.payload.syncHealth,
            evaluated_at=acknowledged_at,
            actor_account_id=account.id,
            causation_id=observation.id,
        )
    await db.flush()

    resource = TelemetryAcknowledgementResource(
        observationId=UUID(observation.id),
        siteId=UUID(site.id),
        counterEpoch=UUID(epoch.counter_epoch),
        epochGeneration=epoch.generation,
        sequence=command.payload.sequence,
        liveStateVersion=live_state_version,
        becameCurrent=became_current,
    )
    event = _domain_event(
        event_key=f"telemetry-observation:{observation.id}",
        event_type="telemetry.observation_recorded.v2",
        aggregate_type="telemetry_observation",
        aggregate_id=observation.id,
        aggregate_version=1,
        enterprise_id=access.enterprise_id,
        site_id=site.id,
        classification=site.classification,
        actor_account_id=account.id,
        occurred_at=command.occurredAt,
        available_at=acknowledged_at,
        payload=_command_event_payload(
            command_id=command.commandId,
            idempotency_key=command.idempotencyKey,
            expected_version=command.expectedVersion,
            occurred_at=command.occurredAt,
            acknowledged_at=acknowledged_at,
            payload_hash=payload_hash,
            resource=resource.model_dump(mode="python"),
        ),
    )
    await _add_event_with_deliveries(db, event, acknowledged_at)
    return TelemetryAcknowledgement(
        contractVersion=2,
        commandId=command.commandId,
        disposition="created",
        payloadHash=payload_hash,
        acknowledgedAt=acknowledged_at,
        resource=resource,
    )


async def list_official_live_sites(
    db: AsyncSession,
    *,
    limit: int,
    after_site_id: UUID | None,
    evaluated_at: datetime | None = None,
) -> SiteLiveStatePage:
    return await _list_live_sites(
        db,
        classification="official",
        enterprise_id=None,
        limit=limit,
        after_site_id=after_site_id,
        evaluated_at=evaluated_at,
    )


async def list_enterprise_live_sites(
    db: AsyncSession,
    *,
    account: Account,
    limit: int,
    after_site_id: UUID | None,
    evaluated_at: datetime | None = None,
) -> SiteLiveStatePage:
    evaluated_at = _as_utc(evaluated_at or datetime.now(UTC))
    access = await _enterprise_access_scope(
        db,
        account_id=account.id,
        evaluated_at=evaluated_at,
        lock=False,
    )
    return await _list_live_sites(
        db,
        classification=access.classification,
        enterprise_id=access.enterprise_id,
        limit=limit,
        after_site_id=after_site_id,
        evaluated_at=evaluated_at,
    )


async def get_official_live_site(
    db: AsyncSession,
    *,
    site_id: UUID,
    evaluated_at: datetime | None = None,
) -> SiteLiveStateResponse:
    page = await _list_live_sites(
        db,
        classification="official",
        enterprise_id=None,
        limit=1,
        after_site_id=None,
        evaluated_at=evaluated_at,
        exact_site_id=str(site_id),
    )
    if not page.items:
        raise TelemetryIntakeError(
            "LIVE_SITE_NOT_FOUND",
            "No official sequenced live state exists for this site.",
        )
    return page.items[0]


async def list_official_sites(
    db: AsyncSession,
    *,
    limit: int,
    after_site_id: UUID | None,
    evaluated_at: datetime | None = None,
) -> EnterpriseSitePage:
    return await _list_sites(
        db,
        classification="official",
        enterprise_id=None,
        limit=limit,
        after_site_id=after_site_id,
        evaluated_at=evaluated_at,
    )


async def list_enterprise_sites(
    db: AsyncSession,
    *,
    account: Account,
    limit: int,
    after_site_id: UUID | None,
    evaluated_at: datetime | None = None,
) -> EnterpriseSitePage:
    evaluated_at = _as_utc(evaluated_at or datetime.now(UTC))
    access = await _enterprise_access_scope(
        db,
        account_id=account.id,
        evaluated_at=evaluated_at,
        lock=False,
    )
    return await _list_sites(
        db,
        classification=access.classification,
        enterprise_id=access.enterprise_id,
        limit=limit,
        after_site_id=after_site_id,
        evaluated_at=evaluated_at,
    )


async def _enterprise_access_scope(
    db: AsyncSession,
    *,
    account_id: str,
    evaluated_at: datetime,
    lock: bool,
) -> EnterpriseAccessScope:
    try:
        return await require_effective_enterprise_access(
            db,
            account_id=account_id,
            evaluated_at=evaluated_at,
            lock=lock,
        )
    except EnterpriseTopologyAccessError as exc:
        raise TelemetryIntakeError(exc.code, exc.message) from exc


async def _owned_device_scope(
    db: AsyncSession,
    *,
    access: EnterpriseAccessScope,
    device_id: str,
    evaluated_at: datetime,
    lock: bool,
) -> tuple[EdgeDevice, EnterpriseSite]:
    statement = (
        select(EdgeDevice, EnterpriseSite)
        .join(EnterpriseSite, EnterpriseSite.id == EdgeDevice.site_id)
        .where(
            EdgeDevice.id == device_id,
            EdgeDevice.classification == access.classification,
            EdgeDevice.lifecycle_state == "active",
            EdgeDevice.device_role == "telemetry_aggregator",
            EnterpriseSite.enterprise_id == access.enterprise_id,
            EnterpriseSite.classification == access.classification,
            EnterpriseSite.registered_at <= evaluated_at,
            or_(
                EnterpriseSite.retired_at.is_(None),
                EnterpriseSite.retired_at > evaluated_at,
            ),
        )
    )
    if lock:
        statement = statement.with_for_update(of=EdgeDevice)
    row = (await db.execute(statement)).one_or_none()
    if row is None:
        raise TelemetryIntakeError(
            "TELEMETRY_DEVICE_SCOPE_INVALID",
            "The device is not active topology owned by the authenticated enterprise.",
        )
    device, site = row
    active_aggregator_count = await db.scalar(
        select(func.count())
        .select_from(EdgeDevice)
        .where(
            EdgeDevice.site_id == site.id,
            EdgeDevice.classification == site.classification,
            EdgeDevice.lifecycle_state == "active",
            EdgeDevice.device_role == "telemetry_aggregator",
        )
    )
    if active_aggregator_count != 1:
        raise TelemetryIntakeError(
            "SITE_DEVICE_TOPOLOGY_AMBIGUOUS",
            "Sequenced site live state requires exactly one active telemetry aggregator per site.",
        )
    return device, site


async def _resolve_epoch_replay(
    db: AsyncSession,
    *,
    device_id: str,
    command: EpochStartCommand,
    payload_hash: str,
) -> EpochStartAcknowledgement | None:
    epochs = list(
        await db.scalars(
            select(DeviceTelemetryEpoch).where(
                or_(
                    DeviceTelemetryEpoch.command_id == str(command.commandId),
                    and_(
                        DeviceTelemetryEpoch.edge_device_id == device_id,
                        DeviceTelemetryEpoch.idempotency_key == command.idempotencyKey,
                    ),
                )
            )
        )
    )
    if not epochs:
        return None
    epoch = _one_replay_row(epochs)
    _validate_stored_identity(
        stored_device_id=epoch.edge_device_id,
        expected_device_id=device_id,
        stored_command_id=epoch.command_id,
        command_id=str(command.commandId),
        stored_idempotency_key=epoch.idempotency_key,
        idempotency_key=command.idempotencyKey,
        stored_payload_hash=epoch.payload_hash,
        payload_hash=payload_hash,
    )
    event_payload = await _stored_command_event_payload(db, event_key=f"telemetry-epoch:{epoch.id}")
    _validate_outer_replay(event_payload, command)
    return EpochStartAcknowledgement(
        contractVersion=2,
        commandId=command.commandId,
        disposition="replayed",
        payloadHash=payload_hash,
        acknowledgedAt=_event_datetime(event_payload, "acknowledgedAt"),
        resource=EpochAcknowledgementResource(
            telemetryEpochId=UUID(epoch.id),
            deviceId=UUID(epoch.edge_device_id),
            counterEpoch=UUID(epoch.counter_epoch),
            epochGeneration=epoch.generation,
        ),
    )


async def _resolve_observation_replay(
    db: AsyncSession,
    *,
    device_id: str,
    command: TelemetryCommand,
    payload_hash: str,
) -> TelemetryAcknowledgement | None:
    observations = list(
        await db.scalars(
            select(TelemetryObservation).where(
                or_(
                    TelemetryObservation.command_id == str(command.commandId),
                    and_(
                        TelemetryObservation.edge_device_id == device_id,
                        TelemetryObservation.idempotency_key == command.idempotencyKey,
                    ),
                )
            )
        )
    )
    if not observations:
        return None
    observation = _one_replay_row(observations)
    assert observation.edge_device_id is not None
    assert observation.command_id is not None
    assert observation.idempotency_key is not None
    _validate_stored_identity(
        stored_device_id=observation.edge_device_id,
        expected_device_id=device_id,
        stored_command_id=observation.command_id,
        command_id=str(command.commandId),
        stored_idempotency_key=observation.idempotency_key,
        idempotency_key=command.idempotencyKey,
        stored_payload_hash=observation.payload_hash,
        payload_hash=payload_hash,
    )
    event_payload = await _stored_command_event_payload(
        db, event_key=f"telemetry-observation:{observation.id}"
    )
    _validate_outer_replay(event_payload, command)
    raw_resource = event_payload.get("resource")
    if not isinstance(raw_resource, dict):
        raise TelemetryIntakeConflict(
            "TELEMETRY_RECEIPT_INVALID",
            "The durable telemetry acknowledgement resource is invalid.",
        )
    return TelemetryAcknowledgement(
        contractVersion=2,
        commandId=command.commandId,
        disposition="replayed",
        payloadHash=payload_hash,
        acknowledgedAt=_event_datetime(event_payload, "acknowledgedAt"),
        resource=TelemetryAcknowledgementResource.model_validate(raw_resource),
    )


async def _reject_cross_kind_command_id(
    db: AsyncSession,
    *,
    command_id: str,
    kind: Literal["epoch", "observation"],
) -> None:
    if kind == "epoch":
        existing = await db.scalar(
            select(TelemetryObservation.id).where(TelemetryObservation.command_id == command_id)
        )
    else:
        existing = await db.scalar(
            select(DeviceTelemetryEpoch.id).where(DeviceTelemetryEpoch.command_id == command_id)
        )
    if existing is not None:
        raise TelemetryIntakeConflict(
            "IDEMPOTENCY_IDENTITY_CONFLICT",
            "The command ID is already bound to another telemetry command kind.",
        )


async def _validate_camera_lineage(
    db: AsyncSession,
    *,
    device: EdgeDevice,
    command: TelemetryCommand,
) -> None:
    cameras = list(
        await db.scalars(
            select(Camera).where(
                Camera.edge_device_id == device.id,
                Camera.site_id == device.site_id,
                Camera.classification == device.classification,
                Camera.lifecycle_state == "active",
            )
        )
    )
    active_ids = {camera.id for camera in cameras}
    health_ids = {str(camera.cameraId) for camera in command.payload.deviceHealth.cameraStates}
    if health_ids != active_ids:
        raise TelemetryIntakeError(
            "TELEMETRY_CAMERA_HEALTH_SCOPE_INVALID",
            "Device health must contain every active camera owned by this device exactly once.",
        )
    metric_ids = {
        str(metric.cameraId) for metric in command.payload.metrics if metric.cameraId is not None
    }
    if not metric_ids.issubset(active_ids):
        raise TelemetryIntakeError(
            "TELEMETRY_CAMERA_METRIC_SCOPE_INVALID",
            "A camera-grain metric references a camera outside the authenticated device.",
        )


def _metric_facts(
    command: TelemetryCommand,
    observation: TelemetryObservation,
    classification: str,
    *,
    retention: timedelta,
) -> list[TelemetryMetricFact]:
    facts: list[TelemetryMetricFact] = []
    for metric in command.payload.metrics:
        facts.append(
            TelemetryMetricFact(
                id=str(uuid4()),
                telemetry_observation_id=observation.id,
                enterprise_id=observation.enterprise_id,
                site_id=observation.site_id,
                camera_id=str(metric.cameraId) if metric.cameraId is not None else None,
                classification=classification,
                fact_status="qualified",
                definition=metric.definition,
                definition_version=metric.definitionVersion,
                value=Decimal(str(metric.value)) if metric.value is not None else None,
                unit=metric.unit,
                grain=metric.grain,
                metric_window_start=_as_utc(metric.windowStart),
                metric_window_end=_as_utc(metric.windowEnd),
                timezone_name=metric.timezone,
                provenance=metric.provenance,
                quality=metric.quality,
                coverage_evidence_status=metric.coverage.evidenceStatus,
                monitored_seconds=metric.coverage.monitoredSeconds,
                expected_seconds=metric.coverage.expectedSeconds,
                coverage_gap_count=metric.coverage.gapCount,
                retention_expires_at=observation.received_at + retention,
            )
        )
    return facts


def _health_sample(
    command: TelemetryCommand,
    observation: TelemetryObservation,
    classification: str,
    received_at: datetime,
    *,
    retention: timedelta,
) -> DeviceHealthSample:
    health = command.payload.deviceHealth
    sync = command.payload.syncHealth
    camera_count = len(health.cameraStates)
    streaming_count = sum(camera.state == "streaming" for camera in health.cameraStates)
    error_count = sum(camera.state in ERROR_CAMERA_HEALTH_STATES for camera in health.cameraStates)
    health_json = canonical_payload_json(
        {"cameraStates": [camera.model_dump(mode="python") for camera in health.cameraStates]}
    )
    return DeviceHealthSample(
        id=str(uuid4()),
        telemetry_observation_id=observation.id,
        edge_device_id=cast(str, observation.edge_device_id),
        site_id=observation.site_id,
        classification=classification,
        observed_at=observation.observed_at,
        received_at=received_at,
        service_state=health.service,
        camera_count=camera_count,
        streaming_camera_count=streaming_count,
        error_camera_count=error_count,
        analytics_fps=health.analyticsFps,
        sync_evidence_status=sync.evidenceStatus,
        pending_count=sync.pendingCount,
        oldest_pending_at=_optional_utc(sync.oldestPendingAt),
        last_acknowledged_at=_optional_utc(sync.lastAcknowledgedAt),
        last_failure_at=_optional_utc(sync.lastFailureAt),
        last_failure_class=sync.lastFailureClass,
        health_json=health_json,
        retention_expires_at=received_at + retention,
    )


def _apply_live_state(
    *,
    current: SiteLiveState | None,
    command: TelemetryCommand,
    observation: TelemetryObservation,
    epoch: DeviceTelemetryEpoch,
    enterprise_id: str,
    site_id: str,
    classification: str,
    received_at: datetime,
    live_state_version: int,
    db: AsyncSession,
) -> None:
    site_metrics = [metric for metric in command.payload.metrics if metric.grain == "site"]
    values = _live_metric_values(site_metrics)
    evidence = site_metrics[0] if site_metrics else None
    fields: dict[str, Any] = {
        "enterprise_id": enterprise_id,
        "edge_device_id": cast(str, observation.edge_device_id),
        "classification": classification,
        "telemetry_epoch_id": epoch.id,
        "telemetry_observation_id": observation.id,
        "epoch_generation": epoch.generation,
        "sequence": cast(int, observation.sequence),
        "live_state_version": live_state_version,
        "observed_at": observation.observed_at,
        "received_at": received_at,
        "freshness_expires_at": observation.observed_at + LIVE_FRESH_FOR,
        "offline_after_at": observation.observed_at + LIVE_OFFLINE_AFTER,
        "last_freshness_evaluated_at": received_at,
        "freshness_state": "fresh",
        **values,
        "metric_window_start": _as_utc(evidence.windowStart) if evidence else None,
        "metric_window_end": _as_utc(evidence.windowEnd) if evidence else None,
        "metric_quality": evidence.quality if evidence else "unknown",
        "metric_provenance": evidence.provenance if evidence else "system_derived",
        "coverage_evidence_status": (
            evidence.coverage.evidenceStatus if evidence else "not_recorded"
        ),
        "monitored_seconds": evidence.coverage.monitoredSeconds if evidence else None,
        "expected_seconds": evidence.coverage.expectedSeconds if evidence else None,
        "coverage_gap_count": evidence.coverage.gapCount if evidence else None,
        "service_state": command.payload.deviceHealth.service,
        "pending_count": command.payload.syncHealth.pendingCount,
        "oldest_pending_at": _optional_utc(command.payload.syncHealth.oldestPendingAt),
        "last_acknowledged_at": _optional_utc(command.payload.syncHealth.lastAcknowledgedAt),
        "last_failure_at": _optional_utc(command.payload.syncHealth.lastFailureAt),
        "last_failure_class": command.payload.syncHealth.lastFailureClass,
    }
    if current is None:
        current = SiteLiveState(site_id=site_id, **fields)
        db.add(current)
        return
    for field, value in fields.items():
        setattr(current, field, value)


def _live_metric_values(metrics: list[TelemetryMetric]) -> dict[str, int | None]:
    values: dict[str, int | None] = {
        "current_occupancy": None,
        "entries_window": None,
        "exits_window": None,
        "peak_occupancy_window": None,
        "unique_visitor_estimate_window": None,
    }
    for metric in metrics:
        field = TELEMETRY_METRIC_CATALOG[metric.definition].projects_to_live_state
        if field is not None and metric.value is not None:
            values[field] = int(metric.value)
    return values


async def _list_live_sites(
    db: AsyncSession,
    *,
    classification: str,
    enterprise_id: str | None,
    limit: int,
    after_site_id: UUID | None,
    evaluated_at: datetime | None,
    exact_site_id: str | None = None,
) -> SiteLiveStatePage:
    evaluated_at = _as_utc(evaluated_at or datetime.now(UTC))
    statement = (
        select(
            SiteLiveState,
            EnterpriseSite,
            SiteLocationVersion,
            DeviceTelemetryEpoch.counter_epoch,
        )
        .join(
            EnterpriseSite,
            and_(
                EnterpriseSite.id == SiteLiveState.site_id,
                EnterpriseSite.enterprise_id == SiteLiveState.enterprise_id,
                EnterpriseSite.classification == SiteLiveState.classification,
            ),
        )
        .join(
            Enterprise,
            and_(
                Enterprise.id == EnterpriseSite.enterprise_id,
                Enterprise.classification == EnterpriseSite.classification,
            ),
        )
        .join(
            EdgeDevice,
            and_(
                EdgeDevice.id == SiteLiveState.edge_device_id,
                EdgeDevice.site_id == SiteLiveState.site_id,
                EdgeDevice.classification == SiteLiveState.classification,
            ),
        )
        .join(
            SiteLocationVersion,
            and_(
                SiteLocationVersion.site_id == SiteLiveState.site_id,
                SiteLocationVersion.classification == SiteLiveState.classification,
                SiteLocationVersion.effective_to.is_(None),
            ),
        )
        .join(DeviceTelemetryEpoch, DeviceTelemetryEpoch.id == SiteLiveState.telemetry_epoch_id)
        .where(
            SiteLiveState.classification == classification,
            EnterpriseSite.classification == classification,
            Enterprise.classification == classification,
            Enterprise.lifecycle_state == "active",
            EdgeDevice.classification == classification,
            EdgeDevice.lifecycle_state == "active",
            EdgeDevice.device_role == "telemetry_aggregator",
            EnterpriseSite.registered_at <= evaluated_at,
            or_(
                EnterpriseSite.retired_at.is_(None),
                EnterpriseSite.retired_at > evaluated_at,
            ),
        )
        .order_by(SiteLiveState.site_id)
        .limit(limit + 1)
    )
    if enterprise_id is not None:
        statement = statement.where(SiteLiveState.enterprise_id == enterprise_id)
    if after_site_id is not None:
        statement = statement.where(SiteLiveState.site_id > str(after_site_id))
    if exact_site_id is not None:
        statement = statement.where(SiteLiveState.site_id == exact_site_id)
    rows = (await db.execute(statement)).all()
    has_more = len(rows) > limit
    selected = rows[:limit]
    items = [
        _live_response(state, site, location, counter_epoch, evaluated_at)
        for state, site, location, counter_epoch in selected
    ]
    next_cursor = UUID(selected[-1][0].site_id) if has_more and selected else None
    return SiteLiveStatePage(items=items, nextCursor=next_cursor)


async def _list_sites(
    db: AsyncSession,
    *,
    classification: str,
    enterprise_id: str | None,
    limit: int,
    after_site_id: UUID | None,
    evaluated_at: datetime | None,
) -> EnterpriseSitePage:
    evaluated_at = _as_utc(evaluated_at or datetime.now(UTC))
    statement = (
        select(
            EnterpriseSite,
            Enterprise,
            SiteLocationVersion,
            SiteLiveState,
            DeviceTelemetryEpoch.counter_epoch,
        )
        .join(Enterprise, Enterprise.id == EnterpriseSite.enterprise_id)
        .join(
            SiteLocationVersion,
            and_(
                SiteLocationVersion.site_id == EnterpriseSite.id,
                SiteLocationVersion.classification == EnterpriseSite.classification,
                SiteLocationVersion.effective_to.is_(None),
            ),
        )
        .outerjoin(SiteLiveState, SiteLiveState.site_id == EnterpriseSite.id)
        .outerjoin(
            DeviceTelemetryEpoch,
            DeviceTelemetryEpoch.id == SiteLiveState.telemetry_epoch_id,
        )
        .where(
            EnterpriseSite.classification == classification,
            Enterprise.classification == classification,
            Enterprise.lifecycle_state == "active",
            EnterpriseSite.registered_at <= evaluated_at,
            or_(
                EnterpriseSite.retired_at.is_(None),
                EnterpriseSite.retired_at > evaluated_at,
            ),
        )
        .order_by(EnterpriseSite.id)
        .limit(limit + 1)
    )
    if enterprise_id is not None:
        statement = statement.where(EnterpriseSite.enterprise_id == enterprise_id)
    if after_site_id is not None:
        statement = statement.where(EnterpriseSite.id > str(after_site_id))

    rows = (await db.execute(statement)).all()
    has_more = len(rows) > limit
    selected = rows[:limit]
    site_ids = [site.id for site, _enterprise, _location, _state, _epoch in selected]
    devices_by_site: dict[str, list[EdgeDevice]] = {site_id: [] for site_id in site_ids}
    cameras_by_device: dict[str, list[Camera]] = {}
    if site_ids:
        devices = list(
            await db.scalars(
                select(EdgeDevice)
                .where(
                    EdgeDevice.site_id.in_(site_ids),
                    EdgeDevice.classification == classification,
                    EdgeDevice.lifecycle_state == "active",
                )
                .order_by(EdgeDevice.site_id, EdgeDevice.id)
            )
        )
        for device in devices:
            devices_by_site[device.site_id].append(device)
            cameras_by_device[device.id] = []
        device_ids = [device.id for device in devices]
        if device_ids:
            cameras = list(
                await db.scalars(
                    select(Camera)
                    .where(
                        Camera.edge_device_id.in_(device_ids),
                        Camera.classification == classification,
                        Camera.lifecycle_state == "active",
                    )
                    .order_by(Camera.edge_device_id, Camera.id)
                )
            )
            for camera in cameras:
                cameras_by_device[camera.edge_device_id].append(camera)

    items = [
        _site_resource(
            site=site,
            enterprise=enterprise,
            location=location,
            state=state,
            counter_epoch=counter_epoch,
            devices=devices_by_site[site.id],
            cameras_by_device=cameras_by_device,
            evaluated_at=evaluated_at,
        )
        for site, enterprise, location, state, counter_epoch in selected
    ]
    next_cursor = UUID(selected[-1][0].id) if has_more and selected else None
    return EnterpriseSitePage(
        items=items,
        nextCursor=next_cursor,
        evaluatedAt=evaluated_at,
    )


def _site_resource(
    *,
    site: EnterpriseSite,
    enterprise: Enterprise,
    location: SiteLocationVersion,
    state: SiteLiveState | None,
    counter_epoch: str | None,
    devices: list[EdgeDevice],
    cameras_by_device: dict[str, list[Camera]],
    evaluated_at: datetime,
) -> EnterpriseSiteResource:
    aggregators = [device for device in devices if device.device_role == "telemetry_aggregator"]
    if len(aggregators) == 1:
        topology_status = "ready"
    elif aggregators:
        topology_status = "ambiguous"
    else:
        topology_status = "unlinked"
    live_state = (
        _live_response(state, site, location, counter_epoch, evaluated_at)
        if (
            topology_status == "ready"
            and state is not None
            and counter_epoch is not None
            and state.edge_device_id == aggregators[0].id
        )
        else None
    )
    return EnterpriseSiteResource.model_validate(
        {
            "siteId": site.id,
            "enterpriseId": enterprise.id,
            "enterpriseCode": enterprise.official_code,
            "enterpriseName": enterprise.name,
            "enterpriseCategory": enterprise.category,
            "enterpriseLifecycleState": enterprise.lifecycle_state,
            "classification": site.classification,
            "siteCode": site.site_code,
            "siteName": site.name,
            "barangay": location.barangay,
            "address": location.address,
            "geocodedAddress": location.geocoded_address,
            "latitude": location.latitude,
            "longitude": location.longitude,
            "buildingCapacity": location.building_capacity,
            "timezone": location.timezone_name,
            "locationVersion": location.version,
            "coordinatesUpdatedAt": location.coordinates_confirmed_at,
            "topologyStatus": topology_status,
            "devices": [
                {
                    "deviceId": device.id,
                    "deviceKey": device.device_key,
                    "displayName": device.display_name,
                    "lifecycleState": device.lifecycle_state,
                    "contractVersion": device.contract_version,
                    "pairedAt": device.paired_at,
                    "lastAuthenticatedAt": device.last_authenticated_at,
                    "cameras": [
                        {
                            "cameraId": camera.id,
                            "cameraKey": camera.camera_key,
                            "displayName": camera.display_name,
                            "lifecycleState": camera.lifecycle_state,
                        }
                        for camera in cameras_by_device[device.id]
                    ],
                }
                for device in devices
            ],
            "liveState": live_state,
        }
    )


def _live_response(
    state: SiteLiveState,
    site: EnterpriseSite,
    location: SiteLocationVersion,
    counter_epoch: str,
    evaluated_at: datetime,
) -> SiteLiveStateResponse:
    if evaluated_at < _as_utc(state.freshness_expires_at):
        freshness: Literal["fresh", "stale", "offline"] = "fresh"
    elif evaluated_at < _as_utc(state.offline_after_at):
        freshness = "stale"
    else:
        freshness = "offline"
    is_fresh = freshness == "fresh"
    return SiteLiveStateResponse(
        siteId=UUID(state.site_id),
        enterpriseId=UUID(state.enterprise_id),
        siteCode=site.site_code,
        siteName=site.name,
        classification=cast(Literal["official", "simulation"], state.classification),
        latitude=location.latitude,
        longitude=location.longitude,
        buildingCapacity=location.building_capacity,
        deviceId=UUID(state.edge_device_id),
        telemetryObservationId=UUID(state.telemetry_observation_id),
        counterEpoch=UUID(counter_epoch),
        epochGeneration=state.epoch_generation,
        sequence=state.sequence,
        liveStateVersion=state.live_state_version,
        observedAt=_as_utc(state.observed_at),
        receivedAt=_as_utc(state.received_at),
        freshnessExpiresAt=_as_utc(state.freshness_expires_at),
        offlineAfterAt=_as_utc(state.offline_after_at),
        freshnessEvaluatedAt=evaluated_at,
        freshnessState=freshness,
        sourceAgeSeconds=max(0.0, (evaluated_at - _as_utc(state.observed_at)).total_seconds()),
        currentOccupancy=state.current_occupancy if is_fresh else None,
        entriesWindow=state.entries_window if is_fresh else None,
        exitsWindow=state.exits_window if is_fresh else None,
        peakOccupancyWindow=state.peak_occupancy_window if is_fresh else None,
        venueLocalUniqueEstimateWindow=(state.unique_visitor_estimate_window if is_fresh else None),
        metricWindowStart=_optional_utc(state.metric_window_start),
        metricWindowEnd=_optional_utc(state.metric_window_end),
        metricQuality=cast(
            Literal["confirmed", "degraded", "estimated", "unknown"],
            state.metric_quality if is_fresh else "unknown",
        ),
        metricProvenance=cast(
            Literal["camera_derived", "operator_entered", "system_derived"],
            state.metric_provenance,
        ),
        coverage=CoverageResponse(
            evidenceStatus=cast(
                Literal["recorded", "not_recorded"], state.coverage_evidence_status
            ),
            monitoredSeconds=state.monitored_seconds,
            expectedSeconds=state.expected_seconds,
            gapCount=state.coverage_gap_count,
        ),
        serviceState=cast(
            Literal["healthy", "degraded", "unavailable", "unknown"],
            state.service_state
            if is_fresh
            else ("unavailable" if freshness == "offline" else "unknown"),
        ),
        syncHealth=SyncHealthResponse(
            pendingCount=state.pending_count if is_fresh else None,
            oldestPendingAt=(_optional_utc(state.oldest_pending_at) if is_fresh else None),
            lastAcknowledgedAt=_optional_utc(state.last_acknowledged_at),
            lastFailureAt=_optional_utc(state.last_failure_at),
            lastFailureClass=state.last_failure_class,
        ),
    )


def _domain_event(
    *,
    event_key: str,
    event_type: str,
    aggregate_type: str,
    aggregate_id: str,
    aggregate_version: int,
    enterprise_id: str,
    site_id: str,
    classification: str,
    actor_account_id: str,
    occurred_at: datetime,
    available_at: datetime,
    payload: dict[str, object],
) -> DomainEvent:
    payload_json = canonical_payload_json(payload)
    return DomainEvent(
        id=str(uuid4()),
        event_key=event_key,
        event_type=event_type,
        contract_version=2,
        schema_version=1,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        aggregate_version=aggregate_version,
        enterprise_id=enterprise_id,
        site_id=site_id,
        classification=classification,
        actor_account_id=actor_account_id,
        correlation_id=None,
        causation_id=None,
        payload_json=payload_json,
        payload_hash=canonical_payload_hash(payload),
        occurred_at=_as_utc(occurred_at),
        available_at=available_at,
        retention_expires_at=None,
    )


async def _add_event_with_deliveries(
    db: AsyncSession, event: DomainEvent, available_at: datetime
) -> None:
    db.add(event)
    await db.flush([event])
    db.add_all(
        [
            DomainEventDelivery(
                id=str(uuid4()),
                domain_event_id=event.id,
                destination=destination,
                status="pending",
                attempt_count=0,
                next_attempt_at=available_at,
            )
            for destination in EVENT_DESTINATIONS
        ]
    )
    await db.flush()


def _command_event_payload(
    *,
    command_id: UUID,
    idempotency_key: str,
    expected_version: int,
    occurred_at: datetime,
    acknowledged_at: datetime,
    payload_hash: str,
    resource: dict[str, object],
) -> dict[str, object]:
    return {
        "commandId": command_id,
        "idempotencyKey": idempotency_key,
        "expectedVersion": expected_version,
        "occurredAt": occurred_at,
        "acknowledgedAt": acknowledged_at,
        "payloadHash": payload_hash,
        "resource": resource,
    }


async def _stored_command_event_payload(db: AsyncSession, *, event_key: str) -> dict[str, object]:
    event = await db.scalar(select(DomainEvent).where(DomainEvent.event_key == event_key))
    if event is None:
        raise TelemetryIntakeConflict(
            "TELEMETRY_RECEIPT_MISSING",
            "The durable telemetry command receipt event is missing.",
        )
    try:
        raw = json.loads(event.payload_json)
    except json.JSONDecodeError as exc:
        raise TelemetryIntakeConflict(
            "TELEMETRY_RECEIPT_INVALID",
            "The durable telemetry command receipt is invalid.",
        ) from exc
    if not isinstance(raw, dict):
        raise TelemetryIntakeConflict(
            "TELEMETRY_RECEIPT_INVALID",
            "The durable telemetry command receipt is invalid.",
        )
    return cast(dict[str, object], raw)


def _validate_outer_replay(
    payload: dict[str, object], command: EpochStartCommand | TelemetryCommand
) -> None:
    if (
        payload.get("commandId") != str(command.commandId)
        or payload.get("idempotencyKey") != command.idempotencyKey
    ):
        raise TelemetryIntakeConflict(
            "IDEMPOTENCY_IDENTITY_CONFLICT",
            "The command identity does not match its durable receipt.",
        )
    if payload.get("expectedVersion") != command.expectedVersion:
        raise TelemetryIntakeConflict(
            "IDEMPOTENCY_EXPECTED_VERSION_CONFLICT",
            "The command was replayed with a different expectedVersion.",
        )
    if _event_datetime(payload, "occurredAt") != _as_utc(command.occurredAt):
        raise TelemetryIntakeConflict(
            "IDEMPOTENCY_OCCURRED_AT_CONFLICT",
            "The command was replayed with a different occurredAt timestamp.",
        )


def _validate_stored_identity(
    *,
    stored_device_id: str,
    expected_device_id: str,
    stored_command_id: str,
    command_id: str,
    stored_idempotency_key: str,
    idempotency_key: str,
    stored_payload_hash: str,
    payload_hash: str,
) -> None:
    if (
        stored_device_id != expected_device_id
        or stored_command_id != command_id
        or stored_idempotency_key != idempotency_key
    ):
        raise TelemetryIntakeConflict(
            "IDEMPOTENCY_IDENTITY_CONFLICT",
            "The command ID or idempotency key is already bound to another command.",
        )
    if stored_payload_hash != payload_hash:
        raise TelemetryIntakeConflict(
            "IDEMPOTENCY_PAYLOAD_CONFLICT",
            "The idempotency key is already bound to a different payload hash.",
        )


def _one_replay_row(rows: list[Any]) -> Any:
    if len(rows) != 1:
        raise TelemetryIntakeConflict(
            "IDEMPOTENCY_IDENTITY_CONFLICT",
            "The command ID and idempotency key resolve to different resources.",
        )
    return rows[0]


def _event_datetime(payload: dict[str, object], field: str) -> datetime:
    raw = payload.get(field)
    if not isinstance(raw, str):
        raise TelemetryIntakeConflict(
            "TELEMETRY_RECEIPT_INVALID",
            "The durable telemetry acknowledgement timestamp is invalid.",
        )
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise TelemetryIntakeConflict(
            "TELEMETRY_RECEIPT_INVALID",
            "The durable telemetry acknowledgement timestamp is invalid.",
        ) from exc
    return _as_utc(parsed)


def _optional_utc(value: datetime | None) -> datetime | None:
    return _as_utc(value) if value is not None else None


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Telemetry timestamps must include a UTC offset.")
    return value.astimezone(UTC)
