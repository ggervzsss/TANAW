from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from math import ceil, sin
from typing import Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.telemetry.envelopes import (
    CameraHealth,
    DeviceHealth,
    EpochStartCommand,
    EpochStartPayload,
    MetricCoverage,
    SyncHealth,
    TelemetryAcknowledgement,
    TelemetryCommand,
    TelemetryCommandPayload,
    TelemetryMetric,
)
from app.features.telemetry.models import DeviceTelemetryEpoch
from app.features.telemetry.service import ingest_telemetry_command, register_epoch_command
from app.features.topology.account_scope import AccountTopology, load_account_topologies
from app.features.topology.models import Camera, Enterprise, EnterpriseMembership


class SimulationModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FleetSimulationEnterprise(SimulationModel):
    enterpriseId: str
    enterpriseName: str
    category: str | None
    barangay: str | None


class FleetSimulationTarget(SimulationModel):
    enterpriseId: str = Field(min_length=1, max_length=120)
    lane: Literal["normal", "warning", "one-minute-breach"]
    capacity: int = Field(default=100, ge=1, le=100_000)
    thresholdPercent: int = Field(default=90, ge=1, le=100)


class FleetSimulationCommand(SimulationModel):
    contractVersion: Literal[2]
    runId: str = Field(min_length=3, max_length=80)
    startedAt: datetime
    elapsedSeconds: int = Field(ge=0, le=86_400)
    targets: list[FleetSimulationTarget] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def validate_command(self) -> FleetSimulationCommand:
        if self.startedAt.tzinfo is None or self.startedAt.utcoffset() is None:
            raise ValueError("Simulation start time must include a UTC offset.")
        target_ids = [target.enterpriseId for target in self.targets]
        if len(target_ids) != len(set(target_ids)):
            raise ValueError("A simulation tick cannot repeat an enterprise target.")
        return self


class FleetSimulationResult(SimulationModel):
    contractVersion: Literal[2]
    runId: str
    observations: list[TelemetryAcknowledgement]


async def list_simulation_enterprises(db: AsyncSession) -> list[FleetSimulationEnterprise]:
    accounts = list(
        await db.scalars(
            select(Account)
            .join(EnterpriseMembership, EnterpriseMembership.account_id == Account.id)
            .join(Enterprise, Enterprise.id == EnterpriseMembership.enterprise_id)
            .where(
                Account.role == AccountRole.ENTERPRISE,
                Account.status == AccountStatus.ACTIVE,
                Account.activated_at.is_not(None),
                Enterprise.classification == "simulation",
                Enterprise.lifecycle_state == "active",
            )
            .order_by(Enterprise.name.asc())
        )
    )
    topologies = await load_account_topologies(db, accounts)
    return [
        FleetSimulationEnterprise(
            enterpriseId=topology.enterprise.official_code,
            enterpriseName=topology.enterprise.name,
            category=topology.enterprise.category,
            barangay=topology.site.barangay,
        )
        for topology in topologies.values()
        if topology is not None and topology.enterprise.classification == "simulation"
    ]


async def ingest_simulation_tick(
    db: AsyncSession,
    *,
    command: FleetSimulationCommand,
) -> FleetSimulationResult:
    targets = await _simulation_targets(db, {target.enterpriseId for target in command.targets})
    observations: list[TelemetryAcknowledgement] = []
    for target in command.targets:
        topology = targets.get(target.enterpriseId)
        if topology is None:
            continue
        observations.append(
            await _ingest_target_tick(
                db,
                topology=topology,
                target=target,
                run_id=command.runId,
                started_at=command.startedAt.astimezone(UTC),
                elapsed_seconds=command.elapsedSeconds,
            )
        )
    return FleetSimulationResult(
        contractVersion=2,
        runId=command.runId,
        observations=observations,
    )


async def _simulation_targets(
    db: AsyncSession,
    enterprise_codes: set[str],
) -> dict[str, AccountTopology]:
    if not enterprise_codes:
        return {}
    accounts = list(
        await db.scalars(
            select(Account)
            .join(EnterpriseMembership, EnterpriseMembership.account_id == Account.id)
            .join(Enterprise, Enterprise.id == EnterpriseMembership.enterprise_id)
            .where(
                Account.role == AccountRole.ENTERPRISE,
                Account.status == AccountStatus.ACTIVE,
                Account.activated_at.is_not(None),
                Enterprise.official_code.in_(enterprise_codes),
                Enterprise.classification == "simulation",
                Enterprise.lifecycle_state == "active",
            )
        )
    )
    topologies = await load_account_topologies(db, accounts)
    return {
        topology.enterprise.official_code: topology
        for topology in topologies.values()
        if topology is not None and topology.enterprise.classification == "simulation"
    }


async def _ingest_target_tick(
    db: AsyncSession,
    *,
    topology: AccountTopology,
    target: FleetSimulationTarget,
    run_id: str,
    started_at: datetime,
    elapsed_seconds: int,
) -> TelemetryAcknowledgement:
    if len(topology.active_devices) != 1:
        raise RuntimeError("A simulation site must have exactly one active edge device.")
    device = topology.active_devices[0]
    device_id = UUID(device.id)
    counter_epoch = uuid5(NAMESPACE_URL, f"tanaw:fleet:{run_id}:{device.id}")
    active_epoch = await db.scalar(
        select(DeviceTelemetryEpoch).where(
            DeviceTelemetryEpoch.edge_device_id == device.id,
            DeviceTelemetryEpoch.status == "active",
        )
    )
    if active_epoch is None or active_epoch.counter_epoch != str(counter_epoch):
        latest_epoch = await db.scalar(
            select(DeviceTelemetryEpoch)
            .where(DeviceTelemetryEpoch.edge_device_id == device.id)
            .order_by(DeviceTelemetryEpoch.generation.desc())
            .limit(1)
        )
        expected_version = latest_epoch.generation if latest_epoch is not None else 0
        previous_epoch = UUID(active_epoch.counter_epoch) if active_epoch is not None else None
        epoch_command = EpochStartCommand(
            contractVersion=2,
            commandId=uuid5(NAMESPACE_URL, f"tanaw:fleet:epoch-command:{run_id}:{device.id}"),
            idempotencyKey=f"telemetry-epoch:{device.id}:{counter_epoch}",
            occurredAt=started_at,
            expectedVersion=expected_version,
            payload=EpochStartPayload(
                deviceId=device_id,
                counterEpoch=counter_epoch,
                expectedPreviousEpoch=previous_epoch,
            ),
        )
        epoch_acknowledgement = await register_epoch_command(
            db,
            account=topology.account,
            command=epoch_command,
        )
        generation = epoch_acknowledgement.resource.epochGeneration
    else:
        generation = active_epoch.generation

    observed_at = started_at + timedelta(seconds=elapsed_seconds)
    window_seconds = 5
    window_start = observed_at - timedelta(seconds=window_seconds)
    seed = _stable_seed(run_id, target.enterpriseId)
    occupancy = _occupancy(target, elapsed_seconds, seed)
    event_rate = _events_per_minute(target.lane)
    entries = max(0, round(event_rate * window_seconds / 60))
    exits = max(0, entries - ((occupancy + seed) % 2))
    unique_estimate = max(occupancy, round(occupancy * 1.08))
    coverage = MetricCoverage(
        evidenceStatus="recorded",
        monitoredSeconds=window_seconds,
        expectedSeconds=window_seconds,
        gapCount=0,
    )
    metrics = [
        TelemetryMetric(
            definition=definition,
            definitionVersion=1,
            value=value,
            unit=unit,
            grain="site",
            windowStart=window_start,
            windowEnd=observed_at,
            provenance="system_derived",
            quality="estimated",
            coverage=coverage,
        )
        for definition, value, unit in (
            ("visitor_entries", entries, "crossings"),
            ("visitor_exits", exits, "crossings"),
            ("occupancy_current", occupancy, "people"),
            ("occupancy_peak", max(occupancy, _peak(target, elapsed_seconds)), "people"),
            ("venue_local_unique_estimate", unique_estimate, "estimated_visitors"),
        )
    ]
    pending_count = 4 if target.lane == "warning" else 0
    active_cameras = list(
        await db.scalars(
            select(Camera).where(
                Camera.edge_device_id == device.id,
                Camera.site_id == topology.site.id,
                Camera.classification == "simulation",
                Camera.lifecycle_state == "active",
            )
        )
    )
    sync_health = SyncHealth(
        evidenceStatus="recorded",
        pendingCount=pending_count,
        oldestPendingAt=observed_at - timedelta(minutes=2) if pending_count else None,
        lastAcknowledgedAt=observed_at if not pending_count else None,
        lastFailureAt=observed_at - timedelta(seconds=30) if pending_count else None,
        lastFailureClass="simulation_retryable" if pending_count else None,
    )
    telemetry_command = TelemetryCommand(
        contractVersion=2,
        commandId=uuid5(
            NAMESPACE_URL,
            f"tanaw:fleet:observation:{run_id}:{device.id}:{elapsed_seconds}",
        ),
        idempotencyKey=f"telemetry:{device.id}:{counter_epoch}:{elapsed_seconds}",
        occurredAt=observed_at,
        expectedVersion=generation,
        payload=TelemetryCommandPayload(
            deviceId=device_id,
            counterEpoch=counter_epoch,
            epochGeneration=generation,
            sequence=elapsed_seconds,
            observedAt=observed_at,
            metrics=metrics,
            deviceHealth=DeviceHealth(
                service="healthy",
                cameraStates=[
                    CameraHealth(cameraId=UUID(camera.id), state="streaming")
                    for camera in active_cameras
                ],
                analyticsFps=24.0,
            ),
            syncHealth=sync_health,
        ),
    )
    return await ingest_telemetry_command(
        db,
        account=topology.account,
        command=telemetry_command,
    )


def _occupancy(target: FleetSimulationTarget, elapsed_seconds: int, seed: int) -> int:
    if target.lane == "warning":
        threshold = max(1, ceil(target.capacity * target.thresholdPercent / 100))
        center = max(0, threshold - max(1, ceil(target.capacity * 0.08)))
        wave = int(sin((elapsed_seconds + seed % 37) / 18) * max(1, target.capacity * 0.02))
        return _clamp(center + wave, 0, max(0, threshold - 1))
    if target.lane == "one-minute-breach":
        phase = elapsed_seconds % 180
        if 20 <= phase < 80:
            percent = target.thresholdPercent + 5 + sin((phase + seed % 23) / 12) * 2
        else:
            percent = _normal_percent(target.thresholdPercent, elapsed_seconds, seed)
        return _from_percent(target.capacity, percent)
    return _from_percent(
        target.capacity,
        _normal_percent(target.thresholdPercent, elapsed_seconds, seed),
    )


def _peak(target: FleetSimulationTarget, elapsed_seconds: int) -> int:
    if target.lane == "one-minute-breach" and 20 <= elapsed_seconds % 180 < 120:
        return _from_percent(target.capacity, min(100.0, target.thresholdPercent + 8))
    return 0


def _normal_percent(threshold_percent: int, elapsed_seconds: int, seed: int) -> float:
    upper = max(5.0, threshold_percent - 22)
    center = min(55.0, max(8.0, upper - 8))
    return min(upper, max(0.0, center + sin((elapsed_seconds + seed % 53) / 24) * 7))


def _from_percent(capacity: int, percent: float) -> int:
    return _clamp(round(capacity * percent / 100), 0, capacity)


def _events_per_minute(lane: str) -> int:
    return {"warning": 34, "one-minute-breach": 52}.get(lane, 22)


def _stable_seed(*parts: str) -> int:
    return int(sha256(":".join(parts).encode()).hexdigest()[:8], 16)


def _clamp(value: int, lower: int, upper: int) -> int:
    return min(upper, max(lower, value))
