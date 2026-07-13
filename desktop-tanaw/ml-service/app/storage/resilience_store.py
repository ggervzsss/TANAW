from __future__ import annotations

import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from app.storage.reporting_periods import (
    REPORTING_TIMEZONE,
    ReportingPeriod,
    monthly_period_for_captured_at,
    parse_captured_at,
)


@dataclass(frozen=True)
class SQLiteRetryPolicy:
    maximum_attempts: int = 4
    initial_delay_seconds: float = 0.025
    maximum_delay_seconds: float = 0.25

    def delay_for_attempt(self, attempt: int) -> float:
        return float(
            min(
                self.maximum_delay_seconds,
                self.initial_delay_seconds * (2 ** max(0, attempt - 1)),
            )
        )


class SQLiteWriteExhausted(RuntimeError):
    def __init__(self, operation: str, attempts: int, error: BaseException) -> None:
        super().__init__(
            f"Local persistence operation '{operation}' failed after {attempts} attempts: {error}"
        )
        self.operation = operation
        self.attempts = attempts
        self.original_error = error


def run_sqlite_write(
    operation_name: str,
    operation: Callable[[], Any],
    *,
    policy: SQLiteRetryPolicy,
    sleep: Callable[[float], None] = time.sleep,
) -> Any:
    for attempt in range(1, policy.maximum_attempts + 1):
        try:
            return operation()
        except sqlite3.OperationalError as exc:
            if not _is_transient_sqlite_error(exc) or attempt == policy.maximum_attempts:
                raise SQLiteWriteExhausted(operation_name, attempt, exc) from exc
            sleep(policy.delay_for_attempt(attempt))
    raise AssertionError("SQLite retry loop exited without returning or raising.")


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
                grain,
                bucket_start_at,
                bucket_end_at,
                reporting_period_id,
                business_date,
                camera_key,
                source_kind,
                mock_run_key,
                entries,
                exits,
                unique_entries,
                confirmed_unique_entries,
                degraded_unique_entries,
                peak_occupancy,
                last_occupancy,
                first_event_at,
                last_event_at,
                event_count,
                updated_at
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
                    then excluded.last_occupancy
                    else metric_rollups.last_occupancy
                end,
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


def start_monitoring_session(
    connection: sqlite3.Connection,
    *,
    monitoring_session_id: str,
    camera_key: str,
    central_camera_id: str | None,
    camera_name: str | None,
    started_at: str,
) -> None:
    connection.execute(
        """
        insert into monitoring_sessions (
            monitoring_session_id,
            camera_key,
            central_camera_id,
            camera_name,
            started_at,
            state,
            created_at,
            updated_at
        )
        values (?, ?, ?, ?, ?, 'connecting', ?, ?)
        """,
        (
            monitoring_session_id,
            camera_key,
            central_camera_id,
            camera_name,
            started_at,
            started_at,
            started_at,
        ),
    )


def mark_monitoring_connected(
    connection: sqlite3.Connection, monitoring_session_id: str, connected_at: str
) -> None:
    _close_open_gap(connection, monitoring_session_id, connected_at)
    connection.execute(
        """
        update monitoring_sessions
        set state = 'running', last_frame_at = ?, updated_at = ?
        where monitoring_session_id = ? and ended_at is null
        """,
        (connected_at, connected_at, monitoring_session_id),
    )


def open_coverage_gap(
    connection: sqlite3.Connection,
    *,
    monitoring_session_id: str,
    camera_key: str,
    started_at: str,
    reason: str,
    recoverable: bool,
    detail: str | None,
) -> str:
    existing = connection.execute(
        """
        select coverage_gap_id
        from coverage_gaps
        where monitoring_session_id = ? and ended_at is null
        """,
        (monitoring_session_id,),
    ).fetchone()
    if existing is not None:
        return str(existing["coverage_gap_id"])
    captured_at = parse_captured_at(started_at)
    period = monthly_period_for_captured_at(captured_at)
    coverage_gap_id = str(uuid4())
    connection.execute(
        """
        insert into coverage_gaps (
            coverage_gap_id,
            monitoring_session_id,
            camera_key,
            reporting_period_id,
            started_at,
            reason,
            recoverable,
            detail,
            recorded_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            coverage_gap_id,
            monitoring_session_id,
            camera_key,
            period.period_id,
            captured_at.isoformat(),
            reason,
            1 if recoverable else 0,
            detail,
            captured_at.isoformat(),
        ),
    )
    connection.execute(
        """
        update monitoring_sessions
        set state = ?, reconnect_count = reconnect_count + ?, updated_at = ?
        where monitoring_session_id = ? and ended_at is null
        """,
        (
            "reconnecting" if recoverable else "error",
            1 if recoverable else 0,
            captured_at.isoformat(),
            monitoring_session_id,
        ),
    )
    return coverage_gap_id


def end_monitoring_session(
    connection: sqlite3.Connection,
    monitoring_session_id: str,
    *,
    ended_at: str,
    reason: str,
    error: bool,
) -> None:
    _close_open_gap(connection, monitoring_session_id, ended_at)
    connection.execute(
        """
        update monitoring_sessions
        set ended_at = ?, state = ?, close_reason = ?, updated_at = ?
        where monitoring_session_id = ? and ended_at is null
        """,
        (
            ended_at,
            "error" if error else "stopped",
            reason,
            ended_at,
            monitoring_session_id,
        ),
    )


def coverage_summary(
    connection: sqlite3.Connection,
    *,
    period: ReportingPeriod,
    as_of: str,
) -> dict[str, Any]:
    window_start = period.starts_at_utc
    window_end = min(period.ends_at_utc, parse_captured_at(as_of))
    if window_end <= window_start:
        return _empty_coverage()
    sessions = connection.execute(
        """
        select monitoring_session_id, camera_key, started_at, ended_at
        from monitoring_sessions
        where started_at < ? and coalesce(ended_at, ?) > ?
        order by started_at
        """,
        (window_end.isoformat(), window_end.isoformat(), window_start.isoformat()),
    ).fetchall()
    if not sessions:
        return _empty_coverage()

    expected_seconds = sum(
        _overlap_seconds(
            parse_captured_at(str(row["started_at"])),
            parse_captured_at(str(row["ended_at"])) if row["ended_at"] else window_end,
            window_start,
            window_end,
        )
        for row in sessions
    )
    session_ids = [str(row["monitoring_session_id"]) for row in sessions]
    placeholders = ", ".join("?" for _ in session_ids)
    gap_rows = connection.execute(
        f"""
        select coverage_gap_id, camera_key, started_at, ended_at, reason, recoverable, detail
        from coverage_gaps
        where monitoring_session_id in ({placeholders})
          and started_at < ?
          and coalesce(ended_at, ?) > ?
        order by started_at
        """,
        (*session_ids, window_end.isoformat(), window_end.isoformat(), window_start.isoformat()),
    ).fetchall()
    gaps: list[dict[str, Any]] = []
    gap_seconds = 0.0
    for row in gap_rows:
        gap_start = max(parse_captured_at(str(row["started_at"])), window_start)
        gap_end = min(
            parse_captured_at(str(row["ended_at"])) if row["ended_at"] else window_end,
            window_end,
        )
        duration = max(0.0, (gap_end - gap_start).total_seconds())
        gap_seconds += duration
        gaps.append(
            {
                "gapId": str(row["coverage_gap_id"]),
                "cameraId": str(row["camera_key"]),
                "startedAt": gap_start.isoformat().replace("+00:00", "Z"),
                "endedAt": gap_end.isoformat().replace("+00:00", "Z"),
                "durationSeconds": round(duration, 3),
                "reason": str(row["reason"]),
                "recoverable": bool(row["recoverable"]),
                "detail": row["detail"],
            }
        )
    monitored_seconds = max(0.0, expected_seconds - min(gap_seconds, expected_seconds))
    ratio = monitored_seconds / expected_seconds if expected_seconds > 0 else None
    return {
        "evidenceStatus": "recorded",
        "monitoredSeconds": round(monitored_seconds, 3),
        "expectedSeconds": round(expected_seconds, 3),
        "coverageRatio": round(ratio, 6) if ratio is not None else None,
        "gapCount": len(gaps),
        "gaps": gaps,
        "warnings": (
            []
            if not gaps
            else ["Monitoring coverage is incomplete; review the recorded camera gaps."]
        ),
    }


def _close_open_gap(
    connection: sqlite3.Connection, monitoring_session_id: str, ended_at: str
) -> None:
    ended = parse_captured_at(ended_at)
    rows = connection.execute(
        """
        select coverage_gap_id, started_at
        from coverage_gaps
        where monitoring_session_id = ? and ended_at is null
        """,
        (monitoring_session_id,),
    ).fetchall()
    for row in rows:
        started = parse_captured_at(str(row["started_at"]))
        normalized_end = max(started, ended)
        connection.execute(
            """
            update coverage_gaps
            set ended_at = ?, duration_seconds = ?
            where coverage_gap_id = ? and ended_at is null
            """,
            (
                normalized_end.isoformat(),
                (normalized_end - started).total_seconds(),
                row["coverage_gap_id"],
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


def _overlap_seconds(
    start: datetime, end: datetime, window_start: datetime, window_end: datetime
) -> float:
    return max(0.0, (min(end, window_end) - max(start, window_start)).total_seconds())


def _empty_coverage() -> dict[str, Any]:
    return {
        "evidenceStatus": "not_recorded",
        "monitoredSeconds": None,
        "expectedSeconds": None,
        "coverageRatio": None,
        "gapCount": None,
        "gaps": [],
        "warnings": ["No monitoring-session evidence was recorded for this reporting period."],
    }


def _is_transient_sqlite_error(error: sqlite3.OperationalError) -> bool:
    normalized = str(error).lower()
    return "locked" in normalized or "busy" in normalized


def _safe_nonnegative_int(value: Any) -> int:
    return max(0, value if isinstance(value, int) else 0)
