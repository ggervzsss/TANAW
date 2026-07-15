from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Any

from app.storage.reporting_periods import REPORTING_TIMEZONE, ReportingPeriod


def record_metric_rollups(
    connection: sqlite3.Connection,
    *,
    event: dict[str, Any],
    captured_at: datetime,
    reporting_period: ReportingPeriod,
    business_date: str,
    camera_key: str,
) -> None:
    raw_counts = event.get("counts")
    counts: dict[str, Any] = raw_counts if isinstance(raw_counts, dict) else {}
    direction = event.get("direction")
    is_unique = bool(event.get("is_unique_entry", direction == "entry"))
    has_confirmed_identity = bool(event.get("visitor_id"))
    values = {
        "entries": 1 if direction == "entry" else 0,
        "exits": 1 if direction == "exit" else 0,
        "unique_entries": 1 if direction == "entry" and is_unique else 0,
        "confirmed_unique_entries": (
            1 if direction == "entry" and is_unique and has_confirmed_identity else 0
        ),
        "degraded_unique_entries": (
            1 if direction == "entry" and is_unique and not has_confirmed_identity else 0
        ),
        "occupancy": _safe_nonnegative_int(counts.get("occupancy")),
    }
    for grain, bucket_start, bucket_end in _rollup_buckets(captured_at):
        connection.execute(
            """
            insert into metric_rollups (
                grain, bucket_start_at, bucket_end_at, reporting_period_id,
                business_date, camera_key, source_kind, mock_run_key, entries,
                exits, unique_entries, confirmed_unique_entries,
                degraded_unique_entries, peak_occupancy, last_occupancy,
                first_event_at, last_event_at, event_count, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            on conflict(grain, bucket_start_at, camera_key, source_kind, mock_run_key)
            do update set
                entries = metric_rollups.entries + excluded.entries,
                exits = metric_rollups.exits + excluded.exits,
                unique_entries = metric_rollups.unique_entries + excluded.unique_entries,
                confirmed_unique_entries = metric_rollups.confirmed_unique_entries
                    + excluded.confirmed_unique_entries,
                degraded_unique_entries = metric_rollups.degraded_unique_entries
                    + excluded.degraded_unique_entries,
                peak_occupancy = max(metric_rollups.peak_occupancy, excluded.peak_occupancy),
                last_occupancy = case
                    when excluded.last_event_at >= metric_rollups.last_event_at
                    then excluded.last_occupancy else metric_rollups.last_occupancy end,
                first_event_at = min(metric_rollups.first_event_at, excluded.first_event_at),
                last_event_at = max(metric_rollups.last_event_at, excluded.last_event_at),
                event_count = metric_rollups.event_count + 1,
                updated_at = excluded.updated_at
            """,
            (
                grain,
                bucket_start.isoformat(),
                bucket_end.isoformat(),
                reporting_period.period_id,
                business_date,
                camera_key,
                str(event.get("source_kind") or "real"),
                str(event.get("mock_run_id") or ""),
                values["entries"],
                values["exits"],
                values["unique_entries"],
                values["confirmed_unique_entries"],
                values["degraded_unique_entries"],
                values["occupancy"],
                values["occupancy"],
                captured_at.isoformat(),
                captured_at.isoformat(),
                captured_at.isoformat(),
            ),
        )


def _rollup_buckets(captured_at: datetime) -> tuple[tuple[str, datetime, datetime], ...]:
    utc_value = captured_at.astimezone(UTC)
    hour_start = utc_value.replace(minute=0, second=0, microsecond=0)
    local_value = captured_at.astimezone(REPORTING_TIMEZONE)
    local_day_start = local_value.replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = local_day_start.astimezone(UTC)
    day_end = (local_day_start + timedelta(days=1)).astimezone(UTC)
    return (
        ("hour", hour_start, hour_start + timedelta(hours=1)),
        ("day", day_start, day_end),
    )


def _safe_nonnegative_int(value: Any) -> int:
    return max(0, value if isinstance(value, int) else 0)
