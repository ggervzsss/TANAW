import json
import sqlite3
from urllib.parse import urlsplit

from app.storage.local_data_serialization import _load_json_object, _safe_int, _utc_now

LATEST_LOCAL_SCHEMA_VERSION = 7
OLDEST_SUPPORTED_SCHEMA_VERSION = 1


def migrate_local_database(
    connection: sqlite3.Connection,
    current_version: int,
    target_version: int = LATEST_LOCAL_SCHEMA_VERSION,
) -> int:
    """Apply every known local-data migration without skipping intermediate versions."""
    if current_version < OLDEST_SUPPORTED_SCHEMA_VERSION or current_version > target_version:
        raise ValueError(f"Unsupported local database schema version {current_version}.")

    migrations = {
        1: _migrate_v1_to_v2,
        2: _migrate_v2_to_v3,
        3: _migrate_v3_to_v4,
        4: _migrate_v4_to_v5,
        5: _migrate_v5_to_v6,
        6: _migrate_v6_to_v7,
    }
    version = current_version
    while version < target_version:
        migration = migrations.get(version)
        if migration is None:
            raise ValueError(f"No local database migration is registered for schema {version}.")
        connection.execute("begin immediate")
        try:
            migration(connection)
            version += 1
            _record_version(connection, version)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return version


def _migrate_v1_to_v2(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
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
        )
        """
    )
    if _table_exists(connection, "active_monitoring_state"):
        connection.execute(
            """
            insert or ignore into camera_monitoring_states (
                camera_id, camera_name_snapshot, running, status, error, started_at,
                entry_count, exit_count, occupancy_count, camera_config_json, updated_at
            )
            select
                camera_id, camera_name_snapshot, running, status, error, started_at,
                entry_count, exit_count, occupancy_count, camera_config_json, updated_at
            from active_monitoring_state
            where singleton_id = 1 and camera_id is not null
            """
        )


def _migrate_v2_to_v3(connection: sqlite3.Connection) -> None:
    _add_column_if_missing(connection, "camera_profiles", "camera_host", "camera_host text")
    _add_column_if_missing(
        connection,
        "camera_profiles",
        "rtsp_stream",
        "rtsp_stream text check (rtsp_stream in ('stream1', 'stream2'))",
    )
    for row in connection.execute(
        "select camera_id, stream_url, payload_json, camera_host, rtsp_stream from camera_profiles"
    ).fetchall():
        payload = _load_json_object(row["payload_json"])
        parsed = urlsplit(str(row["stream_url"] or ""))
        camera_host = row["camera_host"] or payload.get("cameraHost") or parsed.hostname
        rtsp_stream = row["rtsp_stream"] or payload.get("rtspStream")
        if rtsp_stream not in {"stream1", "stream2"}:
            path = parsed.path.rstrip("/").lower()
            rtsp_stream = path.rsplit("/", maxsplit=1)[-1]
        if camera_host and rtsp_stream in {"stream1", "stream2"}:
            payload["cameraHost"] = str(camera_host)
            payload["rtspStream"] = rtsp_stream
            connection.execute(
                """update camera_profiles
                   set camera_host = ?, rtsp_stream = ?, payload_json = ?
                   where camera_id = ?""",
                (
                    str(camera_host),
                    rtsp_stream,
                    json.dumps(payload, sort_keys=True),
                    row["camera_id"],
                ),
            )
    _add_column_if_missing(connection, "count_events", "enterprise_id", "enterprise_id text")
    _add_column_if_missing(
        connection,
        "count_events",
        "enterprise_occupancy_count",
        "enterprise_occupancy_count integer",
    )
    if _table_exists(connection, "count_snapshots"):
        _add_column_if_missing(connection, "count_snapshots", "enterprise_id", "enterprise_id text")
    connection.execute(
        """
        create table if not exists enterprise_occupancy_state (
            singleton_id integer primary key check (singleton_id = 1),
            current_occupancy integer not null default 0 check (current_occupancy >= 0),
            peak_occupancy integer not null default 0 check (peak_occupancy >= 0),
            updated_at text not null
        )
        """
    )
    event_state = (
        connection.execute(
            """select coalesce(
                       sum(case when direction = 'entry' then 1 else -1 end), 0
                   ) from count_events"""
        ).fetchone()
        if _table_exists(connection, "count_events")
        else None
    )
    current_occupancy = max(0, _safe_int(event_state[0] if event_state else None))
    connection.execute(
        """
        insert or ignore into enterprise_occupancy_state (
            singleton_id, current_occupancy, peak_occupancy, updated_at
        ) values (1, ?, ?, ?)
        """,
        (current_occupancy, current_occupancy, _utc_now()),
    )


def _migrate_v3_to_v4(_connection: sqlite3.Connection) -> None:
    # Version four retired non-RTSP runtime support. The following migration
    # rebuilds the profile table and retains every canonical RTSP profile.
    return


def _migrate_v4_to_v5(connection: sqlite3.Connection) -> None:
    if not _table_exists(connection, "camera_profiles"):
        return
    connection.execute("drop table if exists camera_profiles_v5")
    connection.execute(
        """
        create table camera_profiles_v5 (
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
        )
        """
    )
    connection.execute(
        """
        insert into camera_profiles_v5 (
            camera_id, name, zone, status, camera_host, rtsp_stream, stream_url,
            processing_profile, tracking_confidence, counting_confidence, reid_mode,
            unique_counting_mode, config_json, payload_json, created_at, updated_at
        )
        select
            camera_id, name, zone,
            case
                when status in ('starting', 'connecting', 'degraded', 'reconnecting') then 'running'
                when status = 'failed' then 'error'
                else status
            end,
            camera_host, rtsp_stream, stream_url, processing_profile,
            tracking_confidence, counting_confidence, reid_mode, unique_counting_mode,
            config_json, payload_json, created_at, updated_at
        from camera_profiles
        where camera_host is not null
            and trim(camera_host) != ''
            and rtsp_stream in ('stream1', 'stream2')
        """
    )
    connection.execute("drop table camera_profiles")
    connection.execute("alter table camera_profiles_v5 rename to camera_profiles")


def _migrate_v5_to_v6(connection: sqlite3.Connection) -> None:
    if not _table_exists(connection, "visitor_identities"):
        return
    _add_column_if_missing(
        connection,
        "visitor_identities",
        "identity_status",
        "identity_status text not null default 'confirmed' check (identity_status in ('confirmed', 'provisional', 'merged'))",
    )
    _add_column_if_missing(
        connection, "visitor_identities", "canonical_visitor_id", "canonical_visitor_id text"
    )

    if _table_exists(connection, "visitor_sightings"):
        connection.execute(
            """
            update visitor_identities
            set identity_status = 'provisional'
            where exists (
                select 1 from visitor_sightings
                where visitor_sightings.visitor_id = visitor_identities.visitor_id
                    and visitor_sightings.reid_decision = 'ambiguous_new'
            )
                and not exists (
                    select 1 from visitor_sightings
                    where visitor_sightings.visitor_id = visitor_identities.visitor_id
                        and visitor_sightings.reid_decision = 'provisional_confirmed'
                )
            """
        )
    if _table_exists(connection, "count_events"):
        ambiguous_events = connection.execute(
            """
            select id, payload_json from count_events
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
                set is_unique_entry = 0, payload_json = ?, synced_at = null
                where id = ?
                """,
                (json.dumps(payload, sort_keys=True), event["id"]),
            )

    connection.execute(
        "create index if not exists idx_visitor_identities_status "
        "on visitor_identities(identity_status)"
    )
    connection.execute(
        """create table if not exists visitor_identity_prototypes (
            visitor_id text not null,
            model_name text not null,
            prototype_index integer not null check (prototype_index >= 0),
            representative_embedding blob not null,
            embedding_dim integer not null,
            embedding_count integer not null default 1,
            updated_at text not null,
            primary key (visitor_id, model_name, prototype_index),
            constraint fk_visitor_identity_prototypes_identity
                foreign key (visitor_id) references visitor_identities(visitor_id)
                on update cascade on delete cascade
        )"""
    )
    connection.execute(
        "create index if not exists idx_visitor_identity_prototypes_model "
        "on visitor_identity_prototypes(model_name)"
    )
    connection.execute(
        """insert or ignore into visitor_identity_prototypes (
            visitor_id, model_name, prototype_index, representative_embedding,
            embedding_dim, embedding_count, updated_at
        )
        select visitor_id, model_name, 0, representative_embedding,
               embedding_dim, embedding_count, last_seen_at
        from visitor_identities"""
    )


def _migrate_v6_to_v7(connection: sqlite3.Connection) -> None:
    connection.execute("drop table if exists active_monitoring_state")
    connection.execute("drop table if exists count_snapshots")


def _record_version(connection: sqlite3.Connection, version: int) -> None:
    connection.execute(
        """
        update schema_metadata
        set schema_version = ?, applied_at = ?
        where singleton_id = 1
        """,
        (version, _utc_now()),
    )


def _add_column_if_missing(
    connection: sqlite3.Connection, table: str, column: str, definition: str
) -> None:
    if not _table_exists(connection, table):
        return
    columns = {
        str(row["name"]) for row in connection.execute(f'pragma table_info("{table}")').fetchall()
    }
    if column not in columns:
        connection.execute(f'alter table "{table}" add column {definition}')


def _table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return (
        connection.execute(
            "select 1 from sqlite_master where type = 'table' and name = ?", (table,)
        ).fetchone()
        is not None
    )
