from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.features.reporting.envelopes import ContractModel

EligibilityStatus = Literal["eligible", "exempt", "ineligible", "unknown"]
ResolvedEligibilityStatus = Literal["eligible", "exempt", "ineligible"]
ComplianceStatus = Literal[
    "not_submitted",
    "submitted",
    "returned",
    "accepted",
    "consolidated",
]
ReminderPhase = Literal["pre_window", "current_period", "overdue"]


class ObligationResolutionCommand(ContractModel):
    siteId: UUID
    eligibilityStatus: ResolvedEligibilityStatus
    reason: str | None = Field(default=None, max_length=500)
    frozenBarangay: str | None = Field(default=None, max_length=120)

    @field_validator("reason", "frozenBarangay")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_resolution(self) -> ObligationResolutionCommand:
        if self.eligibilityStatus in {"exempt", "ineligible"} and self.reason is None:
            raise ValueError("Exempt and ineligible resolutions require a reason.")
        if self.eligibilityStatus == "eligible" and self.frozenBarangay is None:
            raise ValueError("Eligible manual resolutions require a frozen barangay.")
        if self.eligibilityStatus != "eligible" and self.frozenBarangay is not None:
            raise ValueError("Only eligible resolutions may replace the frozen barangay.")
        return self


class ObligationFreezeCommand(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    resolutions: list[ObligationResolutionCommand] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_sites(self) -> ObligationFreezeCommand:
        site_ids = [resolution.siteId for resolution in self.resolutions]
        if len(site_ids) != len(set(site_ids)):
            raise ValueError("A site may appear only once in obligation resolutions.")
        return self


class ObligationResource(ContractModel):
    obligationId: UUID
    enterpriseId: UUID
    enterpriseOfficialCode: str
    enterpriseName: str
    siteId: UUID
    siteCode: str
    siteName: str
    classification: Literal["official", "simulation"]
    eligibilityStatus: EligibilityStatus
    eligibilityBasis: Literal["registry_snapshot", "migration_evidence", "manual_resolution"]
    eligibilityReason: str | None
    frozenBarangay: str | None
    timezone: Literal["Asia/Manila"]
    registrationEffectiveAt: datetime | None
    acceptanceBlocked: bool
    complianceStatus: ComplianceStatus | None
    enterpriseReportId: UUID | None
    logicalVersion: int | None = Field(default=None, ge=1)


class ObligationSummary(ContractModel):
    totalFrozen: int = Field(ge=0)
    eligibleExpected: int = Field(ge=0)
    exempt: int = Field(ge=0)
    ineligible: int = Field(ge=0)
    unresolved: int = Field(ge=0)
    notSubmitted: int = Field(ge=0)
    submitted: int = Field(ge=0)
    returned: int = Field(ge=0)
    accepted: int = Field(ge=0)
    consolidated: int = Field(ge=0)
    complete: bool


class PeriodComplianceResource(ContractModel):
    reportingPeriodId: UUID
    periodKey: str
    periodLabel: str
    timezone: Literal["Asia/Manila"]
    startsAt: datetime
    endsAt: datetime
    submissionOpensAt: datetime
    submissionClosesAt: datetime
    status: Literal["scheduled", "open", "closed"]
    frozen: Literal[True]
    frozenAt: datetime
    summary: ObligationSummary
    obligations: list[ObligationResource]


class ObligationFreezeAcknowledgement(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    disposition: Literal["created", "reconciled", "replayed"]
    acknowledgedAt: datetime
    resource: PeriodComplianceResource


class ReminderIntentCommand(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID


class ReminderIntentAcknowledgement(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    disposition: Literal["created", "replayed"]
    acknowledgedAt: datetime
    reportingPeriodId: UUID
    periodKey: str
    phase: ReminderPhase
    createdCount: int = Field(ge=0)
    existingCount: int = Field(ge=0)
    skippedCount: int = Field(ge=0)
    eventIds: list[UUID]
