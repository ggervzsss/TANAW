"""Authoritative Staff read contracts for immutable scoped final reports."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.features.reporting.envelopes import ContractModel
from app.features.reporting.read_envelopes import CursorPageInfo, ReportingPeriodResource

FinalScopeType = Literal["citywide", "barangay", "enterprise_selection"]


class FinalReportScopeResource(ContractModel):
    type: FinalScopeType
    barangay: str | None
    label: str
    memberCount: int = Field(gt=0)


class FinalReportPreparedByResource(ContractModel):
    accountId: UUID | None
    name: str
    role: str


class FinalReportArtifactResource(ContractModel):
    artifactId: UUID
    status: Literal["pending", "ready", "failed"]
    templateVersion: str
    mimeType: str
    contentHash: str | None
    generationAttempts: int = Field(ge=0)
    lastErrorCode: str | None
    generatedAt: datetime | None
    generatedByAccountId: UUID | None
    downloadAvailable: bool
    createdAt: datetime
    updatedAt: datetime


class FinalReportVersionSummaryResource(ContractModel):
    finalReportVersionId: UUID
    versionNumber: int = Field(ge=1)
    disposition: Literal["current", "superseded"]
    scope: FinalReportScopeResource
    sourceCount: int = Field(gt=0)
    contentHash: str
    preparedBy: FinalReportPreparedByResource
    finalizedAt: datetime
    artifacts: list[FinalReportArtifactResource]
    createdAt: datetime


class FinalReportScopeMemberResource(ContractModel):
    scopeMemberId: UUID
    reportingObligationId: UUID
    enterpriseId: UUID
    enterpriseOfficialCode: str
    enterpriseName: str
    enterpriseCategory: str | None
    siteId: UUID
    siteCode: str
    siteName: str
    frozenBarangay: str | None


class FinalReportItemResource(ContractModel):
    finalReportItemId: UUID
    reportingObligationId: UUID
    reportRevisionId: UUID
    sourcePayloadHash: str


class FinalReportMetricFactResource(ContractModel):
    metricFactId: UUID
    definition: str
    definitionVersion: int = Field(ge=1)
    value: Decimal | None
    unit: str
    aggregationMethod: Literal["sum", "maximum", "summed_site_estimate"]
    quality: Literal["confirmed", "degraded", "estimated", "unknown"]
    sourceFactCount: int = Field(gt=0)


class FinalReportDemographicFactResource(ContractModel):
    demographicFactId: UUID
    dimension: str
    value: str
    count: int = Field(ge=0)
    percentage: Decimal | None = Field(default=None, ge=0, le=100)
    quality: Literal["confirmed", "degraded", "estimated"]
    sourceFactCount: int = Field(gt=0)


class FinalReportEventResource(ContractModel):
    finalReportEventId: UUID
    finalReportVersionId: UUID
    eventType: Literal["version_finalized", "migration_final_imported"]
    actorAccountId: UUID | None
    actorDisplayName: str | None
    actorRole: str | None
    commandId: UUID | None
    expectedVersion: int = Field(ge=0)
    resultingVersion: int = Field(ge=1)
    reason: str | None
    occurredAt: datetime


class FinalReportVersionResource(FinalReportVersionSummaryResource):
    scopeMembers: list[FinalReportScopeMemberResource]
    items: list[FinalReportItemResource]
    metrics: list[FinalReportMetricFactResource]
    demographics: list[FinalReportDemographicFactResource]


class FinalReportListItem(ContractModel):
    reportFinalizationId: UUID
    reportCode: str
    reportingPeriod: ReportingPeriodResource
    classification: Literal["official"] = "official"
    logicalVersion: int = Field(ge=1)
    currentVersionId: UUID
    currentVersion: FinalReportVersionSummaryResource
    createdByAccountId: UUID | None
    createdAt: datetime
    updatedAt: datetime


class FinalReportPage(ContractModel):
    contractVersion: Literal[2] = 2
    classification: Literal["official"] = "official"
    items: list[FinalReportListItem]
    page: CursorPageInfo


class FinalReportDetail(FinalReportListItem):
    contractVersion: Literal[2] = 2
    selectedVersionId: UUID
    selectedVersionIsCurrent: bool
    versions: list[FinalReportVersionSummaryResource]
    selectedVersion: FinalReportVersionResource
    events: list[FinalReportEventResource]
