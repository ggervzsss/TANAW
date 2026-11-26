"""Today's hour-by-hour strip for each camera at one place, in Philippine time.

Every telemetry check-in tells TANAW which cameras were counting. A check-in holds until the
next one, for at most ten minutes; after that TANAW has heard nothing, so the cameras count as
not counting. Only the hours the place is open are judged: an hour outside them is closed, and
an hour that has not started is still to come.

An hour is down when a camera was not counting for most of it, and has gaps when the camera
dropped out at least once (or missed at least a minute) but counted otherwise.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app.core.date_time import PHILIPPINE_TIME_ZONE, ensure_aware
from app.features.accounts.opening_hours import WEEKDAYS, OpeningHours
from app.features.monitoring.schemas import CameraHourState

HOLD_SECONDS = 600
"""How long one check-in vouches for the cameras, the same ten minutes after which it is offline."""
GAP_TOLERANCE_SECONDS = 60
FALLBACK_HOURS = tuple(range(6, 18))
DAY_SECONDS = 24 * 3600

Interval = tuple[float, float]
"""Seconds since local midnight, start inclusive and end exclusive."""


@dataclass(frozen=True)
class CameraSample:
    """One check-in: when it was captured and, per camera ID, whether that camera was counting."""

    at: datetime
    counting: Mapping[str, bool]


@dataclass(frozen=True)
class DayWindow:
    """The hours the strip shows, and the parts of the day the place is open."""

    open_from: str | None
    open_to: str | None
    hours: tuple[int, ...]
    open_intervals: tuple[Interval, ...]


@dataclass(frozen=True)
class CameraDay:
    slots: tuple[tuple[int, CameraHourState], ...]
    drop_count: int
    note: str
    not_counting_since: datetime | None
    """When the camera stopped counting, while the place is open and it is still not counting."""


def local_day_start(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=PHILIPPINE_TIME_ZONE)


def _clock_seconds(value: str) -> int:
    hours, minutes = value.split(":")
    return int(hours) * 3600 + int(minutes) * 60


def day_window(hours: OpeningHours | None, day: date, *, closed_all_day: bool) -> DayWindow:
    """The strip's hours: the opening window rounded out to whole hours, or 6 AM to 6 PM."""
    if closed_all_day:
        return DayWindow(None, None, FALLBACK_HOURS, ())
    if hours is None:
        # A place without hours on record counts as open, as everywhere else in TANAW.
        return DayWindow(None, None, FALLBACK_HOURS, ((0, DAY_SECONDS),))
    entry = hours.for_day(WEEKDAYS[day.weekday()])
    if entry.mode == "closed":
        return DayWindow(None, None, FALLBACK_HOURS, ())
    if entry.mode == "open24h":
        return DayWindow("00:00", "24:00", tuple(range(24)), ((0, DAY_SECONDS),))
    intervals = tuple(
        (float(_clock_seconds(period.open)), float(_clock_seconds(period.close)))
        for period in entry.periods
    )
    first_hour = int(intervals[0][0] // 3600)
    last_hour = min(24, -(-int(max(end for _, end in intervals)) // 3600))
    return DayWindow(
        entry.periods[0].open,
        max(period.close for period in entry.periods),
        tuple(range(first_hour, max(last_hour, first_hour + 1)))[:24],
        intervals,
    )


def _merge(intervals: Sequence[Interval]) -> list[Interval]:
    merged: list[Interval] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _intersect(first: Sequence[Interval], second: Sequence[Interval]) -> list[Interval]:
    result: list[Interval] = []
    for a_start, a_end in first:
        for b_start, b_end in second:
            start, end = max(a_start, b_start), min(a_end, b_end)
            if end > start:
                result.append((start, end))
    return _merge(result)


def _length(intervals: Sequence[Interval]) -> float:
    return sum(end - start for start, end in intervals)


def counting_intervals(
    samples: Sequence[CameraSample], camera_id: str, day_start: datetime, now_seconds: float
) -> list[Interval]:
    """The stretches of the day the camera was counting, from check-ins sorted by time."""
    stretches: list[Interval] = []
    for index, sample in enumerate(samples):
        start = (ensure_aware(sample.at) - day_start).total_seconds()
        following = (
            (ensure_aware(samples[index + 1].at) - day_start).total_seconds()
            if index + 1 < len(samples)
            else now_seconds
        )
        end = min(following, start + HOLD_SECONDS, now_seconds)
        if sample.counting.get(camera_id, False) and end > start:
            stretches.append((start, end))
    return _merge(stretches)


def _inside(moment: float, intervals: Sequence[Interval]) -> bool:
    return any(start <= moment < end for start, end in intervals)


def build_camera_day(
    camera_id: str,
    samples: Sequence[CameraSample],
    window: DayWindow,
    day_start: datetime,
    now: datetime,
) -> CameraDay:
    now_seconds = (ensure_aware(now) - day_start).total_seconds()
    counting = counting_intervals(samples, camera_id, day_start, now_seconds)
    expected = _intersect(window.open_intervals, [(float("-inf"), now_seconds)])
    # Each stretch of counting that ends while the place is open, before now, is a drop-out.
    drops = [end for _, end in counting if end < now_seconds and _inside(end, expected)]

    slots: list[tuple[int, CameraHourState]] = []
    for hour in window.hours:
        slot = [(float(hour * 3600), float((hour + 1) * 3600))]
        open_part = _intersect(slot, window.open_intervals)
        if not open_part:
            slots.append((hour, "closed"))
            continue
        judged = _intersect(open_part, expected)
        total = _length(judged)
        if total <= 0:
            slots.append((hour, "future"))
            continue
        missing = total - _length(_intersect(counting, judged))
        dropped = any(_inside(moment, slot) for moment in drops)
        state: CameraHourState
        if missing > total / 2:
            state = "down"
        elif dropped or missing >= GAP_TOLERANCE_SECONDS:
            state = "gaps"
        else:
            state = "counting"
        slots.append((hour, state))

    since = _not_counting_since(counting, expected, now_seconds)
    return CameraDay(
        slots=tuple(slots),
        drop_count=len(drops),
        note=_note(window, counting, expected, drops, since, day_start),
        not_counting_since=day_start + timedelta(seconds=since) if since is not None else None,
    )


def _not_counting_since(
    counting: Sequence[Interval], expected: Sequence[Interval], now_seconds: float
) -> float | None:
    open_now = any(start < now_seconds <= end for start, end in expected)
    counting_now = any(start < now_seconds <= end for start, end in counting)
    if not open_now or counting_now:
        return None
    opened = expected[0][0]
    ended = [end for _, end in counting if end < now_seconds]
    return max([opened, *ended])


def _note(
    window: DayWindow,
    counting: Sequence[Interval],
    expected: Sequence[Interval],
    drops: Sequence[float],
    since: float | None,
    day_start: datetime,
) -> str:
    if not window.open_intervals:
        return "Closed today."
    if not expected:
        return "Not open yet today."

    def clock(seconds: float) -> str:
        return _format_time(day_start + timedelta(seconds=seconds))

    if since is not None:
        if not _intersect(counting, expected):
            return "No counts today."
        earlier = [moment for moment in drops if moment < since]
        if earlier:
            return (
                f"Dropped out {_times(len(earlier))} since {_format_hour(earlier[0])}, "
                f"then stopped at {clock(since)}."
            )
        return f"Not counting since {clock(since)}."
    if len(drops) > 1:
        return f"Dropped out {_times(len(drops))} since {_format_hour(drops[0])}."
    if len(drops) == 1:
        closing = next(end for start, end in expected if start <= drops[0] < end)
        back = min(closing, next((start for start, _ in counting if start > drops[0]), closing))
        return f"Dropped out for {_duration(back - drops[0])} at {clock(drops[0])}."
    missing = _length(expected) - _length(_intersect(counting, expected))
    if missing >= GAP_TOLERANCE_SECONDS:
        return f"Not counting for {_duration(missing)} today."
    return "No problems today."


def _times(count: int) -> str:
    return "once" if count == 1 else f"{count} times"


def _duration(seconds: float) -> str:
    minutes = max(1, round(seconds / 60))
    if minutes < 60:
        return "1 minute" if minutes == 1 else f"{minutes} minutes"
    hours, rest = divmod(minutes, 60)
    text = "1 hour" if hours == 1 else f"{hours} hours"
    if rest:
        text += f" {rest} minute" + ("" if rest == 1 else "s")
    return text


def _format_time(moment: datetime) -> str:
    return moment.astimezone(PHILIPPINE_TIME_ZONE).strftime("%I:%M %p").lstrip("0")


def _format_hour(seconds: float) -> str:
    hour = int(seconds // 3600) % 24
    return f"{hour % 12 or 12} {'AM' if hour < 12 else 'PM'}"
