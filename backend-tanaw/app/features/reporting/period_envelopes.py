"""Staff contracts for canonical reporting-period discovery and lifecycle."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.core.pagination_schemas import CursorPageInfo
from app.features.reporting.envelopes import ContractModel
from app.features.reporting.obligation_envelopes import ObligationSummary

ReportingPeriodStatus = Literal["scheduled", "open", "closed"]


class ReportingPeriodDiscoveryResource(ContractModel):
    contractVersion: Literal[2]
    complianceClassification: Literal["official"]
    reportingPeriodId: UUID
    naturalKey: str
    label: str
    cadence: Literal["month"]
    timezone: Literal["Asia/Manila"]
    localStartDate: date
    localEndDate: date
    startsAt: datetime
    endsAt: datetime
    submissionOpensAt: datetime
    submissionClosesAt: datetime
    status: ReportingPeriodStatus
    obligationsFrozenAt: datetime | None
    compliance: ObligationSummary


class ReportingPeriodPage(ContractModel):
    items: list[ReportingPeriodDiscoveryResource]
    page: CursorPageInfo


class ReportingPeriodLifecycleResult(ContractModel):
    contractVersion: Literal[2]
    evaluatedAt: datetime
    ensuredPeriodCount: int = Field(ge=0)
    createdCount: int = Field(ge=0)
    transitionedCount: int = Field(ge=0)
    frozenCount: int = Field(ge=0)
    periods: list[ReportingPeriodDiscoveryResource]
