from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.features.reporting.contracts import reporting_period_from_key


class SimulationPreparationSourceWindow(BaseModel):
    start: datetime
    end: datetime


class SimulationPreparationCounts(BaseModel):
    entries: int = Field(ge=0)
    exits: int = Field(ge=0)
    uniqueCount: int = Field(ge=0)
    peakOccupancy: int = Field(ge=0)
    period: str
    periodKey: str
    sourceWindow: SimulationPreparationSourceWindow

    @model_validator(mode="after")
    def validate_canonical_period(self) -> SimulationPreparationCounts:
        reporting_period = reporting_period_from_key(self.periodKey)
        if (
            self.sourceWindow.start.tzinfo is None
            or self.sourceWindow.start.utcoffset() is None
            or self.sourceWindow.end.tzinfo is None
            or self.sourceWindow.end.utcoffset() is None
        ):
            raise ValueError("Simulation source-window bounds must include a UTC offset.")
        if (
            self.sourceWindow.start.astimezone(UTC) != reporting_period.starts_at
            or self.sourceWindow.end.astimezone(UTC) != reporting_period.ends_at
        ):
            raise ValueError("Simulation source window must match the canonical reporting period.")
        return self


class SimulationPreparationSummary(BaseModel):
    runId: str
    status: Literal["active", "removed"]
    enterpriseId: str
    enterpriseName: str
    counts: SimulationPreparationCounts | None = None
    pendingCounts: list[SimulationPreparationCounts] = Field(default_factory=list)
