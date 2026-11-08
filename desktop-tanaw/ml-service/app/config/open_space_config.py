from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.analytics.polygon import validate_polygon


class ZonePoint(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class OpenSpaceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    zone_id: str = Field(default="main", min_length=1, max_length=80)
    zone_name: str = Field(default="Monitored area", min_length=1, max_length=120)
    polygon: list[ZonePoint] = Field(min_length=3, max_length=12)
    entry_confirmation_seconds: float = Field(default=1.0, ge=0.2, le=5)
    exit_confirmation_seconds: float = Field(default=1.0, ge=0.2, le=5)
    minimum_visit_seconds: float = Field(default=2.0, ge=0, le=30)
    gap_grace_seconds: float = Field(default=2.0, ge=0.2, le=5)
    boundary_tolerance: float = Field(default=0.01, ge=0, le=0.03)

    @model_validator(mode="after")
    def validate_zone(self) -> Self:
        points = validate_polygon([(p.x, p.y) for p in self.polygon])
        self.polygon = [ZonePoint(x=x, y=y) for x, y in points]
        if not self.zone_name.strip() or not self.zone_id.strip():
            raise ValueError("Zone name and identifier are required.")
        self.zone_name = self.zone_name.strip()
        self.zone_id = self.zone_id.strip()
        return self
