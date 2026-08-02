import json
import sqlite3
from pathlib import Path

from app.storage.local_data_serialization import _load_json_object, _safe_int

LOCAL_SCHEMA_VERSION = 6
MIGRATABLE_SCHEMA_VERSIONS = {5}


class LocalDatabaseResetRequiredError(RuntimeError):
    """Raised when a local database requires an explicit, user-approved reset."""


def initialize_local_database(
    root: Path,
    database_path: Path,
    retired_database_path: Path,
    enterprise_id: str | None,
) -> None:
    root.mkdir(parents=True, exist_ok=True)
    if not database_path.exists() and retired_database_path.exists():
        reset_command = (
            f'npm run local-data -- clear --enterprise "{enterprise_id}" --yes'
            if enterprise_id
            else "npm run local-data -- clear --full-device --yes"
        )
        raise LocalDatabaseResetRequiredError(
            "The retired tanaw_metrics.sqlite3 database is still present. TANAW will not "
            f"silently replace local data. Close TANAW and run `{reset_command}`, then "
            "reopen the application."
        )
    database_exists = database_path.exists()
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("pragma foreign_keys = on")
        connection.execute("pragma journal_mode = wal")
        connection.execute("pragma synchronous = normal")
        connection.execute("pragma busy_timeout = 5000")
        existing_tables = {
            str(row["name"])
            for row in connection.execute("select name from sqlite_master where type = 'table'")
        }
        if database_exists and existing_tables and "schema_metadata" not in existing_tables:
            raise LocalDatabaseResetRequiredError(
                "The local TANAW database uses the retired pre-versioned schema. "
                "Close TANAW and run `npm run local-data -- clear --enterprise "
                "<enterprise-id> --yes`, then reopen the application."
            )
        current_version = 0
        if "schema_metadata" in existing_tables:
            version_row = connection.execute(
                "select schema_version from schema_metadata where singleton_id = 1"
            ).fetchone()
            current_version = _safe_int(
                version_row["schema_version"] if version_row is not None else None
            )
            if current_version in MIGRATABLE_SCHEMA_VERSIONS:
                _migrate_schema(connection, current_version)
                current_version = LOCAL_SCHEMA_VERSION
            if current_version != LOCAL_SCHEMA_VERSION:
                raise LocalDatabaseResetRequiredError(
                    f"Local TANAW database schema {current_version} is incompatible with "
                    f"the required schema {LOCAL_SCHEMA_VERSION}. Explicitly clear this "
                    "enterprise's local data before reopening TANAW."
                )

        connection.executescript(
            f"""
            create table if not exists schema_metadata (
                singleton_id integer primary key check (singleton_id = 1),
                schema_version integer not null,
                applied_at text not null
            );

            create table if not exists camera_profiles (
                camera_id integer primary key,
                name text not null,
                zone text not null,
                status text not null check (
                    status in ('untested', 'online', 'offline', 'running', 'stopped', 'error')
                ),
                camera_host text not null,
                rtsp_stream text not null check (rtsp_stream in ('stream1', 'stream2')),
                stream_url text not null,
                processing_profile text not null check (
                    processing_profile in (
                        'auto', 'compatibility', 'balanced', 'high_accuracy', 'emergency'
                    )
                ),
                tracking_confidence real,
                counting_confidence real not null,
                reid_mode text check (reid_mode in ('auto', 'off', 'fast', 'quality')),
                unique_counting_mode text check (
                    unique_counting_mode in ('entry_only', 'estimated_reid')
                ),
                config_json text not null,
                payload_json text not null,
                created_at text not null,
                updated_at text not null
            );

            create table if not exists active_monitoring_state (
                singleton_id integer primary key check (singleton_id = 1),
                camera_id integer,
                camera_name_snapshot text,
                running integer not null default 0 check (running in (0, 1)),
                status text not null,
                error text,
                started_at text,
                entry_count integer not null default 0,
                exit_count integer not null default 0,
                occupancy_count integer not null default 0,
                camera_config_json text not null,
                updated_at text not null
            );

            create table if not exists camera_monitoring_states (
                camera_id integer primary key,
                camera_name_snapshot text,
                running integer not null default 0 check (running in (0, 1)),
                status text not null,
                error text,
                started_at text,
                entry_count integer not null default 0,
                exit_count integer not null default 0,
                occupancy_count integer not null default 0,
                camera_config_json text not null,
                updated_at text not null
            );

            create table if not exists enterprise_occupancy_state (
                singleton_id integer primary key check (singleton_id = 1),
                current_occupancy integer not null default 0 check (current_occupancy >= 0),
                peak_occupancy integer not null default 0 check (peak_occupancy >= 0),
                updated_at text not null
            );

            insert or ignore into schema_metadata (
                singleton_id, schema_version, applied_at
            ) values (
                1, {LOCAL_SCHEMA_VERSION}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            );

            create table if not exists count_events (
                id integer primary key autoincrement,
                event_id text not null unique,
                recorded_at text not null,
                enterprise_id text,
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
                enterprise_occupancy_count integer,
                payload_json text not null,
                submitted_report_id text,
                synced_at text,
                constraint fk_count_events_report_submission
                    foreign key (submitted_report_id)
                    references report_submissions(report_id)
                    on update cascade on delete set null
            );

            create index if not exists idx_count_events_recorded_at on count_events(recorded_at);
            create index if not exists idx_count_events_camera_recorded_at
                on count_events(camera_id, recorded_at);
            create index if not exists idx_count_events_submitted_report_id on count_events(submitted_report_id);
            create index if not exists idx_count_events_synced_at on count_events(synced_at);

            create table if not exists count_snapshots (
                id integer primary key autoincrement,
                recorded_at text not null,
                enterprise_id text,
                camera_id integer,
                camera_name text,
                entry_count integer not null default 0,
                exit_count integer not null default 0,
                occupancy_count integer not null default 0,
                running integer not null default 0,
                status text,
                error text,
                payload_json text not null
            );

            create index if not exists idx_count_snapshots_recorded_at on count_snapshots(recorded_at);
            create index if not exists idx_count_snapshots_camera_recorded_at
                on count_snapshots(camera_id, recorded_at);

            create table if not exists report_submissions (
                report_id text primary key,
                period text not null unique,
                submitted_at text not null,
                entries integer not null default 0,
                exits integer not null default 0,
                peak_occupancy integer not null default 0,
                unique_count integer not null default 0,
                notes text,
                payload_json text not null,
                sync_status text not null default 'pending_cloud_sync',
                synced_at text,
                raw_purged_at text
            );

            create table if not exists report_drafts (
                draft_key text primary key,
                period text not null,
                report_id text,
                payload_json text not null,
                updated_at text not null
            );

            create table if not exists report_camera_totals (
                report_id text not null,
                camera_id integer,
                camera_name text,
                entries integer not null default 0,
                exits integer not null default 0,
                peak_occupancy integer not null default 0,
                unique_count integer not null default 0,
                primary key (report_id, camera_id),
                constraint fk_report_camera_totals_submission
                    foreign key (report_id)
                    references report_submissions(report_id)
                    on update cascade on delete cascade
            );

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
                recorded_at text not null,
                payload_json text not null
            );

            create index if not exists idx_occupancy_corrections_recorded_at
                on occupancy_corrections(recorded_at);
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
                expires_at text not null,
                identity_status text not null default 'confirmed' check (
                    identity_status in ('confirmed', 'provisional', 'merged')
                ),
                canonical_visitor_id text
            );

            create index if not exists idx_visitor_identities_business_date on visitor_identities(business_date);
            create index if not exists idx_visitor_identities_expires_at on visitor_identities(expires_at);
            create index if not exists idx_visitor_identities_status on visitor_identities(identity_status);

            create table if not exists visitor_identity_prototypes (
                visitor_id text not null,
                model_name text not null,
                prototype_index integer not null check (prototype_index >= 0),
                representative_embedding blob not null,
                embedding_dim integer not null,
                embedding_count integer not null default 1,
                updated_at text not null,
                primary key (visitor_id, model_name, prototype_index),
                constraint fk_visitor_identity_prototypes_identity
                    foreign key (visitor_id)
                    references visitor_identities(visitor_id)
                    on update cascade on delete cascade
            );

            create index if not exists idx_visitor_identity_prototypes_model
                on visitor_identity_prototypes(model_name);

            create table if not exists visitor_model_embeddings (
                visitor_id text not null,
                model_name text not null,
                representative_embedding blob not null,
                embedding_dim integer not null,
                embedding_count integer not null default 1,
                updated_at text not null,
                primary key (visitor_id, model_name),
                constraint fk_visitor_model_embeddings_identity
                    foreign key (visitor_id)
                    references visitor_identities(visitor_id)
                    on update cascade on delete cascade
            );

            create index if not exists idx_visitor_model_embeddings_model on visitor_model_embeddings(model_name);

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
                constraint fk_visitor_sightings_identity
                    foreign key (visitor_id)
                    references visitor_identities(visitor_id)
                    on update cascade on delete cascade
            );

            create index if not exists idx_visitor_sightings_business_date on visitor_sightings(business_date);
            """
        )
        connection.commit()
    finally:
        connection.close()


def _migrate_schema(connection: sqlite3.Connection, current_version: int) -> None:
    if current_version != 5:
        return

    identity_columns = {
        str(row["name"])
        for row in connection.execute("pragma table_info(visitor_identities)").fetchall()
    }
    if "identity_status" not in identity_columns:
        connection.execute(
            """
            alter table visitor_identities
                add column identity_status text not null default 'confirmed'
                check (identity_status in ('confirmed', 'provisional', 'merged'))
            """
        )
    if "canonical_visitor_id" not in identity_columns:
        connection.execute("alter table visitor_identities add column canonical_visitor_id text")

    existing_tables = {
        str(row["name"])
        for row in connection.execute("select name from sqlite_master where type = 'table'")
    }
    if "visitor_sightings" in existing_tables:
        connection.execute(
            """
            update visitor_identities
            set identity_status = 'provisional'
            where exists (
                select 1
                from visitor_sightings
                where visitor_sightings.visitor_id = visitor_identities.visitor_id
                    and visitor_sightings.reid_decision = 'ambiguous_new'
            )
                and not exists (
                    select 1
                    from visitor_sightings
                    where visitor_sightings.visitor_id = visitor_identities.visitor_id
                        and visitor_sightings.reid_decision = 'provisional_confirmed'
                )
            """
        )
    if "count_events" in existing_tables:
        ambiguous_events = connection.execute(
            """
            select id, payload_json
            from count_events
            where submitted_report_id is null
                and direction = 'entry'
                and reid_decision = 'ambiguous_new'
                and coalesce(identity_confidence, 'low') = 'low'
            """
        ).fetchall()
        for event in ambiguous_events:
            payload = _load_json_object(event["payload_json"])
            payload["is_unique_entry"] = False
            connection.execute(
                """
                update count_events
                set is_unique_entry = 0,
                    payload_json = ?,
                    synced_at = null
                where id = ?
                """,
                (json.dumps(payload, sort_keys=True), event["id"]),
            )

    connection.executescript(
        """
        create index if not exists idx_visitor_identities_status
            on visitor_identities(identity_status);

        create table if not exists visitor_identity_prototypes (
            visitor_id text not null,
            model_name text not null,
            prototype_index integer not null check (prototype_index >= 0),
            representative_embedding blob not null,
            embedding_dim integer not null,
            embedding_count integer not null default 1,
            updated_at text not null,
            primary key (visitor_id, model_name, prototype_index),
            constraint fk_visitor_identity_prototypes_identity
                foreign key (visitor_id)
                references visitor_identities(visitor_id)
                on update cascade on delete cascade
        );

        create index if not exists idx_visitor_identity_prototypes_model
            on visitor_identity_prototypes(model_name);

        insert or ignore into visitor_identity_prototypes (
            visitor_id,
            model_name,
            prototype_index,
            representative_embedding,
            embedding_dim,
            embedding_count,
            updated_at
        )
        select
            visitor_id,
            model_name,
            0,
            representative_embedding,
            embedding_dim,
            embedding_count,
            last_seen_at
        from visitor_identities;

        update schema_metadata
        set schema_version = 6,
            applied_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where singleton_id = 1;
        """
    )
    connection.commit()
