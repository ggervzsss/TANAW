from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.features.telemetry.contracts import TELEMETRY_METRIC_CATALOG

SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EpochStartPayload(ContractModel):
    deviceId: UUID
    counterEpoch: UUID
    expectedPreviousEpoch: UUID | None


class EpochStartCommand(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    idempotencyKey: str = Field(min_length=8, max_length=240)
    occurredAt: datetime
    expectedVersion: int = Field(ge=0)
    payload: EpochStartPayload

    @model_validator(mode="after")
    def validate_command(self) -> EpochStartCommand:
        _require_aware(self.occurredAt, "occurredAt")
        expected_key = f"telemetry-epoch:{self.payload.deviceId}:{self.payload.counterEpoch}"
        if self.idempotencyKey != expected_key:
            raise ValueError("Epoch idempotency key must identify the device and counter epoch.")
        if self.expectedVersion == 0 and self.payload.expectedPreviousEpoch is not None:
            raise ValueError("The first epoch cannot claim a previous epoch.")
        if self.expectedVersion > 0 and self.payload.expectedPreviousEpoch is None:
            raise ValueError("An epoch reset must identify the expected previous epoch.")
        return self


class EpochAcknowledgementResource(ContractModel):
    telemetryEpochId: UUID
    deviceId: UUID
    counterEpoch: UUID
    epochGeneration: int = Field(ge=1)


class EpochStartAcknowledgement(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    disposition: Literal["created", "replayed"]
    payloadHash: str
    acknowledgedAt: datetime
    resource: EpochAcknowledgementResource

    @model_validator(mode="after")
    def validate_acknowledgement(self) -> EpochStartAcknowledgement:
        _validate_acknowledgement(self.payloadHash, self.acknowledgedAt)
        return self


class MetricCoverage(ContractModel):
    evidenceStatus: Literal["recorded", "not_recorded"]
    monitoredSeconds: int | None = Field(default=None, ge=0)
    expectedSeconds: int | None = Field(default=None, gt=0)
    gapCount: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_evidence(self) -> MetricCoverage:
        monitored = self.monitoredSeconds
        expected = self.expectedSeconds
        gap_count = self.gapCount
        if self.evidenceStatus == "not_recorded":
            if monitored is not None or expected is not None or gap_count is not None:
                raise ValueError("Unrecorded coverage cannot contain invented values.")
            return self
        if monitored is None or expected is None or gap_count is None:
            raise ValueError("Recorded coverage must include all coverage values.")
        if monitored > expected:
            raise ValueError("Monitored coverage cannot exceed expected coverage.")
        return self


class TelemetryMetric(ContractModel):
    definition: str = Field(min_length=1, max_length=120)
    definitionVersion: Literal[1]
    value: int | float | None
    unit: str = Field(min_length=1, max_length=60)
    grain: Literal["camera", "site"]
    cameraId: UUID | None = None
    windowStart: datetime
    windowEnd: datetime
    timezone: Literal["Asia/Manila"] = "Asia/Manila"
    provenance: Literal["camera_derived", "operator_entered", "system_derived"]
    quality: Literal["confirmed", "degraded", "estimated", "unknown"]
    coverage: MetricCoverage

    @model_validator(mode="after")
    def validate_metric(self) -> TelemetryMetric:
        _require_aware(self.windowStart, "metric.windowStart")
        _require_aware(self.windowEnd, "metric.windowEnd")
        if self.windowEnd <= self.windowStart:
            raise ValueError("Metric window end must be after its start.")
        definition = TELEMETRY_METRIC_CATALOG.get(self.definition)
        if definition is None:
            raise ValueError("Telemetry metric definition is not in the v2 catalog.")
        if self.unit != definition.unit or self.grain not in definition.allowed_grains:
            raise ValueError("Telemetry metric unit or grain does not match the v2 catalog.")
        if (self.grain == "camera") != (self.cameraId is not None):
            raise ValueError("Camera-grain metrics require cameraId; site metrics forbid it.")
        if self.quality == "unknown" and self.value is not None:
            raise ValueError("Unknown-quality metrics must have a null value.")
        if self.quality != "unknown" and self.value is None:
            raise ValueError("Known-quality metrics must include a value.")
        if self.value is not None:
            if isinstance(self.value, float) and not math.isfinite(self.value):
                raise ValueError("Telemetry metric values must be finite.")
            if self.value < 0:
                raise ValueError("Telemetry metric values cannot be negative.")
            if definition.integral and not float(self.value).is_integer():
                raise ValueError("This telemetry metric requires an integer value.")
            if self.definition == "coverage_ratio" and self.value > 1:
                raise ValueError("Coverage ratio cannot exceed one.")
        expected = self.coverage.expectedSeconds
        if expected is not None and (self.windowEnd - self.windowStart).total_seconds() != expected:
            raise ValueError("Recorded expected coverage must equal the metric window duration.")
        return self


class CameraHealth(ContractModel):
    cameraId: UUID
    state: Literal[
        "streaming",
        "reconnecting",
        "unavailable",
        "credential_error",
        "stopped",
        "unknown",
    ]


class DeviceHealth(ContractModel):
    service: Literal["healthy", "degraded", "unavailable", "unknown"]
    cameraStates: list[CameraHealth] = Field(default_factory=list, max_length=100)
    analyticsFps: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_health(self) -> DeviceHealth:
        camera_ids = [camera.cameraId for camera in self.cameraStates]
        if len(camera_ids) != len(set(camera_ids)):
            raise ValueError("Device health cannot repeat a camera ID.")
        if self.analyticsFps is not None and not math.isfinite(self.analyticsFps):
            raise ValueError("Analytics FPS must be finite.")
        return self


class SyncHealth(ContractModel):
    evidenceStatus: Literal["recorded", "not_recorded"]
    pendingCount: int | None = Field(default=None, ge=0)
    oldestPendingAt: datetime | None = None
    lastAcknowledgedAt: datetime | None = None
    lastFailureAt: datetime | None = None
    lastFailureClass: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_evidence(self) -> SyncHealth:
        timestamps = (
            (self.oldestPendingAt, "syncHealth.oldestPendingAt"),
            (self.lastAcknowledgedAt, "syncHealth.lastAcknowledgedAt"),
            (self.lastFailureAt, "syncHealth.lastFailureAt"),
        )
        for value, name in timestamps:
            if value is not None:
                _require_aware(value, name)
        if self.evidenceStatus == "not_recorded":
            if any(
                value is not None
                for value in (
                    self.pendingCount,
                    self.oldestPendingAt,
                    self.lastAcknowledgedAt,
                    self.lastFailureAt,
                    self.lastFailureClass,
                )
            ):
                raise ValueError("Unrecorded sync health cannot contain invented values.")
            return self
        if self.pendingCount is None:
            raise ValueError("Recorded sync health must include pendingCount.")
        if (self.pendingCount == 0) != (self.oldestPendingAt is None):
            raise ValueError("oldestPendingAt is required exactly when pending commands exist.")
        if (self.lastFailureAt is None) != (self.lastFailureClass is None):
            raise ValueError("Sync failure time and class must be supplied together.")
        return self


class TelemetryCommandPayload(ContractModel):
    deviceId: UUID
    counterEpoch: UUID
    epochGeneration: int = Field(ge=1)
    sequence: int = Field(ge=0)
    observedAt: datetime
    metrics: list[TelemetryMetric] = Field(default_factory=list, max_length=100)
    deviceHealth: DeviceHealth
    syncHealth: SyncHealth

    @model_validator(mode="after")
    def validate_payload(self) -> TelemetryCommandPayload:
        _require_aware(self.observedAt, "payload.observedAt")
        identities = [
            (metric.definition, metric.definitionVersion, metric.grain, metric.cameraId)
            for metric in self.metrics
        ]
        if len(identities) != len(set(identities)):
            raise ValueError("Telemetry metric identities must be unique in one observation.")
        windows = {(metric.windowStart, metric.windowEnd) for metric in self.metrics}
        if len(windows) > 1:
            raise ValueError("One telemetry observation cannot mix metric windows.")
        if any(metric.windowEnd != self.observedAt for metric in self.metrics):
            raise ValueError("Telemetry metric windows must end at observedAt.")
        site_metrics = [metric for metric in self.metrics if metric.grain == "site"]
        projection_evidence = {
            (
                metric.provenance,
                metric.quality,
                metric.coverage.evidenceStatus,
                metric.coverage.monitoredSeconds,
                metric.coverage.expectedSeconds,
                metric.coverage.gapCount,
            )
            for metric in site_metrics
        }
        if len(projection_evidence) > 1:
            raise ValueError("Site live metrics must share quality, provenance, and coverage.")
        return self


class TelemetryCommand(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    idempotencyKey: str = Field(min_length=8, max_length=240)
    occurredAt: datetime
    expectedVersion: int = Field(ge=1)
    payload: TelemetryCommandPayload

    @model_validator(mode="after")
    def validate_command(self) -> TelemetryCommand:
        _require_aware(self.occurredAt, "occurredAt")
        expected_key = (
            f"telemetry:{self.payload.deviceId}:{self.payload.counterEpoch}:{self.payload.sequence}"
        )
        if self.idempotencyKey != expected_key:
            raise ValueError("Telemetry idempotency key must identify device, epoch, and sequence.")
        if self.expectedVersion != self.payload.epochGeneration:
            raise ValueError(
                "Telemetry expectedVersion must equal the acknowledged epoch generation."
            )
        return self


class TelemetryAcknowledgementResource(ContractModel):
    observationId: UUID
    siteId: UUID
    counterEpoch: UUID
    epochGeneration: int = Field(ge=1)
    sequence: int = Field(ge=0)
    liveStateVersion: int | None = Field(default=None, ge=1)
    becameCurrent: bool

    @model_validator(mode="after")
    def validate_resource(self) -> TelemetryAcknowledgementResource:
        if self.becameCurrent != (self.liveStateVersion is not None):
            raise ValueError("Only a current observation has an assigned live-state version.")
        return self


class TelemetryAcknowledgement(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    disposition: Literal["created", "replayed"]
    payloadHash: str
    acknowledgedAt: datetime
    resource: TelemetryAcknowledgementResource

    @model_validator(mode="after")
    def validate_acknowledgement(self) -> TelemetryAcknowledgement:
        _validate_acknowledgement(self.payloadHash, self.acknowledgedAt)
        return self


class CoverageResponse(ContractModel):
    evidenceStatus: Literal["recorded", "not_recorded"]
    monitoredSeconds: int | None
    expectedSeconds: int | None
    gapCount: int | None


class SyncHealthResponse(ContractModel):
    pendingCount: int | None
    oldestPendingAt: datetime | None
    lastAcknowledgedAt: datetime | None
    lastFailureAt: datetime | None
    lastFailureClass: str | None


class SiteLiveStateResponse(ContractModel):
    siteId: UUID
    enterpriseId: UUID
    siteCode: str
    siteName: str
    classification: Literal["official", "simulation"]
    latitude: float | None
    longitude: float | None
    buildingCapacity: int
    deviceId: UUID
    telemetryObservationId: UUID
    counterEpoch: UUID
    epochGeneration: int
    sequence: int
    liveStateVersion: int
    observedAt: datetime
    receivedAt: datetime
    freshnessExpiresAt: datetime
    offlineAfterAt: datetime
    freshnessEvaluatedAt: datetime
    freshnessState: Literal["fresh", "stale", "offline"]
    sourceAgeSeconds: float
    currentOccupancy: int | None
    entriesWindow: int | None
    exitsWindow: int | None
    peakOccupancyWindow: int | None
    venueLocalUniqueEstimateWindow: int | None
    metricWindowStart: datetime | None
    metricWindowEnd: datetime | None
    metricQuality: Literal["confirmed", "degraded", "estimated", "unknown"]
    metricProvenance: Literal["camera_derived", "operator_entered", "system_derived"]
    coverage: CoverageResponse
    serviceState: Literal["healthy", "degraded", "unavailable", "unknown"]
    syncHealth: SyncHealthResponse


class SiteLiveStatePage(ContractModel):
    items: list[SiteLiveStateResponse]
    nextCursor: UUID | None


def canonical_payload_json(payload: BaseModel | dict[str, object]) -> str:
    raw_value = payload.model_dump(mode="python") if isinstance(payload, BaseModel) else payload
    return json.dumps(
        _canonical_json_value(raw_value),
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def canonical_payload_hash(payload: BaseModel | dict[str, object]) -> str:
    canonical = canonical_payload_json(payload)
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _canonical_json_value(value: object) -> object:
    if isinstance(value, datetime):
        _require_aware(value, "canonical timestamp")
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {str(key): _canonical_json_value(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_canonical_json_value(item) for item in value]
    return value


def _validate_acknowledgement(payload_hash: str, acknowledged_at: datetime) -> None:
    _require_aware(acknowledged_at, "acknowledgedAt")
    if SHA256_PATTERN.fullmatch(payload_hash) is None:
        raise ValueError("Acknowledgement payloadHash must be a lowercase SHA-256 value.")


def _require_aware(value: datetime, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a UTC offset.")
