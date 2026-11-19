"""Daily detail for sample report submissions, shaped like a real desktop submission.

A desktop report carries the month's frozen counting snapshot (one record per day with
unique visitors and TANAW's male/female estimate), the visitor origins the establishment
confirmed for each day, and the monthly residence totals derived from those days. Sample
reports carry the same, so their VAR 1 forms show every day rather than a monthly total only.
"""

import random
from calendar import monthrange
from datetime import date, datetime, time, timedelta
from typing import Any

from app.core.date_time import PHILIPPINE_TIME_ZONE
from app.features.reporting.counting import COUNTING_BASIS, snapshot_digest

POLICY_VERSION = 3
SAMPLE_CAMERA_ID = 1
OPEN_HOUR = 7
CLOSE_HOUR = 20
DAY_MS = 86_400_000
OPEN_MS = (CLOSE_HOUR - OPEN_HOUR) * 3_600_000
# Each origin's share of a day's visitors; This City keeps the rest. Matches desktop sample data.
ORIGIN_SHARES = {
    "otherCity": (0.10, 0.20),
    "otherProvince": (0.08, 0.16),
    "foreign": (0.01, 0.05),
}
ORIGINS = tuple(ORIGIN_SHARES)

DayOrigins = dict[str, dict[str, int]]


def sample_report_details(
    *,
    seed: str,
    enterprise_id: str,
    camera_name: str,
    month: date,
    last_day: date,
    entries: int,
    exits: int,
    unique_count: int,
    peak: int,
) -> dict[str, Any]:
    """The counting snapshot, daily origins and residence totals for one month's report.

    Visitors are spread over the month's days up to ``last_day``. The snapshot totals equal
    the given monthly figures, so the report's metrics and its snapshot agree.
    """
    rng = random.Random(f"{seed}:daily")
    month_days = monthrange(month.year, month.month)[1]
    days = [
        month + timedelta(days=offset)
        for offset in range(month_days)
        if month + timedelta(days=offset) <= last_day
    ]
    if not days:
        raise ValueError("A sample report needs at least one elapsed day.")
    unique_count = max(0, min(unique_count, entries))
    exits = max(0, min(exits, entries))
    weights = [(1.35 if day.weekday() >= 5 else 1.0) * rng.uniform(0.75, 1.25) for day in days]
    uniques = split_total(unique_count, weights)
    repeats = split_total(entries - unique_count, [float(value) for value in uniques])
    day_entries = [unique + repeat for unique, repeat in zip(uniques, repeats, strict=True)]
    missed = _missed_exits(entries - exits, day_entries, rng)
    peaks = _day_peaks(peak, uniques, rng)

    records: list[dict[str, Any]] = []
    origins: dict[str, DayOrigins] = {}
    for index, day in enumerate(days):
        visitors = uniques[index]
        female = round(visitors * rng.uniform(0.45, 0.55))
        male = visitors - female
        business_date = day.isoformat()
        records.append(
            _day_record(
                business_date,
                camera_name,
                unique=visitors,
                male=male,
                female=female,
                entries=day_entries[index],
                exits=day_entries[index] - missed[index],
                repeats=repeats[index],
                peak=peaks[index],
            )
        )
        if visitors:
            origins[business_date] = day_origins(rng, visitors, male, female)

    snapshot = _snapshot(
        enterprise_id, camera_name, month, month_days, records, entries, exits, unique_count, peak
    )
    demo, var1 = residence_totals(records, origins)
    return {"counting": snapshot, "origins": origins, "demo": demo, "var1": var1}


def day_origins(rng: random.Random, visitors: int, male: int, female: int) -> DayOrigins:
    """Visitors from origins the cameras cannot tell, never more than the day's male or female."""
    result: DayOrigins = {}
    male_left, female_left = male, female
    for origin, (low, high) in ORIGIN_SHARES.items():
        total = round(visitors * rng.uniform(low, high))
        origin_female = min(female_left, round(total * rng.uniform(0.4, 0.6)))
        origin_male = min(male_left, total - origin_female)
        result[origin] = {"male": origin_male, "female": origin_female}
        male_left -= origin_male
        female_left -= origin_female
    return result


def residence_totals(
    days: list[dict[str, Any]], origins: dict[str, DayOrigins]
) -> tuple[dict[str, str], dict[str, str]]:
    """Monthly residence totals from the daily origins, as the desktop derives them.

    This City is each day's male/female estimate less the visitors from other origins.
    This Province includes This City and Other City.
    """
    city = {"male": 0, "female": 0}
    others = {origin: {"male": 0, "female": 0} for origin in ORIGINS}
    for day in days:
        day_origin = origins.get(day["business_date"])
        if not day_origin:
            continue
        for sex in ("male", "female"):
            city[sex] += day[f"{sex}_count"] - sum(day_origin[origin][sex] for origin in ORIGINS)
            for origin in ORIGINS:
                others[origin][sex] += day_origin[origin][sex]
    demo = {
        "thisCityMale": str(city["male"]),
        "thisCityFemale": str(city["female"]),
        "thisCityUnspecified": "0",
        "thisProvMale": str(city["male"] + others["otherCity"]["male"]),
        "thisProvFemale": str(city["female"] + others["otherCity"]["female"]),
        "thisProvUnspecified": "0",
        "otherProvMale": str(others["otherProvince"]["male"]),
        "otherProvFemale": str(others["otherProvince"]["female"]),
        "foreignMale": str(others["foreign"]["male"]),
        "foreignFemale": str(others["foreign"]["female"]),
    }
    var1 = {
        "thisCityMale": demo["thisCityMale"],
        "thisCityFemale": demo["thisCityFemale"],
        "thisCityUnspecified": "0",
    }
    return demo, var1


def split_total(total: int, weights: list[float]) -> list[int]:
    """Largest-remainder split that keeps the exact total."""
    scale = sum(weights)
    if total <= 0 or scale <= 0:
        return [0] * len(weights)
    raw = [total * weight / scale for weight in weights]
    result = [int(value) for value in raw]
    order = sorted(range(len(raw)), key=lambda index: raw[index] - result[index], reverse=True)
    for index in order[: total - sum(result)]:
        result[index] += 1
    return result


def _missed_exits(missed_total: int, day_entries: list[int], rng: random.Random) -> list[int]:
    """Entries without a matching exit, never more than a day's entries."""
    missed = [0] * len(day_entries)
    for _ in range(missed_total):
        open_days = [index for index, value in enumerate(day_entries) if missed[index] < value]
        if not open_days:
            break
        missed[rng.choice(open_days)] += 1
    return missed


def _day_peaks(peak: int, uniques: list[int], rng: random.Random) -> list[int | None]:
    """Daily peak occupancy; the busiest day reaches the month's peak."""
    busiest = max(range(len(uniques)), key=lambda index: uniques[index])
    largest = max(uniques[busiest], 1)
    peaks: list[int | None] = []
    for index, visitors in enumerate(uniques):
        if not visitors:
            peaks.append(None)
        elif index == busiest:
            peaks.append(peak)
        else:
            scaled = round(peak * visitors / largest * rng.uniform(0.7, 0.95))
            peaks.append(max(1, min(peak, visitors, scaled)))
    return peaks


def _source(
    camera_name: str, unique: int, entries: int, exits: int, observations: int
) -> dict[str, Any]:
    return {
        "additive": False,
        "analysis_modes": ["entrance_exit"],
        "camera_id": SAMPLE_CAMERA_ID,
        "camera_name": camera_name,
        "entries": entries,
        "exits": exits,
        "observation_state": "observed",
        "qualified_observations": observations,
        "unique_count": unique,
    }


def _day_record(
    business_date: str,
    camera_name: str,
    *,
    unique: int,
    male: int,
    female: int,
    entries: int,
    exits: int,
    repeats: int,
    peak: int | None,
) -> dict[str, Any]:
    observations = entries + exits
    covered = OPEN_MS if unique else 0
    return {
        "business_date": business_date,
        "counting_basis": COUNTING_BASIS,
        "policy_version": POLICY_VERSION,
        "finalized": True,
        "unique_count": unique,
        "confirmed_unique_count": unique,
        "male_count": male,
        "female_count": female,
        "sex_estimation_state": "estimated",
        "sex_evidence_share": 1.0,
        "entries": entries,
        "exits": exits,
        "repeat_entry_count": repeats,
        "peak_occupancy": peak,
        "qualified_observations": observations,
        "unresolved_observations": 0,
        "covered_ms": covered,
        "coverage_ratio": covered / DAY_MS,
        "identification_state": "available",
        "identification_coverage": 1.0,
        "movement_state": "available",
        "reconciliation_state": "estimated",
        "sources": [SAMPLE_CAMERA_ID],
        "source_breakdown": [_source(camera_name, unique, entries, exits, observations)],
        "occupancy_corrections": [],
    }


def _snapshot(
    enterprise_id: str,
    camera_name: str,
    month: date,
    month_days: int,
    days: list[dict[str, Any]],
    entries: int,
    exits: int,
    unique_count: int,
    peak: int,
) -> dict[str, Any]:
    begin = datetime.combine(month, time(), PHILIPPINE_TIME_ZONE)
    end = datetime.combine(month + timedelta(days=month_days), time(), PHILIPPINE_TIME_ZONE)
    covered = sum(day["covered_ms"] for day in days)
    observations = entries + exits
    snapshot: dict[str, Any] = {
        "counting_basis": COUNTING_BASIS,
        "policy_version": POLICY_VERSION,
        "enterprise_id": enterprise_id,
        "timezone": "Asia/Manila",
        "from_at": begin.isoformat(),
        "to_at": end.isoformat(),
        "unique_count": unique_count,
        "confirmed_unique_count": unique_count,
        "male_count": sum(day["male_count"] for day in days),
        "female_count": sum(day["female_count"] for day in days),
        "sex_estimation_state": "estimated",
        "entries": entries,
        "exits": exits,
        "repeat_entry_count": entries - unique_count,
        "peak_occupancy": peak,
        "qualified_observations": observations,
        "unresolved_observations": 0,
        "covered_ms": covered,
        "coverage_ratio": covered / (month_days * DAY_MS),
        "days_available": sum(1 for day in days if day["unique_count"]),
        "days_requested": month_days,
        "reconciliation_state": "estimated",
        "movement_state": "available",
        "identification_state": "available",
        "days": days,
        "source_breakdown": [_source(camera_name, unique_count, entries, exits, observations)],
        "occupancy_corrections": [],
    }
    snapshot["snapshot_version"] = snapshot_digest(snapshot)
    return snapshot
