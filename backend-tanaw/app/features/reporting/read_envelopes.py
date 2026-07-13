"""Authoritative Staff read contracts for the immutable report workflow."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.features.reporting.envelopes import ContractModel

OfficialClassification = Literal["official"]
ReportWorkflowState = Literal["submitted", "returned", "accepted", "consolidated"]


class CursorPageInfo(ContractModel):
    limit: int = Field(ge=1)
    returnedCount: int = Field(ge=0)
    hasMore: bool
    nextCursor: str | None


class ReportingPeriodResource(ContractModel):
    reportingPeriodId: UUID
    naturalKey: str
    label: str
    cadence: Literal["month"]
    timezone: Literal["Asia/Manila"]
    startsAt: datetime
    endsAt: datetime
    submissionOpensAt: datetime
    submissionClosesAt: datetime
    status: Literal["scheduled", "open", "closed"]
    obligationsFrozenAt: datetime | None


class ReportEnterpriseResource(ContractModel):
    enterpriseId: UUID
    enterpriseCode: str
    enterpriseName: str
    category: str | None


class ReportSiteResource(ContractModel):
    siteId: UUID
    siteCode: str
    siteName: str
    frozenBarangay: str | None


class ReportObligationResource(ContractModel):
    reportingObligationId: UUID
    eligibilityStatus: Literal["eligible", "exempt", "ineligible", "unknown"]
    eligibilityBasis: Literal["registry_snapshot", "legacy_submission", "manual_resolution"]
    exemptionReason: str | None
    registrationEffectiveAt: datetime | None
    acceptanceBlocked: bool


class ReportCoverageGapResource(ContractModel):
    reason: str
    durationSeconds: int = Field(gt=0)


class ReportCoverageResource(ContractModel):
    evidenceStatus: Literal["recorded", "not_recorded"]
    monitoredSeconds: int | None = Field(default=None, ge=0)
    expectedSeconds: int | None = Field(default=None, gt=0)
    coverageRatio: float | None = Field(default=None, ge=0, le=1)
    gapCount: int | None = Field(default=None, ge=0)
    gaps: list[ReportCoverageGapResource]


class MetricCoverageResource(ContractModel):
    evidenceStatus: Literal["recorded", "not_recorded"]
    monitoredSeconds: int | None = Field(default=None, ge=0)
    expectedSeconds: int | None = Field(default=None, gt=0)
    coverageRatio: float | None = Field(default=None, ge=0, le=1)
    gapCount: int | None = Field(default=None, ge=0)


class ReportMetricFactResource(ContractModel):
    metricFactId: UUID
    definition: str
    definitionVersion: int = Field(ge=1)
    value: Decimal | None
    unit: str
    grain: Literal["camera", "site", "enterprise"]
    windowStart: datetime
    windowEnd: datetime
    timezone: Literal["Asia/Manila"]
    provenance: Literal["camera_derived", "operator_entered", "system_derived"]
    quality: Literal["confirmed", "degraded", "estimated", "unknown"]
    coverage: MetricCoverageResource


class ReportDemographicFactResource(ContractModel):
    demographicFactId: UUID
    dimension: str
    value: str
    count: int = Field(ge=0)
    percentage: Decimal | None = Field(default=None, ge=0, le=100)
    provenance: Literal["operator_entered", "system_derived"]
    quality: Literal["confirmed", "degraded", "estimated"]


class ReportSourceBatchResource(ContractModel):
    batchId: UUID
    cameraId: UUID
    eventCount: int = Field(ge=0)
    eventSequenceStart: int = Field(ge=0)
    eventSequenceEndExclusive: int = Field(ge=0)
    aggregateHash: str


class ReportRevisionSummaryResource(ContractModel):
    reportRevisionId: UUID
    revisionNumber: int = Field(ge=1)
    isCurrent: bool
    isAccepted: bool
    submittedAt: datetime
    receivedAt: datetime
    payloadHash: str
    evidenceStatus: Literal["complete", "incomplete"]
    acceptanceBlocked: bool
    coverage: ReportCoverageResource
    metrics: list[ReportMetricFactResource]


class ReportRevisionResource(ReportRevisionSummaryResource):
    localRevisionId: str
    idempotencyKey: str
    sourceWindowStart: datetime
    sourceWindowEnd: datetime
    submittedByAccountId: UUID
    notes: str | None
    demographics: list[ReportDemographicFactResource]
    sourceBatches: list[ReportSourceBatchResource]


class ReportReviewActorResource(ContractModel):
    accountId: UUID | None
    displayName: str | None
    role: str | None


class ReportReviewEventResource(ContractModel):
    reviewEventId: UUID
    reportRevisionId: UUID
    eventType: Literal[
        "revision_submitted",
        "returned",
        "accepted",
        "reopened",
        "consolidated",
        "legacy_state_imported",
    ]
    fromState: ReportWorkflowState | None
    toState: ReportWorkflowState
    actor: ReportReviewActorResource
    reason: str | None
    commandId: UUID
    expectedVersion: int = Field(ge=0)
    resultingVersion: int = Field(ge=1)
    occurredAt: datetime


class EnterpriseReportListItem(ContractModel):
    enterpriseReportId: UUID
    classification: OfficialClassification
    workflowState: ReportWorkflowState
    logicalVersion: int = Field(ge=1)
    currentRevisionId: UUID
    acceptedRevisionId: UUID | None
    includedInOfficialTotals: bool
    acceptanceBlocked: bool
    reportingPeriod: ReportingPeriodResource
    obligation: ReportObligationResource
    enterprise: ReportEnterpriseResource
    site: ReportSiteResource
    currentRevision: ReportRevisionSummaryResource
    createdAt: datetime
    updatedAt: datetime


class EnterpriseReportPage(ContractModel):
    contractVersion: Literal[2] = 2
    classification: OfficialClassification = "official"
    items: list[EnterpriseReportListItem]
    page: CursorPageInfo


class EnterpriseReportDetail(EnterpriseReportListItem):
    contractVersion: Literal[2] = 2
    revisions: list[ReportRevisionResource]
    reviewEvents: list[ReportReviewEventResource]
