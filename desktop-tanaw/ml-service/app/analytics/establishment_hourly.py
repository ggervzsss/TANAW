"""Establishment activity by local hour of day, for the dashboard's insights assistant.

Only anonymous aggregate counts leave this module: entries, Open Space visits,
the highest recorded occupancy and how long occupancy was observed in each hour.
"""

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

TIMEZONE = ZoneInfo("Asia/Manila")
HOUR = timedelta(hours=1)


def empty_hours() -> list[dict[str, Any]]:
    return [
        {"hour": hour, "entries": 0, "area_visits": 0, "peak_occupancy": None, "covered_ms": 0}
        for hour in range(24)
    ]


def hourly_activity(
    rows: list[dict[str, Any]],
    intervals: list[dict[str, Any]],
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    """Aggregate qualified observations and occupancy intervals by local hour of day.

    ``rows`` are qualified establishment observations and ``intervals`` are
    establishment occupancy intervals. Only activity inside ``[start, end)`` counts.
    An entry follows the same rule as ``daily_movements``: an Entry / Exit
    observation whose kind is ``entry`` or whose arrival was observed.
    """
    hours = empty_hours()
    for row in rows:
        at = datetime.fromisoformat(row["first_at"])
        if not start <= at < end:
            continue
        bucket = hours[at.astimezone(TIMEZONE).hour]
        if row["analysis_mode"] == "entrance_exit":
            if row["kind"] == "entry" or row["arrival_observed"]:
                bucket["entries"] += 1
        elif row["kind"] == "area_visit":
            bucket["area_visits"] += 1
    for interval in intervals:
        occupancy = interval["occupancy"]
        if occupancy is None:
            continue
        begin = max(start, datetime.fromisoformat(interval["start_at"]))
        stop = min(end, datetime.fromisoformat(interval["end_at"]))
        if begin > stop or begin >= end:
            continue
        # Walk the local hours the interval overlaps. A zero-length checkpoint still
        # records the occupancy seen at that instant, in the hour containing it.
        cursor = begin.astimezone(TIMEZONE).replace(minute=0, second=0, microsecond=0)
        while cursor < stop or (cursor == begin == stop):
            bucket_end = cursor + HOUR
            overlap_start, overlap_end = max(begin, cursor), min(stop, bucket_end)
            if overlap_end > overlap_start or begin == stop:
                bucket = hours[cursor.hour]
                peak = bucket["peak_occupancy"]
                bucket["peak_occupancy"] = occupancy if peak is None else max(peak, occupancy)
                bucket["covered_ms"] += round((overlap_end - overlap_start).total_seconds() * 1000)
            if begin == stop:
                break
            cursor = bucket_end
    return hours
