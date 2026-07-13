from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.features.reporting.envelopes import ContractModel

ReportTransitionAction = Literal[
    "return_for_correction",
    "accept_revision",
    "reopen_before_finalization",
]
ReportTransitionState = Literal["returned", "accepted"]


class ReportTransitionCommand(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    expectedVersion: int = Field(ge=1)
    action: ReportTransitionAction
    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def require_transition_reason(self) -> ReportTransitionCommand:
        if (
            self.action
            in {
                "return_for_correction",
                "reopen_before_finalization",
            }
            and self.reason is None
        ):
            raise ValueError(f"A reason is required for {self.action}.")
        return self


class ReportTransitionResource(ContractModel):
    enterpriseReportId: UUID
    reportRevisionId: UUID
    workflowState: ReportTransitionState
    logicalVersion: int = Field(ge=2)


class ReportTransitionAcknowledgement(ContractModel):
    contractVersion: Literal[2]
    commandId: UUID
    disposition: Literal["applied", "replayed"]
    acknowledgedAt: datetime
    resource: ReportTransitionResource
