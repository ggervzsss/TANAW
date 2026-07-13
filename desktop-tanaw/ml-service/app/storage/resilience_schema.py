from __future__ import annotations

import sqlite3

from app.storage.reporting_periods import (
    REPORTING_TIMEZONE,
    monthly_period_for_captured_at,
    parse_captured_at,
)
from app.storage.resilience_store import record_metric_rollups
from app.storage.session_credentials import scrub_snapshot_table_credentials


def migrate_resilience_ledger_v4(connection: sqlite3.Connection) -> None:
    _normalize_report_outbox_contract_version(connection)
    for statement in _RESILIENCE_LEDGER_STATEMENTS:
        connection.execute(statement)
    scrub_snapshot_table_credentials(connection)
    _backfill_metric_rollups(connection)


def _backfill_metric_rollups(connection: sqlite3.Connection) -> None:
    if connection.execute("select 1 from metric_rollups limit 1").fetchone() is not None:
        return
    rows = connection.execute(
        """
        select
            recorded_at,
            business_date,
            camera_key,
            camera_id,
            camera_name,
            direction,
            occupancy_count,
            visitor_id,
            is_unique_entry,
            source_kind,
            mock_run_id
        from count_events
        where reporting_period_id is not null and camera_key is not null
        order by recorded_at, event_id
        """
    ).fetchall()
    for row in rows:
        captured_at = parse_captured_at(str(row["recorded_at"]))
        period = monthly_period_for_captured_at(captured_at)
        record_metric_rollups(
            connection,
            event={
                "camera_id": row["camera_id"],
                "camera_name": row["camera_name"],
                "direction": row["direction"],
                "visitor_id": row["visitor_id"],
                "is_unique_entry": bool(row["is_unique_entry"]),
                "source_kind": row["source_kind"],
                "mock_run_id": row["mock_run_id"],
                "counts": {"occupancy": row["occupancy_count"]},
            },
            captured_at=captured_at,
            reporting_period=period,
            business_date=(
                str(row["business_date"])
                if row["business_date"]
                else captured_at.astimezone(REPORTING_TIMEZONE).date().isoformat()
            ),
            camera_key=str(row["camera_key"]),
        )


def _normalize_report_outbox_contract_version(connection: sqlite3.Connection) -> None:
    contract_column = next(
        row
        for row in connection.execute("pragma table_info(sync_outbox_items)")
        if row["name"] == "contract_version"
    )
    if str(contract_column["type"]).upper() == "INTEGER":
        return

    connection.execute("drop index if exists idx_sync_attempts_outbox")
    connection.execute("drop index if exists idx_sync_outbox_ready")
    connection.execute("alter table sync_attempts rename to sync_attempts_v3")
    connection.execute("alter table sync_outbox_items rename to sync_outbox_items_v3")
    connection.execute(_SYNC_OUTBOX_V4)
    connection.execute(_SYNC_ATTEMPTS_V4)
    connection.execute(
        """
        insert into sync_outbox_items (
            outbox_item_id,
            report_revision_id,
            command_id,
            idempotency_key,
            endpoint,
            contract_version,
            payload_json,
            payload_hash,
            status,
            created_at,
            next_attempt_at,
            attempt_count,
            last_attempt_at,
            last_error_class,
            last_error_message,
            acknowledged_at,
            acknowledgement_json
        )
        select
            outbox_item_id,
            report_revision_id,
            command_id,
            idempotency_key,
            endpoint,
            2,
            payload_json,
            payload_hash,
            case
                when contract_version = 'report-submission.v2' then status
                else 'dead_letter'
            end,
            created_at,
            next_attempt_at,
            attempt_count,
            last_attempt_at,
            case
                when contract_version = 'report-submission.v2' then last_error_class
                else 'unsupported_legacy_contract_version'
            end,
            case
                when contract_version = 'report-submission.v2' then last_error_message
                else 'Historical outbox item used an unsupported contract version.'
            end,
            case
                when contract_version = 'report-submission.v2' then acknowledged_at
                else null
            end,
            case
                when contract_version = 'report-submission.v2' then acknowledgement_json
                else null
            end
        from sync_outbox_items_v3
        """
    )
    connection.execute(
        """
        insert into sync_attempts (
            attempt_id,
            outbox_item_id,
            attempt_number,
            attempted_at,
            completed_at,
            outcome,
            error_class,
            error_message,
            http_status,
            next_attempt_at,
            response_json
        )
        select
            attempt_id,
            outbox_item_id,
            attempt_number,
            attempted_at,
            completed_at,
            outcome,
            error_class,
            error_message,
            http_status,
            next_attempt_at,
            response_json
        from sync_attempts_v3
        """
    )
    connection.execute("drop table sync_attempts_v3")
    connection.execute("drop table sync_outbox_items_v3")
    connection.execute(
        """
        create index idx_sync_outbox_ready
        on sync_outbox_items(status, next_attempt_at, created_at, outbox_item_id)
        """
    )
    connection.execute(
        """
        create index idx_sync_attempts_outbox
        on sync_attempts(outbox_item_id, attempt_number)
        """
    )


_SYNC_OUTBOX_V4 = """
create table sync_outbox_items (
    outbox_item_id text primary key,
    report_revision_id text not null unique,
    command_id text not null unique,
    idempotency_key text not null unique,
    endpoint text not null,
    contract_version integer not null check (contract_version = 2),
    payload_json text not null,
    payload_hash text not null,
    status text not null check (
        status in ('ready', 'retry', 'in_flight', 'acknowledged', 'dead_letter')
    ),
    created_at text not null,
    next_attempt_at text not null,
    attempt_count integer not null default 0 check (attempt_count >= 0),
    last_attempt_at text,
    last_error_class text,
    last_error_message text,
    acknowledged_at text,
    acknowledgement_json text,
    foreign key (report_revision_id)
        references local_report_revisions(revision_id) on delete cascade
)
"""


_SYNC_ATTEMPTS_V4 = """
create table sync_attempts (
    attempt_id text primary key,
    outbox_item_id text not null,
    attempt_number integer not null check (attempt_number > 0),
    attempted_at text not null,
    completed_at text not null,
    outcome text not null check (outcome in ('acknowledged', 'retry', 'dead_letter')),
    error_class text,
    error_message text,
    http_status integer,
    next_attempt_at text,
    response_json text,
    foreign key (outbox_item_id) references sync_outbox_items(outbox_item_id)
        on delete cascade,
    unique (outbox_item_id, attempt_number)
)
"""


_RESILIENCE_LEDGER_STATEMENTS = (
    """
    create table if not exists monitoring_sessions (
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
        check (ended_at is null or ended_at >= started_at)
    )
    """,
    """
    create index if not exists idx_monitoring_sessions_camera_window
    on monitoring_sessions(camera_key, started_at, ended_at)
    """,
    """
    create table if not exists coverage_gaps (
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
        foreign key (reporting_period_id) references reporting_periods(period_id)
    )
    """,
    """
    create unique index if not exists idx_coverage_gaps_one_open_per_session
    on coverage_gaps(monitoring_session_id)
    where ended_at is null
    """,
    """
    create index if not exists idx_coverage_gaps_period_camera
    on coverage_gaps(reporting_period_id, camera_key, started_at)
    """,
    """
    create table if not exists metric_rollups (
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
        check (bucket_start_at < bucket_end_at),
        check (first_event_at <= last_event_at)
    )
    """,
    """
    create index if not exists idx_metric_rollups_period_grain
    on metric_rollups(reporting_period_id, grain, bucket_start_at)
    """,
    """
    create table if not exists local_persistence_errors (
        persistence_error_id text primary key,
        operation text not null,
        reason text not null,
        detail text not null,
        attempt_count integer not null check (attempt_count > 0),
        occurred_at text not null,
        resolved_at text
    )
    """,
    """
    create index if not exists idx_local_persistence_errors_unresolved
    on local_persistence_errors(resolved_at, occurred_at)
    """,
)
