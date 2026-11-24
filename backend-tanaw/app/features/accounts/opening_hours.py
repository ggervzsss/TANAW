"""A place's opening hours and temporary closures, and whether it is open at a given time.

Opening hours are kept per day of the week. A day is closed, open 24 hours, or open for one
or more periods, so a midday break is two periods. Times are Philippine time.
"""

import json
from collections.abc import Iterable, Sequence
from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.date_time import PHILIPPINE_TIME_ZONE, ensure_aware

Weekday = Literal["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKDAYS: tuple[Weekday, ...] = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)
DayMode = Literal["closed", "open24h", "hours"]
MAX_PERIODS_PER_DAY = 4


def _parse_clock(value: str) -> time:
    hours, minutes = value.split(":")
    if hours == "24" and minutes == "00":
        return time.max
    return time(int(hours), int(minutes))


class OpeningPeriod(BaseModel):
    open: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    close: str = Field(pattern=r"^(([01]\d|2[0-3]):[0-5]\d|24:00)$")

    @model_validator(mode="after")
    def close_after_open(self) -> OpeningPeriod:
        if _parse_clock(self.close) <= _parse_clock(self.open):
            raise ValueError("Closing time must be later than opening time.")
        return self

    def contains(self, moment: time) -> bool:
        return _parse_clock(self.open) <= moment < _parse_clock(self.close)


class DayHours(BaseModel):
    day: Weekday
    mode: DayMode
    periods: list[OpeningPeriod] = Field(default_factory=list, max_length=MAX_PERIODS_PER_DAY)

    @model_validator(mode="after")
    def periods_match_mode(self) -> DayHours:
        if self.mode != "hours":
            self.periods = []
            return self
        if not self.periods:
            raise ValueError(f"Add opening times for {self.day.title()}, or mark it closed.")
        ordered = sorted(self.periods, key=lambda period: _parse_clock(period.open))
        for earlier, later in zip(ordered, ordered[1:], strict=False):
            if _parse_clock(later.open) < _parse_clock(earlier.close):
                raise ValueError(f"{self.day.title()}'s opening times overlap.")
        self.periods = ordered
        return self


class OpeningHours(BaseModel):
    days: list[DayHours] = Field(min_length=7, max_length=7)

    @field_validator("days")
    @classmethod
    def one_entry_per_day(cls, days: list[DayHours]) -> list[DayHours]:
        if sorted(day.day for day in days) != sorted(WEEKDAYS):
            raise ValueError("Opening hours need exactly one entry for each day of the week.")
        return sorted(days, key=lambda day: WEEKDAYS.index(day.day))

    def for_day(self, day: Weekday) -> DayHours:
        return next(entry for entry in self.days if entry.day == day)


class ClosureSummary(BaseModel):
    id: str
    startDate: date
    endDate: date
    reason: str | None = None
    createdBy: str


class ClosureCreate(BaseModel):
    startDate: date
    endDate: date
    reason: str | None = Field(default=None, max_length=160)

    @model_validator(mode="after")
    def end_on_or_after_start(self) -> ClosureCreate:
        if self.endDate < self.startDate:
            raise ValueError("The closure must end on or after the day it starts.")
        if self.reason is not None:
            self.reason = " ".join(self.reason.split()) or None
        return self


def default_opening_hours() -> OpeningHours:
    """8:00 AM to 5:00 PM every day, the form's starting point."""
    return OpeningHours(
        days=[
            DayHours(day=day, mode="hours", periods=[OpeningPeriod(open="08:00", close="17:00")])
            for day in WEEKDAYS
        ]
    )


def parse_opening_hours(value: str | None) -> OpeningHours | None:
    if not value:
        return None
    try:
        return OpeningHours.model_validate(json.loads(value))
    except ValueError, TypeError:
        return None


def dump_opening_hours(hours: OpeningHours | None) -> str | None:
    return hours.model_dump_json() if hours is not None else None


def local_time(moment: datetime) -> datetime:
    return ensure_aware(moment).astimezone(PHILIPPINE_TIME_ZONE)


def weekday_of(moment: datetime) -> Weekday:
    return WEEKDAYS[local_time(moment).weekday()]


def is_open_at(hours: OpeningHours | None, moment: datetime) -> bool:
    """Whether the place is open then. A place with no hours on record counts as open."""
    if hours is None:
        return True
    local = local_time(moment)
    day = hours.for_day(WEEKDAYS[local.weekday()])
    if day.mode == "closed":
        return False
    if day.mode == "open24h":
        return True
    return any(period.contains(local.time()) for period in day.periods)


def is_closed_on(closures: Iterable[tuple[date, date]], day: date) -> bool:
    return any(start <= day <= end for start, end in closures)


def is_open_now(
    hours: OpeningHours | None,
    closures: Sequence[tuple[date, date]],
    moment: datetime,
) -> bool:
    local = local_time(moment)
    return not is_closed_on(closures, local.date()) and is_open_at(hours, local)


def last_close_on(hours: OpeningHours | None, moment: datetime) -> time | None:
    """When the place closes for the day (None when it is closed all day or open 24 hours)."""
    if hours is None:
        return None
    day = hours.for_day(weekday_of(moment))
    if day.mode != "hours":
        return None
    return max(_parse_clock(period.close) for period in day.periods)


def first_open_on(hours: OpeningHours | None, moment: datetime) -> time | None:
    if hours is None:
        return None
    day = hours.for_day(weekday_of(moment))
    if day.mode == "open24h":
        return time.min
    if day.mode != "hours":
        return None
    return min(_parse_clock(period.open) for period in day.periods)
