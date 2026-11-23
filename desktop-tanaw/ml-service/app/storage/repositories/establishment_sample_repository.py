"""Development sample history written through the establishment counting ledger.

Backend sample data provides monthly totals. This module turns one month into
deterministic doorway visits, records them as establishment observations and
occupancy intervals, and lets the regular daily rebuild produce the summaries
that Dashboard and Reports read.

Completed days are finalized immediately. Today holds only the visits up to the
current time and is rewritten on each call, so it keeps pace with the clock. A
day where a real camera records keeps only the camera's data, so sample visits
never inflate real counts.

Sample days also get confirmed visitor origins in the month's report draft, so
past forms are ready to review. Today and the three days before it are left for
the user to fill in, which keeps the daily entry workflow testable.
"""

import json
import random
from calendar import monthrange
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid5

from app.storage.repositories.establishment_report_repository import period_bounds
from app.storage.repositories.establishment_repository import (
    TIMEZONE,
    EstablishmentRepository,
    day_bounds,
    timestamp,
)
from app.storage.repositories.report_draft_repository import ReportDraftRepository

# Real camera IDs are small sequential numbers; this source never collides with one.
SAMPLE_CAMERA_ID = 900_001
SAMPLE_SOURCE_NAME = "Sample data"
SAMPLE_MODEL_NAME = "sample_data"
SAMPLE_SEX_MODEL = "sample_data"
# Sample visitors carry clear male/female evidence; the day's female share varies 45-55%.
SAMPLE_SEX_LOGIT = 6.0
SAMPLE_NAMESPACE = UUID("4d0f4b8e-6a51-4c1e-9b8e-3f2f63a0c5d1")
OPEN_HOUR = 7
CLOSE_HOUR = 20
# Today and this many days before it keep no sample origins, so users can enter them.
UNFILLED_RECENT_DAYS = 3
# The renderer stores a reporting month's daily origins under this draft key.
DRAFT_KEY_PREFIX = "period:"
# Each origin's share of a day's visitors; This City keeps the rest.
ORIGIN_SHARES = {
    "otherCity": (0.10, 0.20),
    "otherProvince": (0.08, 0.16),
    "foreign": (0.01, 0.05),
}


def prepare_sample_period(
    repository: EstablishmentRepository,
    *,
    report_id: str,
    period: str,
    entries: int,
    exits: int,
    unique_count: int,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Record a month's sample visits on every elapsed day without camera data."""
    now = now or datetime.now(UTC)
    begin, _ = period_bounds(period)
    period = begin.strftime("%B %Y")
    today = now.astimezone(TIMEZONE).date()
    plan = allocate_month(report_id, begin.date(), entries, exits, unique_count)
    # Camera days must be current before deciding which days the sample may fill.
    repository.rebuild_changed_days()
    with repository.database.connection() as db:
        # A submitted report freezes its counts; adding history afterwards would contradict it.
        if db.execute("select 1 from report_submissions where period=?", (period,)).fetchone():
            return {"period": period, "prepared": False, "days": 0}
        finalized = {
            row["business_date"]: json.loads(row["metrics_json"])
            for row in db.execute(
                "select business_date,metrics_json from establishment_daily_summaries "
                "where finalized=1 and business_date>=? and business_date<?",
                (plan[0][0].isoformat(), (plan[-1][0] + timedelta(days=1)).isoformat()),
            )
        }
    prepared: list[str] = []
    for day, counts in plan:
        business_date = day.isoformat()
        if day > today:
            continue
        until = now if day == today else None
        visits = simulate_day(report_id, day, *counts, until=until)
        closed = finalized.get(business_date)
        # A sample day closed while it still held only the visits up to an earlier time
        # (the desktop was quit mid-day) is completed; every other closed day is kept.
        if closed is not None and (
            closed.get("sources") != [SAMPLE_CAMERA_ID]
            or closed.get("qualified_observations") == _observation_count(visits)
        ):
            continue
        # One short write per day keeps running cameras from waiting on the whole month.
        with repository.database.transaction() as db:
            if closed is not None:
                db.execute(
                    "update establishment_daily_summaries set finalized=0 where business_date=?",
                    (business_date,),
                )
            had_sample = _clear_sample_day(db, business_date)
            if _has_camera_data(db, business_date):
                if had_sample:
                    repository.rebuild_day(business_date, now)
                continue
            if not visits:
                continue
            _record_day(repository, report_id, business_date, visits, until)
            metrics = repository.rebuild_day(business_date, now)
            for source in metrics["source_breakdown"]:
                if source["camera_id"] == SAMPLE_CAMERA_ID:
                    source["camera_name"] = SAMPLE_SOURCE_NAME
            db.execute(
                "update establishment_daily_summaries set metrics_json=?,finalized=? "
                "where business_date=?",
                (json.dumps(metrics, sort_keys=True), int(day < today), business_date),
            )
        prepared.append(business_date)
    _fill_sample_origins(repository, report_id, period, today)
    return {"period": period, "prepared": bool(prepared), "days": len(prepared)}


def _fill_sample_origins(
    repository: EstablishmentRepository, report_id: str, period: str, today: date
) -> None:
    """Confirm origins for the period's sample days older than the recent days left for the user.

    Days already in the draft keep the user's entries, and days with camera data are
    left for the user, so only sample-only days the draft lacks are added. Days outside
    the period are dropped from the draft.
    """
    begin, end = period_bounds(period)
    first_day = begin.date()
    last_filled = min(
        today - timedelta(days=UNFILLED_RECENT_DAYS + 1), end.date() - timedelta(days=1)
    )
    with repository.database.connection() as db:
        rows = db.execute(
            "select business_date,metrics_json from establishment_daily_summaries "
            "where business_date>=? and business_date<=?",
            (first_day.isoformat(), last_filled.isoformat()),
        ).fetchall()
    unique_by_day = {
        row["business_date"]: int(metrics.get("unique_count") or 0)
        for row in rows
        if (metrics := json.loads(row["metrics_json"])).get("sources") == [SAMPLE_CAMERA_ID]
    }
    drafts = ReportDraftRepository(repository.database)
    draft_key = f"{DRAFT_KEY_PREFIX}{period}"
    existing = drafts.get(draft_key)
    payload = dict(existing["payload"]) if existing else {}
    stored = dict(payload.get("origins") or {})
    origins = {
        business_date: value
        for business_date, value in stored.items()
        if first_day.isoformat() <= business_date < end.date().isoformat()
    }
    added = {
        business_date: sample_day_origins(report_id, business_date, unique)
        for business_date, unique in sorted(unique_by_day.items())
        if unique > 0 and business_date not in origins
    }
    if not added and len(origins) == len(stored):
        return
    drafts.save(
        draft_key,
        period,
        {**payload, "origins": {**origins, **added}, "version": 2},
        existing["report_id"] if existing else None,
    )


def sample_day_origins(
    report_id: str, business_date: str, unique_visitors: int
) -> dict[str, dict[str, int]]:
    """A deterministic split of a day's visitors among the origins TANAW cannot detect."""
    rng = random.Random(f"{report_id}:{business_date}:origins")
    origins: dict[str, dict[str, int]] = {}
    for origin, (low, high) in ORIGIN_SHARES.items():
        visitors = int(round(unique_visitors * rng.uniform(low, high)))
        female = int(round(visitors * rng.uniform(0.4, 0.6)))
        origins[origin] = {"male": visitors - female, "female": female}
    return origins


def _observation_count(visits: list[dict[str, Any]]) -> int:
    return sum(1 + (visit["departure"] is not None) for visit in visits)


def _clear_sample_day(db: Any, business_date: str) -> bool:
    begin, end = day_bounds(business_date)
    observations = db.execute(
        "delete from establishment_observations where business_date=? and camera_id=?",
        (business_date, SAMPLE_CAMERA_ID),
    ).rowcount
    intervals = db.execute(
        "delete from establishment_occupancy_intervals where start_at>=? and start_at<? "
        "and json_extract(sources_json,'$.sample_data')=1",
        (begin, end),
    ).rowcount
    return bool(observations or intervals)


def _has_camera_data(db: Any, business_date: str) -> bool:
    begin, end = day_bounds(business_date)
    return bool(
        db.execute(
            "select 1 from establishment_observations where business_date=? limit 1",
            (business_date,),
        ).fetchone()
        or db.execute(
            "select 1 from establishment_occupancy_intervals where start_at<? and end_at>? limit 1",
            (end, begin),
        ).fetchone()
    )


def allocate_month(
    report_id: str, first_day: date, entries: int, exits: int, unique_count: int
) -> list[tuple[date, tuple[int, int, int]]]:
    """Split monthly totals into (unique visitors, repeat entries, missed exits) per day."""
    rng = random.Random(f"{report_id}:allocation")
    days = [
        first_day + timedelta(days=offset)
        for offset in range(monthrange(first_day.year, first_day.month)[1])
    ]
    weights = [(1.35 if day.weekday() >= 5 else 1.0) * rng.uniform(0.75, 1.25) for day in days]
    entries = max(0, entries)
    unique_count = max(0, min(unique_count, entries))
    uniques = _split(unique_count, weights)
    repeats = [
        value if uniques[index] else 0
        for index, value in enumerate(_split(entries - unique_count, weights))
    ]
    missed = [0] * len(days)
    for _ in range(entries - max(0, min(exits, entries))):
        # A missed exit leaves one visitor inside at closing, so it needs a visitor that day.
        open_days = [index for index in range(len(days)) if missed[index] < uniques[index]]
        if not open_days:
            break
        missed[rng.choices(open_days, [weights[index] for index in open_days])[0]] += 1
    return [
        (day, (uniques[index], repeats[index], missed[index])) for index, day in enumerate(days)
    ]


def simulate_day(
    report_id: str,
    day: date,
    unique_visitors: int,
    repeat_entries: int,
    missed_exits: int,
    *,
    until: datetime | None = None,
) -> list[dict[str, Any]]:
    """Return visits with an arrival and, unless the exit was missed, a departure.

    With ``until``, the same day is cut at that time: later arrivals are dropped and
    visitors who leave afterwards are still inside.
    """
    rng = random.Random(f"{report_id}:{day.isoformat()}")
    opens = datetime(day.year, day.month, day.day, OPEN_HOUR, tzinfo=TIMEZONE)
    window = (CLOSE_HOUR - OPEN_HOUR) * 3600
    closes = opens + timedelta(seconds=window - 60)
    visits: list[dict[str, Any]] = []
    for index in range(unique_visitors):
        arrival = opens + timedelta(seconds=int(rng.triangular(60, window * 0.85, window * 0.5)))
        departure = min(arrival + timedelta(minutes=rng.uniform(20, 150)), closes)
        visits.append({"visitor": index, "arrival": arrival, "departure": departure})
    for _ in range(repeat_entries):
        candidates = [
            visit
            for visit in visits
            if visit["departure"] + timedelta(minutes=25) < closes
            and not any(
                other["visitor"] == visit["visitor"] and other["arrival"] > visit["arrival"]
                for other in visits
            )
        ]
        if not candidates:
            break
        previous = rng.choice(candidates)
        arrival = previous["departure"] + timedelta(minutes=rng.uniform(10, 20))
        departure = min(arrival + timedelta(minutes=rng.uniform(15, 90)), closes)
        visits.append({"visitor": previous["visitor"], "arrival": arrival, "departure": departure})
    final_visits = [
        visit
        for visit in visits
        if not any(
            other["visitor"] == visit["visitor"] and other["arrival"] > visit["arrival"]
            for other in visits
        )
    ]
    if missed_exits:
        # The latest visitors are the ones still inside when observation ends.
        for visit in sorted(final_visits, key=lambda item: item["arrival"])[-missed_exits:]:
            visit["departure"] = None
    if until is not None:
        visits = [
            {**visit, "departure": None}
            if visit["departure"] is not None and visit["departure"] > until
            else visit
            for visit in visits
            if visit["arrival"] <= until
        ]
    return sorted(visits, key=lambda item: item["arrival"])


def _record_day(
    repository: EstablishmentRepository,
    report_id: str,
    business_date: str,
    visits: list[dict[str, Any]],
    until: datetime | None = None,
) -> None:
    payload_json = json.dumps({"report_id": report_id, "sample_data": True}, sort_keys=True)
    events: list[tuple[datetime, int]] = []
    sex_rng = random.Random(f"{report_id}:{business_date}:sex")
    female_share = 0.45 + sex_rng.random() * 0.10
    female_visitors = {
        visitor
        for visitor in sorted({visit["visitor"] for visit in visits})
        if sex_rng.random() < female_share
    }
    for index, visit in enumerate(visits):
        visitor_id = str(uuid5(SAMPLE_NAMESPACE, f"{report_id}:{business_date}:{visit['visitor']}"))
        sex_logit = SAMPLE_SEX_LOGIT if visit["visitor"] in female_visitors else -SAMPLE_SEX_LOGIT
        moves = [("entry", visit["arrival"])]
        if visit["departure"] is not None:
            moves.append(("exit", visit["departure"]))
        for kind, at in moves:
            observation_id = f"sample:{report_id}:{business_date}:{index}:{kind}"
            repository.save_observation(
                {
                    "observation_id": observation_id,
                    "business_date": business_date,
                    "camera_id": SAMPLE_CAMERA_ID,
                    "analysis_mode": "entrance_exit",
                    "kind": kind,
                    "track_key": f"{SAMPLE_CAMERA_ID}:{observation_id}",
                    "revision_id": None,
                    "model_name": SAMPLE_MODEL_NAME,
                    "visitor_id": visitor_id,
                    "identity_confidence": "high",
                    "reid_decision": "sample_data",
                    "reid_score": None,
                    "qualified": 1,
                    "first_at": timestamp(at),
                    "last_at": timestamp(at),
                    "ended_at": None,
                    "arrival_observed": 0,
                    "departure_observed": 0,
                    "payload_json": payload_json,
                    "sex_logit_sum": sex_logit,
                    "sex_weight": 1.0,
                    "sex_model": SAMPLE_SEX_MODEL,
                }
            )
            events.append((at, 1 if kind == "entry" else -1))
    _record_occupancy(repository, business_date, events, until)


def _record_occupancy(
    repository: EstablishmentRepository,
    business_date: str,
    events: list[tuple[datetime, int]],
    until: datetime | None = None,
) -> None:
    """Store the opening-hours headcount as observed intervals for peak and coverage."""
    day = date.fromisoformat(business_date)
    opens = datetime(day.year, day.month, day.day, OPEN_HOUR, tzinfo=TIMEZONE)
    closes = datetime(day.year, day.month, day.day, CLOSE_HOUR, tzinfo=TIMEZONE)
    if until is not None:
        closes = min(closes, until)
    changes: dict[datetime, int] = {opens: 0}
    for at, delta in events:
        changes[at] = changes.get(at, 0) + delta
    times = sorted(changes)
    occupancy = 0
    rows = []
    for index, start in enumerate(times):
        occupancy = max(0, occupancy + changes[start])
        end = times[index + 1] if index + 1 < len(times) else closes
        if end <= start:
            continue
        sources = json.dumps(
            {
                "contributions": [],
                "enterprise_id": repository.database.enterprise_id,
                "identification_available": True,
                "measurement_sources": [],
                "movement_available": True,
                "occupancy": occupancy,
                "sample_data": True,
                "state": "estimated",
            },
            sort_keys=True,
        )
        rows.append((timestamp(start), timestamp(end), occupancy, sources, sources))
    with repository.database.connection() as db:
        db.executemany(
            "insert into establishment_occupancy_intervals "
            "(start_at,end_at,occupancy,completeness,sources_json,end_sources_json) "
            "values (?,?,?,'estimated',?,?)",
            rows,
        )


def _split(total: int, weights: list[float]) -> list[int]:
    """Largest-remainder split that keeps the exact total."""
    scale = sum(weights)
    raw = [total * weight / scale for weight in weights]
    result = [int(value) for value in raw]
    order = sorted(range(len(raw)), key=lambda index: raw[index] - result[index], reverse=True)
    for index in order[: total - sum(result)]:
        result[index] += 1
    return result
