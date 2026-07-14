from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.camera.auth import redact_stream_credentials
from app.storage.report_ledger_schema import local_camera_key

MAX_EVENT_ATTRIBUTES_BYTES = 65_536


def bind_local_site(
    connection: sqlite3.Connection,
    *,
    enterprise_id: str | None,
    display_name: str | None = None,
) -> None:
    now = datetime.now(UTC).isoformat()
    connection.execute(
        """
        insert into local_sites (
            local_site_id,
            enterprise_id,
            display_name,
            created_at,
            updated_at
        )
        values ('primary', ?, ?, ?, ?)
        on conflict(local_site_id) do update set
            enterprise_id = coalesce(excluded.enterprise_id, local_sites.enterprise_id),
            display_name = coalesce(excluded.display_name, local_sites.display_name),
            updated_at = excluded.updated_at
        """,
        (enterprise_id, display_name, now, now),
    )


def upsert_local_camera(
    connection: sqlite3.Connection,
    *,
    camera_key: str,
    central_camera_id: str | None,
    local_camera_id: Any,
    display_name: str | None,
    observed_at: str,
) -> None:
    connection.execute(
        """
        insert into local_cameras (
            camera_key,
            local_site_id,
            central_camera_id,
            local_camera_id,
            display_name,
            first_seen_at,
            last_seen_at
        )
        values (?, 'primary', ?, ?, ?, ?, ?)
        on conflict(camera_key) do update set
            central_camera_id = coalesce(
                excluded.central_camera_id,
                local_cameras.central_camera_id
            ),
            local_camera_id = coalesce(excluded.local_camera_id, local_cameras.local_camera_id),
            display_name = coalesce(excluded.display_name, local_cameras.display_name),
            first_seen_at = min(local_cameras.first_seen_at, excluded.first_seen_at),
            last_seen_at = max(local_cameras.last_seen_at, excluded.last_seen_at)
        """,
        (
            camera_key,
            central_camera_id,
            local_camera_id,
            display_name,
            observed_at,
            observed_at,
        ),
    )


def upsert_camera_live_state(
    connection: sqlite3.Connection,
    *,
    camera_key: str,
    observed_at: str,
    status: Any,
    running: bool,
    entry_count: int,
    exit_count: int,
    occupancy_count: int,
    error: Any,
) -> None:
    connection.execute(
        """
        insert into camera_live_state (
            camera_key,
            observed_at,
            state,
            running,
            entry_count,
            exit_count,
            occupancy_count,
            error_summary
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(camera_key) do update set
            observed_at = excluded.observed_at,
            state = excluded.state,
            running = excluded.running,
            entry_count = excluded.entry_count,
            exit_count = excluded.exit_count,
            occupancy_count = excluded.occupancy_count,
            error_summary = excluded.error_summary
        where excluded.observed_at >= camera_live_state.observed_at
        """,
        (
            camera_key,
            observed_at,
            _camera_state(status, running, error),
            1 if running else 0,
            max(0, entry_count),
            max(0, exit_count),
            max(0, occupancy_count),
            redact_stream_credentials(str(error))[:500] if error is not None else None,
        ),
    )


def migrate_target_ledger_v5(connection: sqlite3.Connection) -> None:
    """Replace the transitional edge schema with the target-only ledger."""

    _validate_legacy_transformation(connection)
    for statement in _TOPOLOGY_AND_LIVE_STATE_STATEMENTS:
        connection.execute(statement)
    _migrate_camera_catalog(connection)
    _migrate_latest_camera_state(connection)
    _rebuild_camera_sequences(connection)
    _rebuild_resilience_ownership(connection)
    _rebuild_count_event_ledger(connection)
    connection.execute("drop table count_snapshots")
    connection.execute("drop table report_submissions")
    _verify_target_catalog(connection)


def _validate_legacy_transformation(connection: sqlite3.Connection) -> None:
    missing_reports = int(
        connection.execute(
            """
            select count(*)
            from report_submissions as legacy
            where not exists (
                select 1 from local_reports as target
                where target.report_id = legacy.report_id
            )
            """
        ).fetchone()[0]
    )
    if missing_reports:
        raise RuntimeError(
            f"Local ledger cutover found {missing_reports} report(s) without a target record."
        )

    invalid_events = int(
        connection.execute(
            """
            select count(*)
            from count_events
            where business_date is null
               or reporting_period_id is null
               or camera_key is null
               or camera_event_sequence is null
               or json_valid(payload_json) = 0
               or length(cast(payload_json as blob)) > 65536
            """
        ).fetchone()[0]
    )
    if invalid_events:
        raise RuntimeError(
            f"Local ledger cutover found {invalid_events} unclassified or invalid event(s)."
        )

    missing_claims = int(
        connection.execute(
            """
            select count(*)
            from count_events as event
            where event.submitted_report_id is not null
              and not exists (
                  select 1
                  from local_report_event_claims as claim
                  where claim.event_id = event.event_id
                    and claim.report_id = event.submitted_report_id
              )
            """
        ).fetchone()[0]
    )
    if missing_claims:
        raise RuntimeError(
            f"Local ledger cutover found {missing_claims} submitted event(s) without exact claims."
        )


def _migrate_camera_catalog(connection: sqlite3.Connection) -> None:
    now = datetime.now(UTC).isoformat()
    connection.execute(
        """
        insert into local_sites (
            local_site_id,
            enterprise_id,
            display_name,
            created_at,
            updated_at
        )
        values ('primary', null, null, ?, ?)
        on conflict(local_site_id) do nothing
        """,
        (now, now),
    )
    camera_rows = connection.execute(
        """
        select camera_key, camera_id, camera_name, min(recorded_at) as first_seen_at,
               max(recorded_at) as last_seen_at
        from count_events
        where camera_key is not null
        group by camera_key, camera_id, camera_name
        union all
        select camera_key, null, camera_name, min(started_at),
               max(coalesce(last_frame_at, ended_at, updated_at))
        from monitoring_sessions
        group by camera_key, camera_name
        union all
        select camera_key, null, null, min(first_event_at), max(last_event_at)
        from metric_rollups
        group by camera_key
        union all
        select central_camera_key, camera_id, camera_name,
               min(coalesce(first_event_at, last_event_at)),
               max(coalesce(last_event_at, first_event_at))
        from local_report_source_batches
        where first_event_at is not null or last_event_at is not null
        group by central_camera_key, camera_id, camera_name
        """
    ).fetchall()
    for row in camera_rows:
        camera_key = str(row["camera_key"])
        connection.execute(
            """
            insert into local_cameras (
                camera_key,
                local_site_id,
                central_camera_id,
                local_camera_id,
                display_name,
                first_seen_at,
                last_seen_at
            )
            values (?, 'primary', ?, ?, ?, ?, ?)
            on conflict(camera_key) do update set
                local_camera_id = coalesce(excluded.local_camera_id, local_cameras.local_camera_id),
                display_name = coalesce(excluded.display_name, local_cameras.display_name),
                first_seen_at = min(local_cameras.first_seen_at, excluded.first_seen_at),
                last_seen_at = max(local_cameras.last_seen_at, excluded.last_seen_at)
            """,
            (
                camera_key,
                _central_camera_id(camera_key),
                row["camera_id"],
                row["camera_name"],
                row["first_seen_at"],
                row["last_seen_at"],
            ),
        )
    for row in connection.execute(
        "select camera_key from local_camera_event_sequences order by camera_key"
    ):
        upsert_local_camera(
            connection,
            camera_key=str(row["camera_key"]),
            central_camera_id=_central_camera_id(str(row["camera_key"])),
            local_camera_id=None,
            display_name=None,
            observed_at=now,
        )


def _migrate_latest_camera_state(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        """
        select recorded_at, camera_id, camera_name, running, status, error,
               entry_count, exit_count, occupancy_count, payload_json
        from count_snapshots
        order by recorded_at, id
        """
    ).fetchall()
    for row in rows:
        payload = _json_object(row["payload_json"])
        raw_config = payload.get("camera_config")
        camera_config = raw_config if isinstance(raw_config, dict) else {}
        camera_key = local_camera_key(
            row["camera_id"],
            row["camera_name"],
            payload.get(
                "central_camera_id",
                payload.get(
                    "centralCameraId",
                    camera_config.get("central_camera_id", camera_config.get("centralCameraId")),
                ),
            ),
        )
        observed_at = str(row["recorded_at"])
        connection.execute(
            """
            insert into local_cameras (
                camera_key,
                local_site_id,
                central_camera_id,
                local_camera_id,
                display_name,
                first_seen_at,
                last_seen_at
            )
            values (?, 'primary', ?, ?, ?, ?, ?)
            on conflict(camera_key) do update set
                local_camera_id = coalesce(excluded.local_camera_id, local_cameras.local_camera_id),
                display_name = coalesce(excluded.display_name, local_cameras.display_name),
                last_seen_at = max(local_cameras.last_seen_at, excluded.last_seen_at)
            """,
            (
                camera_key,
                _central_camera_id(camera_key),
                row["camera_id"],
                row["camera_name"],
                observed_at,
                observed_at,
            ),
        )
        connection.execute(
            """
            insert into camera_live_state (
                camera_key,
                observed_at,
                state,
                running,
                entry_count,
                exit_count,
                occupancy_count,
                error_summary
            )
            values (?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(camera_key) do update set
                observed_at = excluded.observed_at,
                state = excluded.state,
                running = excluded.running,
                entry_count = excluded.entry_count,
                exit_count = excluded.exit_count,
                occupancy_count = excluded.occupancy_count,
                error_summary = excluded.error_summary
            where excluded.observed_at >= camera_live_state.observed_at
            """,
            (
                camera_key,
                observed_at,
                _camera_state(row["status"], bool(row["running"]), row["error"]),
                1 if row["running"] else 0,
                max(0, int(row["entry_count"] or 0)),
                max(0, int(row["exit_count"] or 0)),
                max(0, int(row["occupancy_count"] or 0)),
                (
                    redact_stream_credentials(str(row["error"]))[:500]
                    if row["error"] is not None
                    else None
                ),
            ),
        )


def _rebuild_count_event_ledger(connection: sqlite3.Connection) -> None:
    for index_name in (
        "idx_count_events_recorded_at",
        "idx_count_events_submitted_report_id",
        "idx_count_events_synced_at",
        "idx_count_events_business_date",
        "idx_count_events_reporting_period_open",
        "idx_count_events_camera_sequence",
        "idx_local_report_event_memberships_batch",
    ):
        connection.execute(f"drop index if exists {index_name}")

    connection.execute(
        "alter table local_report_event_memberships rename to local_report_event_memberships_v4"
    )
    connection.execute(
        "alter table local_report_event_claims rename to local_report_event_claims_v4"
    )
    connection.execute("alter table count_events rename to count_events_v4")
    for statement in _TARGET_EVENT_LEDGER_STATEMENTS:
        connection.execute(statement)
    connection.execute(
        """
        insert into count_events (
            event_id,
            recorded_at,
            business_date,
            reporting_period_id,
            camera_key,
            camera_event_sequence,
            camera_id,
            camera_name,
            direction,
            track_id,
            entry_count,
            exit_count,
            occupancy_count,
            visitor_id,
            is_unique_entry,
            reid_score,
            reid_decision,
            identity_confidence,
            payload_schema_version,
            attributes_json,
            source_kind,
            mock_run_id
        )
        select
            event_id,
            recorded_at,
            business_date,
            reporting_period_id,
            camera_key,
            camera_event_sequence,
            camera_id,
            camera_name,
            direction,
            track_id,
            entry_count,
            exit_count,
            occupancy_count,
            visitor_id,
            is_unique_entry,
            reid_score,
            reid_decision,
            identity_confidence,
            1,
            payload_json,
            source_kind,
            mock_run_id
        from count_events_v4
        order by id
        """
    )
    connection.execute(
        """
        insert into local_report_event_claims (event_id, report_id, claimed_at)
        select event_id, report_id, claimed_at
        from local_report_event_claims_v4
        """
    )
    connection.execute(
        """
        insert into local_report_event_memberships (
            report_revision_id,
            event_id,
            batch_id,
            selected_at
        )
        select report_revision_id, event_id, batch_id, selected_at
        from local_report_event_memberships_v4
        """
    )
    connection.execute("drop table local_report_event_memberships_v4")
    connection.execute("drop table local_report_event_claims_v4")
    connection.execute("drop table count_events_v4")


def _rebuild_camera_sequences(connection: sqlite3.Connection) -> None:
    connection.execute("alter table local_camera_event_sequences rename to camera_sequences_v4")
    connection.execute(
        """
        create table local_camera_event_sequences (
            camera_key text primary key,
            next_sequence integer not null check (next_sequence >= 0),
            foreign key (camera_key) references local_cameras(camera_key) on delete restrict
        )
        """
    )
    connection.execute(
        """
        insert into local_camera_event_sequences (camera_key, next_sequence)
        select camera_key, next_sequence from camera_sequences_v4
        """
    )
    connection.execute("drop table camera_sequences_v4")


def _rebuild_resilience_ownership(connection: sqlite3.Connection) -> None:
    for index_name in (
        "idx_coverage_gaps_one_open_per_session",
        "idx_coverage_gaps_period_camera",
        "idx_monitoring_sessions_camera_window",
        "idx_metric_rollups_period_grain",
    ):
        connection.execute(f"drop index if exists {index_name}")
    connection.execute("alter table coverage_gaps rename to coverage_gaps_v4")
    connection.execute("alter table monitoring_sessions rename to monitoring_sessions_v4")
    connection.execute("alter table metric_rollups rename to metric_rollups_v4")
    for statement in _TARGET_RESILIENCE_STATEMENTS:
        connection.execute(statement)
    connection.execute(
        """
        insert into monitoring_sessions (
            monitoring_session_id,
            camera_key,
            central_camera_id,
            camera_name,
            started_at,
            ended_at,
            last_frame_at,
            state,
            close_reason,
            reconnect_count,
            created_at,
            updated_at
        )
        select monitoring_session_id, camera_key, central_camera_id, camera_name,
               started_at, ended_at, last_frame_at, state, close_reason,
               reconnect_count, created_at, updated_at
        from monitoring_sessions_v4
        """
    )
    connection.execute(
        """
        insert into coverage_gaps (
            coverage_gap_id,
            monitoring_session_id,
            camera_key,
            reporting_period_id,
            started_at,
            ended_at,
            duration_seconds,
            reason,
            recoverable,
            detail,
            recorded_at
        )
        select coverage_gap_id, monitoring_session_id, camera_key, reporting_period_id,
               started_at, ended_at, duration_seconds, reason, recoverable, detail,
               recorded_at
        from coverage_gaps_v4
        """
    )
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
        select grain, bucket_start_at, bucket_end_at, reporting_period_id,
               business_date, camera_key, source_kind, mock_run_key, entries, exits,
               unique_entries, confirmed_unique_entries, degraded_unique_entries,
               peak_occupancy, last_occupancy, first_event_at, last_event_at,
               event_count, updated_at
        from metric_rollups_v4
        """
    )
    connection.execute("drop table coverage_gaps_v4")
    connection.execute("drop table monitoring_sessions_v4")
    connection.execute("drop table metric_rollups_v4")


def _verify_target_catalog(connection: sqlite3.Connection) -> None:
    forbidden = {"count_snapshots", "report_submissions", "count_events_v4"}
    existing = {
        str(row["name"])
        for row in connection.execute(
            "select name from sqlite_master where type in ('table', 'view')"
        )
    }
    remaining = sorted(forbidden & existing)
    if remaining:
        raise RuntimeError(f"Legacy local objects remain after cutover: {', '.join(remaining)}")
    event_columns = {
        str(row["name"]) for row in connection.execute("pragma table_info(count_events)")
    }
    forbidden_columns = {"payload_json", "submitted_report_id", "synced_at"}
    remaining_columns = sorted(forbidden_columns & event_columns)
    if remaining_columns:
        raise RuntimeError(
            "Legacy count-event columns remain after cutover: " + ", ".join(remaining_columns)
        )


def _central_camera_id(camera_key: str) -> str | None:
    try:
        return str(UUID(camera_key))
    except ValueError:
        return None


def _json_object(value: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(str(value)) if value else {}
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _camera_state(status: Any, running: bool, error: Any) -> str:
    normalized = str(status or "").strip().lower()
    if running or normalized == "running":
        return "running"
    if "reconnect" in normalized or "backoff" in normalized:
        return "reconnecting"
    if error is not None or normalized == "error":
        return "error"
    if normalized in {"connecting", "starting"}:
        return "connecting"
    return "stopped"


_TOPOLOGY_AND_LIVE_STATE_STATEMENTS = (
    """
    create table if not exists local_sites (
        local_site_id text primary key,
        enterprise_id text unique,
        display_name text,
        created_at text not null,
        updated_at text not null
    )
    """,
    """
    create table if not exists local_cameras (
        camera_key text primary key,
        local_site_id text not null,
        central_camera_id text unique,
        local_camera_id integer,
        display_name text,
        first_seen_at text not null,
        last_seen_at text not null,
        foreign key (local_site_id) references local_sites(local_site_id) on delete restrict,
        check (first_seen_at <= last_seen_at)
    )
    """,
    """
    create index if not exists idx_local_cameras_site
    on local_cameras(local_site_id, camera_key)
    """,
    """
    create table if not exists camera_live_state (
        camera_key text primary key,
        observed_at text not null,
        state text not null check (
            state in ('connecting', 'running', 'reconnecting', 'stopped', 'error')
        ),
        running integer not null check (running in (0, 1)),
        entry_count integer not null check (entry_count >= 0),
        exit_count integer not null check (exit_count >= 0),
        occupancy_count integer not null check (occupancy_count >= 0),
        error_summary text,
        foreign key (camera_key) references local_cameras(camera_key) on delete cascade
    )
    """,
)


_TARGET_RESILIENCE_STATEMENTS = (
    """
    create table monitoring_sessions (
        monitoring_session_id text primary key,
        camera_key text not null,
        central_camera_id text,
        camera_name text,
        started_at text not null,
        ended_at text,
        last_frame_at text,
        state text not null check (
            state in ('connecting', 'running', 'reconnecting', 'stopped', 'error')
        ),
        close_reason text,
        reconnect_count integer not null default 0 check (reconnect_count >= 0),
        created_at text not null,
        updated_at text not null,
        foreign key (camera_key) references local_cameras(camera_key) on delete restrict,
        check (ended_at is null or ended_at >= started_at)
    )
    """,
    """
    create index idx_monitoring_sessions_camera_window
    on monitoring_sessions(camera_key, started_at, ended_at)
    """,
    """
    create table coverage_gaps (
        coverage_gap_id text primary key,
        monitoring_session_id text not null,
        camera_key text not null,
        reporting_period_id text not null,
        started_at text not null,
        ended_at text,
        duration_seconds real,
        reason text not null,
        recoverable integer not null check (recoverable in (0, 1)),
        detail text,
        recorded_at text not null,
        check (ended_at is null or ended_at >= started_at),
        check (duration_seconds is null or duration_seconds >= 0),
        foreign key (monitoring_session_id)
            references monitoring_sessions(monitoring_session_id) on delete cascade,
        foreign key (reporting_period_id) references reporting_periods(period_id),
        foreign key (camera_key) references local_cameras(camera_key) on delete restrict
    )
    """,
    """
    create unique index idx_coverage_gaps_one_open_per_session
    on coverage_gaps(monitoring_session_id)
    where ended_at is null
    """,
    """
    create index idx_coverage_gaps_period_camera
    on coverage_gaps(reporting_period_id, camera_key, started_at)
    """,
    """
    create table metric_rollups (
        grain text not null check (grain in ('hour', 'day')),
        bucket_start_at text not null,
        bucket_end_at text not null,
        reporting_period_id text not null,
        business_date text not null,
        camera_key text not null,
        source_kind text not null check (source_kind in ('real', 'mock', 'hybrid')),
        mock_run_key text not null default '',
        entries integer not null default 0 check (entries >= 0),
        exits integer not null default 0 check (exits >= 0),
        unique_entries integer not null default 0 check (unique_entries >= 0),
        confirmed_unique_entries integer not null default 0
            check (confirmed_unique_entries >= 0),
        degraded_unique_entries integer not null default 0
            check (degraded_unique_entries >= 0),
        peak_occupancy integer not null default 0 check (peak_occupancy >= 0),
        last_occupancy integer not null default 0 check (last_occupancy >= 0),
        first_event_at text not null,
        last_event_at text not null,
        event_count integer not null default 0 check (event_count >= 0),
        updated_at text not null,
        primary key (grain, bucket_start_at, camera_key, source_kind, mock_run_key),
        foreign key (reporting_period_id) references reporting_periods(period_id),
        foreign key (camera_key) references local_cameras(camera_key) on delete restrict,
        check (bucket_start_at < bucket_end_at),
        check (first_event_at <= last_event_at)
    )
    """,
    """
    create index idx_metric_rollups_period_grain
    on metric_rollups(reporting_period_id, grain, bucket_start_at)
    """,
)


_TARGET_EVENT_LEDGER_STATEMENTS = (
    """
    create table count_events (
        event_id text primary key,
        recorded_at text not null,
        business_date text not null,
        reporting_period_id text not null,
        camera_key text not null,
        camera_event_sequence integer not null check (camera_event_sequence >= 0),
        camera_id integer,
        camera_name text,
        direction text not null check (direction in ('entry', 'exit')),
        track_id integer,
        entry_count integer not null default 0 check (entry_count >= 0),
        exit_count integer not null default 0 check (exit_count >= 0),
        occupancy_count integer not null default 0 check (occupancy_count >= 0),
        visitor_id text,
        is_unique_entry integer not null default 0 check (is_unique_entry in (0, 1)),
        reid_score real,
        reid_decision text,
        identity_confidence text,
        payload_schema_version integer not null check (payload_schema_version = 1),
        attributes_json text not null check (
            json_valid(attributes_json)
            and length(cast(attributes_json as blob)) <= 65536
        ),
        source_kind text not null check (source_kind in ('real', 'mock', 'hybrid')),
        mock_run_id text,
        foreign key (reporting_period_id) references reporting_periods(period_id) on delete restrict,
        foreign key (camera_key) references local_cameras(camera_key) on delete restrict,
        unique (camera_key, camera_event_sequence)
    )
    """,
    "create index idx_count_events_recorded_at on count_events(recorded_at)",
    """
    create index idx_count_events_reporting_period_open
    on count_events(reporting_period_id, recorded_at, event_id)
    """,
    "create index idx_count_events_business_date on count_events(business_date, recorded_at)",
    """
    create table local_report_event_claims (
        event_id text primary key,
        report_id text not null,
        claimed_at text not null,
        foreign key (event_id) references count_events(event_id) on delete cascade,
        foreign key (report_id) references local_reports(report_id) on delete cascade
    )
    """,
    """
    create table local_report_event_memberships (
        report_revision_id text not null,
        event_id text not null,
        batch_id text not null,
        selected_at text not null,
        primary key (report_revision_id, event_id),
        foreign key (report_revision_id)
            references local_report_revisions(revision_id) on delete cascade,
        foreign key (event_id) references count_events(event_id) on delete cascade,
        foreign key (batch_id) references local_report_source_batches(batch_id) on delete cascade
    )
    """,
    """
    create index idx_local_report_event_memberships_batch
    on local_report_event_memberships(batch_id)
    """,
)
