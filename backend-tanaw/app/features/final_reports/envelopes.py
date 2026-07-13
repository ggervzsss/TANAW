from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.features.reporting.envelopes import SHA256_PATTERN, ContractModel

FinalScopeType = Literal["citywide", "barangay", "enterprise_selection"]


class FinalReportScopeCommand(ContractModel):
    type: FinalScopeType
    barangay: str | None = Field(default=None, max_length=120)

    @field_validator("barangay")
    @classmethod
    def normalize_barangay(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @model_validator(mode="after")
    def validate_scope(self) -> FinalReportScopeCommand:
        if self.type == "barangay" and self.barangay is None:
            raise ValueError("Barangay scope requires a barangay.")
        if self.type != "barangay" and self.barangay is not None:
            raise ValueError("Only barangay scope may include a barangay.")
        return self


class FinalizeReportsPayload(ContractModel):
    targetFinalizationId: UUID | None = None
    reportingPeriodId: UUID
    scope: FinalReportScopeCommand
    reportRevisionIds: list[UUID] = Field(min_length=1, max_length=5000)
    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_sources(self) -> FinalizeReportsPayload:
        if len(self.reportRevisionIds) != len(set(self.reportRevisionIds)):
            raise ValueError("Final report source revision IDs must be unique.")
        if self.reportRevisionIds != sorted(self.reportRevisionIds, key=str):
            raise ValueError("Final report source revision IDs must use canonical UUID order.")
        return self


class FinalizeReportsCommand(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    idempotencyKey: str = Field(
        min_length=8,
        max_length=240,
        pattern=r"^final-report:[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$",
    )
    occurredAt: datetime
    expectedVersion: int = Field(ge=0)
    payload: FinalizeReportsPayload

    @model_validator(mode="after")
    def validate_target_version(self) -> FinalizeReportsCommand:
        if self.occurredAt.tzinfo is None or self.occurredAt.utcoffset() is None:
            raise ValueError("occurredAt must include a UTC offset.")
        if self.expectedVersion == 0 and self.payload.targetFinalizationId is not None:
            raise ValueError("A new finalization cannot specify targetFinalizationId.")
        if self.expectedVersion > 0 and self.payload.targetFinalizationId is None:
            raise ValueError("A correction must specify targetFinalizationId.")
        if self.expectedVersion > 0 and self.payload.reason is None:
            raise ValueError("A final-report correction requires an audit reason.")
        return self


class FinalizationAcknowledgementResource(ContractModel):
    reportFinalizationId: UUID
    finalReportVersionId: UUID
    reportCode: str
    reportingPeriodId: UUID
    classification: Literal["official"]
    versionNumber: int = Field(ge=1)
    logicalVersion: int = Field(ge=1)
    scopeType: FinalScopeType
    scopeLabel: str
    sourceCount: int = Field(gt=0)
    artifactStatus: Literal["pending"]


class FinalizationAcknowledgement(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    disposition: Literal["created", "replayed"]
    payloadHash: str
    acknowledgedAt: datetime
    resource: FinalizationAcknowledgementResource

    @model_validator(mode="after")
    def validate_acknowledgement(self) -> FinalizationAcknowledgement:
        if self.acknowledgedAt.tzinfo is None or self.acknowledgedAt.utcoffset() is None:
            raise ValueError("acknowledgedAt must include a UTC offset.")
        if SHA256_PATTERN.fullmatch(self.payloadHash) is None:
            raise ValueError("payloadHash must be a lowercase SHA-256 value.")
        return self
