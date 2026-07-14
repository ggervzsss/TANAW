from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.features.reporting.contracts import reporting_period_from_key


class MockPreparationSourceWindow(BaseModel):
    start: datetime
    end: datetime


class MockPreparationCounts(BaseModel):
    entries: int = Field(ge=0)
    exits: int = Field(ge=0)
    uniqueCount: int = Field(ge=0)
    peakOccupancy: int = Field(ge=0)
    period: str
    periodKey: str
    sourceWindow: MockPreparationSourceWindow

    @model_validator(mode="after")
    def validate_canonical_period(self) -> MockPreparationCounts:
        reporting_period = reporting_period_from_key(self.periodKey)
        if (
            self.sourceWindow.start.tzinfo is None
            or self.sourceWindow.start.utcoffset() is None
            or self.sourceWindow.end.tzinfo is None
            or self.sourceWindow.end.utcoffset() is None
        ):
            raise ValueError("Mock preparation source-window bounds must include a UTC offset.")
        if (
            self.sourceWindow.start.astimezone(UTC) != reporting_period.starts_at
            or self.sourceWindow.end.astimezone(UTC) != reporting_period.ends_at
        ):
            raise ValueError(
                "Mock preparation source window must match the canonical reporting period."
            )
        return self


class MockPreparationSummary(BaseModel):
    runId: str
    status: Literal["active", "removed"]
    enterpriseId: str
    enterpriseName: str
    counts: MockPreparationCounts | None = None
    pendingCounts: list[MockPreparationCounts] = Field(default_factory=list)
