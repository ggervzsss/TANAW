from __future__ import annotations

import sqlite3

TARGET_LOCAL_SCHEMA_VERSION = 7

TARGET_SCHEMA_STATEMENTS: tuple[str, ...] = (
    """CREATE TABLE camera_runtime_state (
        camera_key text primary key,
        snapshot_json text not null check (
            json_valid(snapshot_json)
            and length(cast(snapshot_json as blob)) <= 65536
        ),
        updated_at text not null,
        foreign key (camera_key) references local_cameras(camera_key) on delete cascade
    )""",
    """CREATE TABLE camera_live_state (
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
    )""",
    """CREATE TABLE count_events (
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
    )""",
    """CREATE TABLE coverage_gaps (
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
    )""",
    """CREATE TABLE local_camera_event_sequences (
            camera_key text primary key,
            next_sequence integer not null check (next_sequence >= 0),
            foreign key (camera_key) references local_cameras(camera_key) on delete restrict
        )""",
    """CREATE TABLE local_cameras (
        camera_key text primary key,
        local_site_id text not null,
        central_camera_id text unique,
        local_camera_id integer,
        display_name text,
        first_seen_at text not null,
        last_seen_at text not null,
        foreign key (local_site_id) references local_sites(local_site_id) on delete restrict,
        check (first_seen_at <= last_seen_at)
    )""",
    """CREATE TABLE local_persistence_errors (
        persistence_error_id text primary key,
        operation text not null,
        reason text not null,
        detail text not null,
        attempt_count integer not null check (attempt_count > 0),
        occurred_at text not null,
        resolved_at text
    )""",
    """CREATE TABLE local_report_event_claims (
        event_id text primary key,
        report_id text not null,
        claimed_at text not null,
        foreign key (event_id) references count_events(event_id) on delete cascade,
        foreign key (report_id) references local_reports(report_id) on delete cascade
    )""",
    """CREATE TABLE local_report_event_memberships (
        report_revision_id text not null,
        event_id text not null,
        batch_id text not null,
        selected_at text not null,
        primary key (report_revision_id, event_id),
        foreign key (report_revision_id)
            references local_report_revisions(revision_id) on delete cascade,
        foreign key (event_id) references count_events(event_id) on delete cascade,
        foreign key (batch_id) references local_report_source_batches(batch_id) on delete cascade
    )""",
    """CREATE TABLE local_report_revisions (
        revision_id text primary key,
        report_id text not null,
        revision_number integer not null check (revision_number > 0),
        command_id text not null,
        idempotency_key text not null,
        request_hash text not null,
        payload_hash text not null,
        expected_version integer not null check (expected_version >= 0),
        submitted_at text not null,
        entries integer not null check (entries >= 0),
        exits integer not null check (exits >= 0),
        peak_occupancy integer not null check (peak_occupancy >= 0),
        unique_count integer not null check (unique_count >= 0),
        notes text,
        payload_json text not null,
        canonical_payload_json text not null,
        source_kind text not null check (source_kind in ('real', 'mock', 'hybrid')),
        mock_run_id text,
        foreign key (report_id) references local_reports(report_id) on delete cascade,
        unique (report_id, revision_number),
        unique (report_id, idempotency_key),
        unique (command_id)
    )""",
    """CREATE TABLE local_report_source_batches (
        batch_id text primary key,
        report_revision_id text not null,
        reporting_period_id text,
        camera_id integer,
        camera_name text,
        central_camera_key text not null,
        source_kind text not null check (source_kind in ('real', 'mock', 'hybrid')),
        mock_run_id text,
        event_sequence_start integer not null check (event_sequence_start >= 0),
        event_sequence_end_exclusive integer not null
            check (event_sequence_end_exclusive >= event_sequence_start),
        first_event_at text,
        last_event_at text,
        event_count integer not null check (event_count >= 0),
        event_checksum text not null,
        foreign key (report_revision_id)
            references local_report_revisions(revision_id) on delete cascade,
        foreign key (reporting_period_id) references reporting_periods(period_id)
    )""",
    """CREATE TABLE local_reports (
        report_id text primary key,
        reporting_period_id text,
        period_label text not null,
        current_revision_id text,
        created_at text not null,
        updated_at text not null,
        raw_purged_at text,
        last_acknowledged_logical_version integer not null default 0
            check (last_acknowledged_logical_version >= 0),
        foreign key (reporting_period_id) references reporting_periods(period_id),
        foreign key (current_revision_id) references local_report_revisions(revision_id)
            on delete set null deferrable initially deferred
    )""",
    """CREATE TABLE local_sites (
        local_site_id text primary key,
        enterprise_id text unique,
        display_name text,
        created_at text not null,
        updated_at text not null
    )""",
    """CREATE TABLE metric_rollups (
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
    )""",
    """CREATE TABLE monitoring_sessions (
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
    )""",
    """CREATE TABLE occupancy_corrections (
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
    )""",
    """CREATE TABLE reporting_periods (
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
        )""",
    """CREATE TABLE sync_attempts (
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
)""",
    """CREATE TABLE sync_outbox_items (
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
)""",
    """CREATE TABLE visitor_identities (
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
    )""",
    """CREATE TABLE visitor_model_embeddings (
        visitor_id text not null,
        model_name text not null,
        representative_embedding blob not null,
        embedding_dim integer not null,
        embedding_count integer not null default 1,
        updated_at text not null,
        primary key (visitor_id, model_name),
        foreign key (visitor_id) references visitor_identities(visitor_id) on delete cascade
    )""",
    """CREATE TABLE visitor_sightings (
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
    )""",
    """CREATE INDEX idx_count_events_business_date on count_events(business_date, recorded_at)""",
    """CREATE INDEX idx_count_events_recorded_at on count_events(recorded_at)""",
    """CREATE INDEX idx_count_events_reporting_period_open
    on count_events(reporting_period_id, recorded_at, event_id)
    """,
    """CREATE UNIQUE INDEX idx_coverage_gaps_one_open_per_session
    on coverage_gaps(monitoring_session_id)
    where ended_at is null
    """,
    """CREATE INDEX idx_coverage_gaps_period_camera
    on coverage_gaps(reporting_period_id, camera_key, started_at)
    """,
    """CREATE INDEX idx_local_cameras_site
    on local_cameras(local_site_id, camera_key)
    """,
    """CREATE INDEX idx_local_persistence_errors_unresolved
    on local_persistence_errors(resolved_at, occurred_at)
    """,
    """CREATE INDEX idx_local_report_event_memberships_batch
    on local_report_event_memberships(batch_id)
    """,
    """CREATE INDEX idx_local_report_revisions_latest
    on local_report_revisions(report_id, revision_number desc)
    """,
    """CREATE INDEX idx_local_report_source_batches_revision
    on local_report_source_batches(report_revision_id)
    """,
    """CREATE UNIQUE INDEX idx_local_reports_period
    on local_reports(reporting_period_id)
    where reporting_period_id is not null
    """,
    """CREATE INDEX idx_metric_rollups_period_grain
    on metric_rollups(reporting_period_id, grain, bucket_start_at)
    """,
    """CREATE INDEX idx_monitoring_sessions_camera_window
    on monitoring_sessions(camera_key, started_at, ended_at)
    """,
    """CREATE INDEX idx_occupancy_corrections_recorded_at
    on occupancy_corrections(recorded_at)
    """,
    """CREATE INDEX idx_occupancy_corrections_source
    on occupancy_corrections(source_kind, mock_run_id)
    """,
    """CREATE INDEX idx_sync_attempts_outbox
        on sync_attempts(outbox_item_id, attempt_number)
        """,
    """CREATE INDEX idx_sync_outbox_ready
        on sync_outbox_items(status, next_attempt_at, created_at, outbox_item_id)
        """,
    """CREATE INDEX idx_visitor_identities_business_date
    on visitor_identities(business_date)
    """,
    """CREATE INDEX idx_visitor_identities_expires_at
    on visitor_identities(expires_at)
    """,
    """CREATE INDEX idx_visitor_model_embeddings_model
    on visitor_model_embeddings(model_name)
    """,
    """CREATE INDEX idx_visitor_sightings_business_date
    on visitor_sightings(business_date)
    """,
    """CREATE TRIGGER trg_local_report_revisions_immutable
    before update on local_report_revisions
    begin
        select raise(abort, 'local report revisions are immutable');
    end""",
)


def create_target_schema(connection: sqlite3.Connection) -> None:
    for statement in TARGET_SCHEMA_STATEMENTS:
        connection.execute(statement)
