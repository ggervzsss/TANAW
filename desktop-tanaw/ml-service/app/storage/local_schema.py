from __future__ import annotations

import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from app.storage.report_ledger_schema import migrate_report_ledger_v3
from app.storage.reporting_periods import (
    REPORTING_TIMEZONE,
    ReportingPeriod,
    monthly_period_for_captured_at,
    monthly_period_from_label,
    parse_captured_at,
)
from app.storage.resilience_schema import migrate_resilience_ledger_v4
from app.storage.target_schema import bind_local_site, migrate_target_ledger_v5

LOCAL_SCHEMA_VERSION = 5
SQLITE_BUSY_TIMEOUT_MS = 5_000

_Migration = Callable[[sqlite3.Connection], None]


def connect_local_database(database_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database_path, timeout=SQLITE_BUSY_TIMEOUT_MS / 1_000)
    connection.row_factory = sqlite3.Row
    _configure_connection(connection)
    return connection


def initialize_local_database(database_path: Path, *, enterprise_id: str | None = None) -> None:
    connection = sqlite3.connect(
        database_path,
        timeout=SQLITE_BUSY_TIMEOUT_MS / 1_000,
        isolation_level=None,
    )
    connection.row_factory = sqlite3.Row
    try:
        _configure_connection(connection)
        connection.execute("pragma journal_mode = wal")
        connection.execute("pragma synchronous = normal")
        database_version = int(connection.execute("pragma user_version").fetchone()[0])
        if database_version > LOCAL_SCHEMA_VERSION:
            raise RuntimeError(
                f"Local ledger schema version {database_version} is newer than the "
                f"supported version {LOCAL_SCHEMA_VERSION}. Upgrade TANAW before opening it."
            )
        connection.execute(
            """
            create table if not exists local_schema_migrations (
                version integer primary key,
                name text not null unique,
                applied_at text not null
            )
            """
        )

        migrations: tuple[tuple[int, str, _Migration], ...] = (
            (1, "baseline_local_metrics_ledger", _migrate_baseline),
            (2, "canonical_reporting_periods", _migrate_reporting_periods),
            (3, "immutable_report_revisions_and_sync_outbox", migrate_report_ledger_v3),
            (4, "camera_resilience_coverage_and_rollups", migrate_resilience_ledger_v4),
            (5, "target_only_edge_ledger", migrate_target_ledger_v5),
        )
        backup_path = _prepare_upgrade_backup(
            connection,
            database_path,
            database_version=database_version,
        )
        for version, name, migration in migrations:
            if _migration_is_applied(connection, version):
                continue
            foreign_keys_disabled = version == 5
            if foreign_keys_disabled:
                connection.execute("pragma foreign_keys = off")
            connection.execute("begin immediate")
            try:
                if not _migration_is_applied(connection, version):
                    migration(connection)
                    connection.execute(
                        """
                        insert into local_schema_migrations (version, name, applied_at)
                        values (?, ?, ?)
                        """,
                        (version, name, datetime.now(UTC).isoformat()),
                    )
                    connection.execute(f"pragma user_version = {version}")
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                if foreign_keys_disabled:
                    connection.execute("pragma foreign_keys = on")

        applied_version = connection.execute(
            "select coalesce(max(version), 0) from local_schema_migrations"
        ).fetchone()[0]
        if applied_version != LOCAL_SCHEMA_VERSION:
            raise RuntimeError(
                f"Local ledger schema is at version {applied_version}; "
                f"expected {LOCAL_SCHEMA_VERSION}."
            )
        _verify_database_integrity(connection)
        bind_local_site(connection, enterprise_id=enterprise_id)
        connection.commit()
        if 0 < database_version < LOCAL_SCHEMA_VERSION:
            connection.execute("vacuum")
            _verify_database_integrity(connection)
        if backup_path is not None:
            backup_path.unlink(missing_ok=True)
    finally:
        connection.close()


def _configure_connection(connection: sqlite3.Connection) -> None:
    connection.execute("pragma foreign_keys = on")
    connection.execute("pragma secure_delete = on")
    connection.execute(f"pragma busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")


def _migration_is_applied(connection: sqlite3.Connection, version: int) -> bool:
    return (
        connection.execute(
            "select 1 from local_schema_migrations where version = ?",
            (version,),
        ).fetchone()
        is not None
    )


def _prepare_upgrade_backup(
    connection: sqlite3.Connection,
    database_path: Path,
    *,
    database_version: int,
) -> Path | None:
    backup_path = database_path.with_name(f".{database_path.name}.schema-v4.backup")
    if database_version == LOCAL_SCHEMA_VERSION:
        backup_path.unlink(missing_ok=True)
        return None
    if database_version < 1:
        return None
    connection.execute("pragma wal_checkpoint(full)")
    if not backup_path.exists():
        backup = sqlite3.connect(backup_path)
        try:
            connection.backup(backup)
            backup.commit()
        finally:
            backup.close()
    return backup_path


def _verify_database_integrity(connection: sqlite3.Connection) -> None:
    integrity = str(connection.execute("pragma integrity_check").fetchone()[0])
    if integrity != "ok":
        raise RuntimeError(f"Local ledger integrity check failed: {integrity}")
    foreign_key_failure = connection.execute("pragma foreign_key_check").fetchone()
    if foreign_key_failure is not None:
        raise RuntimeError(
            "Local ledger foreign-key check failed for "
            f"{foreign_key_failure['table']} row {foreign_key_failure['rowid']}."
        )


def _migrate_baseline(connection: sqlite3.Connection) -> None:
    for statement in _BASELINE_SCHEMA_STATEMENTS:
        connection.execute(statement)

    _ensure_column(connection, "count_events", "visitor_id", "text")
    _ensure_column(connection, "count_events", "is_unique_entry", "integer not null default 0")
    _ensure_column(connection, "count_events", "reid_score", "real")
    _ensure_column(connection, "count_events", "reid_decision", "text")
    _ensure_column(connection, "count_events", "identity_confidence", "text")
    _ensure_column(connection, "count_events", "source_kind", "text not null default 'real'")
    _ensure_column(connection, "count_events", "mock_run_id", "text")
    _ensure_column(connection, "count_events", "synced_at", "text")
    _ensure_column(connection, "count_snapshots", "source_kind", "text not null default 'real'")
    _ensure_column(connection, "count_snapshots", "mock_run_id", "text")
    _ensure_column(
        connection,
        "report_submissions",
        "sync_status",
        "text not null default 'pending_cloud_sync'",
    )
    _ensure_column(
        connection,
        "report_submissions",
        "source_kind",
        "text not null default 'real'",
    )
    _ensure_column(connection, "report_submissions", "mock_run_id", "text")
    _ensure_column(connection, "report_submissions", "synced_at", "text")
    _ensure_column(connection, "report_submissions", "raw_purged_at", "text")
    _ensure_column(connection, "occupancy_corrections", "enterprise_id", "text")
    _ensure_column(
        connection,
        "occupancy_corrections",
        "source_kind",
        "text not null default 'real'",
    )
    _ensure_column(connection, "occupancy_corrections", "mock_run_id", "text")
    connection.execute(
        "create index if not exists idx_count_events_synced_at on count_events(synced_at)"
    )
    connection.execute(
        """
        update count_events
        set is_unique_entry = 1
        where direction = 'entry'
          and reid_decision is null
          and (visitor_id is null or visitor_id = '')
          and is_unique_entry = 0
        """
    )


def _migrate_reporting_periods(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        create table if not exists reporting_periods (
            period_id text primary key,
            period_type text not null check (period_type = 'month'),
            timezone text not null,
            business_start_date text not null,
            business_end_date_exclusive text not null,
            starts_at_utc text not null,
            ends_at_utc text not null,
            label text not null,
            created_at text not null,
            check (business_start_date < business_end_date_exclusive),
            check (starts_at_utc < ends_at_utc)
        )
        """
    )
    _ensure_column(connection, "count_events", "business_date", "text")
    _ensure_column(connection, "count_events", "reporting_period_id", "text")
    _ensure_column(connection, "report_submissions", "reporting_period_id", "text")
    connection.execute(
        """
        create index if not exists idx_count_events_reporting_period_open
        on count_events(reporting_period_id, submitted_report_id, recorded_at)
        """
    )
    connection.execute(
        """
        create index if not exists idx_count_events_business_date
        on count_events(business_date, recorded_at)
        """
    )
    connection.execute(
        """
        create index if not exists idx_report_submissions_reporting_period
        on report_submissions(reporting_period_id, submitted_at)
        """
    )

    event_rows = connection.execute(
        """
        select id, recorded_at
        from count_events
        where reporting_period_id is null or business_date is null
        """
    ).fetchall()
    for row in event_rows:
        try:
            captured_at = parse_captured_at(str(row["recorded_at"]))
            period = monthly_period_for_captured_at(captured_at)
        except ValueError:
            continue
        _upsert_reporting_period(connection, period)
        business_date = captured_at.astimezone(REPORTING_TIMEZONE).date()
        connection.execute(
            """
            update count_events
            set recorded_at = ?, reporting_period_id = ?, business_date = ?
            where id = ?
            """,
            (
                captured_at.isoformat(),
                period.period_id,
                business_date.isoformat(),
                row["id"],
            ),
        )

    report_rows = connection.execute(
        """
        select report_id, period
        from report_submissions
        where reporting_period_id is null
        """
    ).fetchall()
    for row in report_rows:
        report_period = monthly_period_from_label(str(row["period"]))
        if report_period is None:
            continue
        _upsert_reporting_period(connection, report_period)
        connection.execute(
            """
            update report_submissions
            set reporting_period_id = ?
            where report_id = ?
            """,
            (report_period.period_id, row["report_id"]),
        )


def upsert_reporting_period(connection: sqlite3.Connection, period: ReportingPeriod) -> None:
    _upsert_reporting_period(connection, period)


def _upsert_reporting_period(connection: sqlite3.Connection, period: ReportingPeriod) -> None:
    connection.execute(
        """
        insert into reporting_periods (
            period_id,
            period_type,
            timezone,
            business_start_date,
            business_end_date_exclusive,
            starts_at_utc,
            ends_at_utc,
            label,
            created_at
        )
        values (?, 'month', ?, ?, ?, ?, ?, ?, ?)
        on conflict(period_id) do nothing
        """,
        (
            period.period_id,
            period.timezone,
            period.business_start_date.isoformat(),
            period.business_end_date_exclusive.isoformat(),
            period.starts_at_utc.isoformat(),
            period.ends_at_utc.isoformat(),
            period.label,
            datetime.now(UTC).isoformat(),
        ),
    )


def _ensure_column(
    connection: sqlite3.Connection, table_name: str, column_name: str, definition: str
) -> None:
    existing_columns = {
        row["name"] for row in connection.execute(f"pragma table_info({table_name})").fetchall()
    }
    if column_name not in existing_columns:
        connection.execute(f"alter table {table_name} add column {column_name} {definition}")


_BASELINE_SCHEMA_STATEMENTS = (
    """
    create table if not exists count_events (
        id integer primary key autoincrement,
        event_id text not null unique,
        recorded_at text not null,
        camera_id integer,
        camera_name text,
        direction text not null check (direction in ('entry', 'exit')),
        track_id integer,
        entry_count integer not null default 0,
        exit_count integer not null default 0,
        occupancy_count integer not null default 0,
        visitor_id text,
        is_unique_entry integer not null default 0,
        reid_score real,
        reid_decision text,
        identity_confidence text,
        source_kind text not null default 'real',
        mock_run_id text,
        payload_json text not null,
        submitted_report_id text,
        synced_at text
    )
    """,
    "create index if not exists idx_count_events_recorded_at on count_events(recorded_at)",
    """
    create index if not exists idx_count_events_submitted_report_id
    on count_events(submitted_report_id)
    """,
    """
    create table if not exists count_snapshots (
        id integer primary key autoincrement,
        recorded_at text not null,
        camera_id integer,
        camera_name text,
        entry_count integer not null default 0,
        exit_count integer not null default 0,
        occupancy_count integer not null default 0,
        running integer not null default 0,
        status text,
        error text,
        source_kind text not null default 'real',
        mock_run_id text,
        payload_json text not null
    )
    """,
    """
    create index if not exists idx_count_snapshots_recorded_at
    on count_snapshots(recorded_at)
    """,
    """
    create table if not exists report_submissions (
        report_id text primary key,
        period text not null,
        submitted_at text not null,
        entries integer not null default 0,
        exits integer not null default 0,
        peak_occupancy integer not null default 0,
        unique_count integer not null default 0,
        notes text,
        payload_json text not null,
        sync_status text not null default 'pending_cloud_sync',
        source_kind text not null default 'real',
        mock_run_id text,
        synced_at text,
        raw_purged_at text
    )
    """,
    """
    create table if not exists occupancy_corrections (
        correction_id text primary key,
        enterprise_id text,
        camera_id integer,
        old_occupancy integer not null default 0,
        new_occupancy integer not null default 0,
        delta integer not null default 0,
        reason text not null,
        actor_id text,
        actor_name text,
        source_kind text not null default 'real',
        mock_run_id text,
        recorded_at text not null,
        payload_json text not null
    )
    """,
    """
    create index if not exists idx_occupancy_corrections_recorded_at
    on occupancy_corrections(recorded_at)
    """,
    """
    create index if not exists idx_occupancy_corrections_source
    on occupancy_corrections(source_kind, mock_run_id)
    """,
    """
    create table if not exists visitor_identities (
        visitor_id text primary key,
        business_date text not null,
        camera_id integer,
        first_seen_at text not null,
        last_seen_at text not null,
        representative_embedding blob not null,
        embedding_dim integer not null,
        embedding_count integer not null default 1,
        model_name text not null,
        expires_at text not null
    )
    """,
    """
    create index if not exists idx_visitor_identities_business_date
    on visitor_identities(business_date)
    """,
    """
    create index if not exists idx_visitor_identities_expires_at
    on visitor_identities(expires_at)
    """,
    """
    create table if not exists visitor_model_embeddings (
        visitor_id text not null,
        model_name text not null,
        representative_embedding blob not null,
        embedding_dim integer not null,
        embedding_count integer not null default 1,
        updated_at text not null,
        primary key (visitor_id, model_name),
        foreign key (visitor_id) references visitor_identities(visitor_id) on delete cascade
    )
    """,
    """
    create index if not exists idx_visitor_model_embeddings_model
    on visitor_model_embeddings(model_name)
    """,
    """
    create table if not exists visitor_sightings (
        sighting_id text primary key,
        visitor_id text not null,
        recorded_at text not null,
        business_date text not null,
        camera_id integer,
        track_id integer,
        direction text not null check (direction in ('entry', 'exit')),
        reid_score real,
        reid_decision text not null,
        identity_confidence text not null,
        detection_confidence real,
        bbox_json text,
        payload_json text not null,
        foreign key (visitor_id) references visitor_identities(visitor_id)
    )
    """,
    """
    create index if not exists idx_visitor_sightings_business_date
    on visitor_sightings(business_date)
    """,
)
