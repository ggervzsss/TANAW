"""Canonical open-space tables included in the preproduction 001 baseline."""

OPEN_SPACE_SCHEMA = (
    """create table camera_analysis_revisions (
        revision_id text primary key, camera_id integer not null, camera_name text not null,
        zone_name text not null, config_json text not null, created_at text not null)""",
    """create table analysis_runs (
        run_id text primary key, revision_id text not null references camera_analysis_revisions,
        camera_id integer not null, started_at text not null, last_checkpoint_at text not null,
        ended_at text, termination_reason text, available integer not null default 0)""",
    """create table area_visits (
        visit_id text primary key, run_id text not null references analysis_runs,
        revision_id text not null references camera_analysis_revisions,
        camera_id integer not null, status text not null
            check(status in ('active','completed','incomplete','excluded')),
        first_inside_at text not null, ended_at text, qualified integer not null,
        estimated_dwell_ms integer not null check(estimated_dwell_ms >= 0),
        payload_json text not null)""",
    "create index idx_area_visits_camera_time on area_visits(camera_id, first_inside_at)",
    "create index idx_area_visits_query on area_visits(camera_id,revision_id,coalesce(ended_at,first_inside_at))",
    "create index idx_area_visits_run_status on area_visits(run_id, status)",
    """create table area_presence_intervals (
        interval_id integer primary key, run_id text not null references analysis_runs,
        revision_id text not null, camera_id integer not null,
        start_at text not null, end_at text not null,
        presence integer not null check(presence >= 0), missing integer not null,
        unique(run_id, start_at))""",
    "create index idx_area_presence_time on area_presence_intervals(camera_id,revision_id,end_at)",
    """create table area_hourly_rollups (
        revision_id text not null, camera_id integer not null, bucket text not null,
        completed_count integer not null default 0, incomplete_count integer not null default 0,
        duration_sum_ms integer not null default 0, covered_ms integer not null default 0,
        peak_presence integer not null default 0, buckets_json text not null default '[0,0,0,0,0]',
        primary key(revision_id, bucket))""",
)
