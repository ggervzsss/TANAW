from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.features.reporting.contracts import (
    MetricGrain,
    MetricProvenance,
    MetricQuality,
    reporting_period_from_key,
)

SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceWindow(ContractModel):
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def validate_window(self) -> SourceWindow:
        _require_aware(self.start, "sourceWindow.start")
        _require_aware(self.end, "sourceWindow.end")
        if self.end <= self.start:
            raise ValueError("Source window end must be after its start.")
        return self


class ReportSourceBatchCommand(ContractModel):
    batchId: UUID
    cameraId: UUID
    eventCount: int = Field(gt=0)
    eventSequenceStart: int = Field(ge=0)
    eventSequenceEndExclusive: int = Field(ge=0)
    aggregateHash: str

    @model_validator(mode="after")
    def validate_membership(self) -> ReportSourceBatchCommand:
        if self.eventSequenceEndExclusive < self.eventSequenceStart:
            raise ValueError("Source-batch sequence end cannot precede its start.")
        if self.eventSequenceEndExclusive - self.eventSequenceStart != self.eventCount:
            raise ValueError("Source-batch sequence range must match eventCount.")
        if SHA256_PATTERN.fullmatch(self.aggregateHash) is None:
            raise ValueError("Source-batch aggregateHash must be a lowercase SHA-256 value.")
        return self


class CoverageGapCommand(ContractModel):
    reason: str = Field(min_length=1, max_length=120)
    durationSeconds: int = Field(gt=0)


class CoverageCommand(ContractModel):
    evidenceStatus: Literal["recorded", "not_recorded"]
    monitoredSeconds: int | None = Field(default=None, ge=0)
    expectedSeconds: int | None = Field(default=None, gt=0)
    gaps: list[CoverageGapCommand] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_duration(self) -> CoverageCommand:
        if self.evidenceStatus == "not_recorded":
            if self.monitoredSeconds is not None or self.expectedSeconds is not None or self.gaps:
                raise ValueError("Unrecorded coverage cannot contain invented durations or gaps.")
            return self
        if self.monitoredSeconds is None or self.expectedSeconds is None:
            raise ValueError("Recorded coverage must include monitored and expected durations.")
        if self.monitoredSeconds > self.expectedSeconds:
            raise ValueError("Monitored coverage cannot exceed expected coverage.")
        gap_seconds = sum(gap.durationSeconds for gap in self.gaps)
        if self.monitoredSeconds + gap_seconds != self.expectedSeconds:
            raise ValueError(
                "Recorded coverage must account for the full expected duration exactly."
            )
        return self


class MetricCoverageCommand(ContractModel):
    evidenceStatus: Literal["recorded", "not_recorded"]
    monitoredSeconds: int | None = Field(default=None, ge=0)
    expectedSeconds: int | None = Field(default=None, gt=0)
    gapCount: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_evidence(self) -> MetricCoverageCommand:
        monitored_seconds = self.monitoredSeconds
        expected_seconds = self.expectedSeconds
        gap_count = self.gapCount
        values = (monitored_seconds, expected_seconds, gap_count)
        if self.evidenceStatus == "not_recorded":
            if any(value is not None for value in values):
                raise ValueError("Unrecorded metric coverage cannot contain invented values.")
            return self
        if monitored_seconds is None or expected_seconds is None or gap_count is None:
            raise ValueError("Recorded metric coverage must include all coverage values.")
        if monitored_seconds > expected_seconds:
            raise ValueError("Metric monitored coverage cannot exceed expected coverage.")
        return self


class ReportMetricCommand(ContractModel):
    definition: str = Field(min_length=1, max_length=120)
    definitionVersion: int = Field(ge=1)
    value: int | float | None
    unit: str = Field(min_length=1, max_length=60)
    grain: MetricGrain
    windowStart: datetime
    windowEnd: datetime
    timezone: Literal["Asia/Manila"] = "Asia/Manila"
    provenance: MetricProvenance
    quality: MetricQuality
    coverage: MetricCoverageCommand

    @model_validator(mode="after")
    def validate_evidence(self) -> ReportMetricCommand:
        _require_aware(self.windowStart, "metric.windowStart")
        _require_aware(self.windowEnd, "metric.windowEnd")
        if self.windowEnd <= self.windowStart:
            raise ValueError("Metric window end must be after its start.")
        if self.quality == MetricQuality.UNKNOWN and self.value is not None:
            raise ValueError("Unknown-quality metrics must have a null value.")
        if self.quality != MetricQuality.UNKNOWN and self.value is None:
            raise ValueError("Known-quality metrics must include a value.")
        return self


class DemographicFactCommand(ContractModel):
    dimension: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=120)
    count: int = Field(ge=0)
    provenance: Literal["operator_entered"] = "operator_entered"
    quality: Literal[
        MetricQuality.CONFIRMED,
        MetricQuality.DEGRADED,
        MetricQuality.ESTIMATED,
    ] = MetricQuality.CONFIRMED


class ReportSubmissionCommandPayload(ContractModel):
    periodKey: str
    localRevisionId: str = Field(min_length=1, max_length=120)
    sourceWindow: SourceWindow
    sourceBatches: list[ReportSourceBatchCommand] = Field(min_length=1)
    metrics: list[ReportMetricCommand] = Field(min_length=1)
    demographicFacts: list[DemographicFactCommand] = Field(default_factory=list)
    coverage: CoverageCommand
    notes: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def validate_period_evidence(self) -> ReportSubmissionCommandPayload:
        period = reporting_period_from_key(self.periodKey)
        if self.sourceWindow.start != period.starts_at or self.sourceWindow.end != period.ends_at:
            raise ValueError("Source window must equal the canonical reporting-period bounds.")
        for metric in self.metrics:
            if metric.windowStart != period.starts_at or metric.windowEnd != period.ends_at:
                raise ValueError("Report metric windows must equal the reporting period.")
        batch_ids: set[UUID] = set()
        camera_ranges: dict[UUID, list[tuple[int, int]]] = {}
        for batch in self.sourceBatches:
            if batch.batchId in batch_ids:
                raise ValueError("Source-batch IDs must be unique within a report revision.")
            batch_ids.add(batch.batchId)
            ranges = camera_ranges.setdefault(batch.cameraId, [])
            if any(
                batch.eventSequenceStart < existing_end
                and existing_start < batch.eventSequenceEndExclusive
                for existing_start, existing_end in ranges
            ):
                raise ValueError("Source-batch event ranges cannot overlap for one camera.")
            ranges.append((batch.eventSequenceStart, batch.eventSequenceEndExclusive))
        demographic_keys = [(fact.dimension, fact.value) for fact in self.demographicFacts]
        if len(demographic_keys) != len(set(demographic_keys)):
            raise ValueError("Demographic dimension/value facts must be unique.")
        return self


class ReportSubmissionCommand(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    idempotencyKey: str = Field(
        min_length=8,
        max_length=240,
        pattern=r"^report:[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$",
    )
    occurredAt: datetime
    expectedVersion: int = Field(ge=0)
    payload: ReportSubmissionCommandPayload

    @model_validator(mode="after")
    def validate_command(self) -> ReportSubmissionCommand:
        _require_aware(self.occurredAt, "occurredAt")
        if not self.idempotencyKey.endswith(f":{self.payload.localRevisionId}"):
            raise ValueError("Report idempotency key must end with the local revision ID.")
        return self


class ReportAcknowledgementResource(ContractModel):
    periodKey: str
    reportingPeriodId: UUID
    enterpriseReportId: UUID
    reportRevisionId: UUID
    revisionNumber: int = Field(ge=1)
    workflowState: Literal["submitted"]
    logicalVersion: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_period_key(self) -> ReportAcknowledgementResource:
        reporting_period_from_key(self.periodKey)
        return self


class ReportSubmissionAcknowledgement(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    disposition: Literal["created", "replayed"]
    payloadHash: str
    acknowledgedAt: datetime
    resource: ReportAcknowledgementResource

    @model_validator(mode="after")
    def validate_acknowledgement(self) -> ReportSubmissionAcknowledgement:
        _require_aware(self.acknowledgedAt, "acknowledgedAt")
        if SHA256_PATTERN.fullmatch(self.payloadHash) is None:
            raise ValueError("Acknowledgement payloadHash must be a lowercase SHA-256 value.")
        return self


def canonical_payload_hash(payload: BaseModel | dict[str, object]) -> str:
    raw_value = payload.model_dump(mode="python") if isinstance(payload, BaseModel) else payload
    value = _canonical_json_value(raw_value)
    canonical = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _canonical_json_value(value: object) -> object:
    if isinstance(value, datetime):
        _require_aware(value, "canonical timestamp")
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _canonical_json_value(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_canonical_json_value(item) for item in value]
    return value


def _require_aware(value: datetime, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a UTC offset.")
