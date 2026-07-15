"""Replace ambiguous topology, mutable location, dev delivery, and JSON settings storage.

Revision ID: 20260715_0040
Revises: 20260715_0038
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260715_0040"
down_revision: str | Sequence[str] | None = "20260715_0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    _require_no_camera_metric_grain(connection)
    _require_valid_configuration_json(connection)

    _replace_device_ambiguity()
    _replace_mutable_site_location()
    _bound_report_fact_identity()
    _replace_configuration_storage()
    _remove_duplicate_dev_delivery()
    _replace_live_state_guard()


def _replace_device_ambiguity() -> None:
    op.add_column(
        "edge_devices",
        sa.Column("device_role", sa.String(length=30), nullable=True),
    )
    op.execute("UPDATE edge_devices SET device_role = 'camera_node'")
    op.execute(
        """
        WITH selected AS (
            SELECT DISTINCT ON (device.site_id, device.classification) device.id
            FROM edge_devices AS device
            LEFT JOIN site_live_state AS live
              ON live.site_id = device.site_id
             AND live.classification = device.classification
             AND live.edge_device_id = device.id
            WHERE device.lifecycle_state = 'active'
            ORDER BY device.site_id, device.classification,
                     (live.edge_device_id IS NOT NULL) DESC,
                     device.created_at ASC, device.id ASC
        )
        UPDATE edge_devices AS device
        SET device_role = 'telemetry_aggregator'
        FROM selected
        WHERE device.id = selected.id
        """
    )
    op.alter_column("edge_devices", "device_role", nullable=False)
    op.create_check_constraint(
        "ck_edge_devices_device_role",
        "edge_devices",
        "device_role IN ('telemetry_aggregator', 'camera_node')",
    )
    op.create_index(
        "uq_edge_devices_active_aggregator_site",
        "edge_devices",
        ["site_id"],
        unique=True,
        postgresql_where=sa.text(
            "lifecycle_state = 'active' AND device_role = 'telemetry_aggregator'"
        ),
    )


def _replace_mutable_site_location() -> None:
    op.create_table(
        "site_location_versions",
        sa.Column("id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("site_id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("classification", sa.String(length=20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("barangay", sa.String(length=120), nullable=True),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("timezone_name", sa.String(length=64), nullable=False),
        sa.Column("building_capacity", sa.Integer(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("location_source", sa.String(length=40), nullable=True),
        sa.Column("location_confidence", sa.Float(), nullable=True),
        sa.Column("geocoded_address", sa.String(length=500), nullable=True),
        sa.Column("coordinates_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("change_reason", sa.String(length=80), nullable=False),
        sa.Column(
            "effective_from",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "classification IN ('official', 'simulation')",
            name="ck_site_location_versions_classification",
        ),
        sa.CheckConstraint("version >= 1", name="ck_site_location_versions_version"),
        sa.CheckConstraint(
            "building_capacity BETWEEN 1 AND 100000",
            name="ck_site_location_versions_building_capacity",
        ),
        sa.CheckConstraint(
            "timezone_name = 'Asia/Manila'",
            name="ck_site_location_versions_timezone",
        ),
        sa.CheckConstraint(
            "((latitude IS NULL AND longitude IS NULL) OR "
            "(latitude IS NOT NULL AND longitude IS NOT NULL AND "
            "latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))",
            name="ck_site_location_versions_coordinates",
        ),
        sa.CheckConstraint(
            "location_confidence IS NULL OR "
            "(latitude IS NOT NULL AND location_confidence BETWEEN 0 AND 1)",
            name="ck_site_location_versions_confidence",
        ),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_site_location_versions_effective_range",
        ),
        sa.ForeignKeyConstraint(
            ["site_id", "classification"],
            ["enterprise_sites.id", "enterprise_sites.classification"],
            name="fk_site_location_versions_site_classification",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "version", name="uq_site_location_versions_site_version"),
    )
    op.execute(
        """
        INSERT INTO site_location_versions (
            id, site_id, classification, version, barangay, address,
            timezone_name, building_capacity, latitude, longitude,
            location_source, location_confidence, geocoded_address,
            coordinates_confirmed_at, change_reason, effective_from
        )
        SELECT gen_random_uuid(), id, classification, location_version,
               barangay, address, timezone_name, building_capacity,
               latitude, longitude, location_source, location_confidence,
               geocoded_address, coordinates_updated_at,
               'target_cutover_snapshot', effective_from
        FROM enterprise_sites
        """
    )
    op.create_index(
        "uq_site_location_versions_current_site",
        "site_location_versions",
        ["site_id"],
        unique=True,
        postgresql_where=sa.text("effective_to IS NULL"),
    )
    op.create_index(
        "ix_site_location_versions_site_effective",
        "site_location_versions",
        ["site_id", "effective_from"],
    )
    op.create_index("ix_site_location_versions_barangay", "site_location_versions", ["barangay"])
    op.execute(
        """
        CREATE FUNCTION tanaw_guard_site_location_version()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Site location history cannot be deleted';
            END IF;
            IF TG_OP = 'UPDATE' THEN
                IF OLD.effective_to IS NOT NULL
                   OR NEW.effective_to IS NULL
                   OR NEW.effective_to <= OLD.effective_from
                   OR NEW.id IS DISTINCT FROM OLD.id
                   OR NEW.site_id IS DISTINCT FROM OLD.site_id
                   OR NEW.classification IS DISTINCT FROM OLD.classification
                   OR NEW.version IS DISTINCT FROM OLD.version
                   OR NEW.barangay IS DISTINCT FROM OLD.barangay
                   OR NEW.address IS DISTINCT FROM OLD.address
                   OR NEW.timezone_name IS DISTINCT FROM OLD.timezone_name
                   OR NEW.building_capacity IS DISTINCT FROM OLD.building_capacity
                   OR NEW.latitude IS DISTINCT FROM OLD.latitude
                   OR NEW.longitude IS DISTINCT FROM OLD.longitude
                   OR NEW.location_source IS DISTINCT FROM OLD.location_source
                   OR NEW.location_confidence IS DISTINCT FROM OLD.location_confidence
                   OR NEW.geocoded_address IS DISTINCT FROM OLD.geocoded_address
                   OR NEW.coordinates_confirmed_at IS DISTINCT FROM OLD.coordinates_confirmed_at
                   OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
                   OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
                   OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                    RAISE EXCEPTION 'Site location versions are immutable except for one closure';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_site_location_versions_immutable
        BEFORE UPDATE OR DELETE ON site_location_versions
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_site_location_version()
        """
    )

    op.drop_constraint("uq_enterprise_sites_code_version", "enterprise_sites", type_="unique")
    op.create_unique_constraint(
        "uq_enterprise_sites_code", "enterprise_sites", ["enterprise_id", "site_code"]
    )
    op.drop_index("uq_enterprise_sites_active_code", table_name="enterprise_sites")
    op.drop_index("ix_enterprise_sites_enterprise_effective", table_name="enterprise_sites")
    op.drop_index("ix_enterprise_sites_barangay", table_name="enterprise_sites")
    op.drop_constraint("ck_enterprise_sites_building_capacity", "enterprise_sites", type_="check")
    op.drop_constraint("ck_enterprise_sites_timezone", "enterprise_sites", type_="check")
    op.drop_constraint("ck_enterprise_sites_location_confidence", "enterprise_sites", type_="check")
    op.drop_constraint("ck_enterprise_sites_coordinates", "enterprise_sites", type_="check")
    op.drop_constraint("ck_enterprise_sites_location_version", "enterprise_sites", type_="check")
    for column in (
        "latitude",
        "longitude",
        "location_source",
        "location_confidence",
        "geocoded_address",
        "coordinates_updated_at",
        "location_version",
        "barangay",
        "address",
        "timezone_name",
        "building_capacity",
    ):
        op.drop_column("enterprise_sites", column)
    op.alter_column("enterprise_sites", "effective_from", new_column_name="registered_at")
    op.alter_column("enterprise_sites", "effective_to", new_column_name="retired_at")
    op.create_index(
        "ix_enterprise_sites_enterprise_retired",
        "enterprise_sites",
        ["enterprise_id", "retired_at"],
    )


def _bound_report_fact_identity() -> None:
    op.drop_constraint("ck_report_metric_facts_grain", "report_metric_facts", type_="check")
    op.create_check_constraint(
        "ck_report_metric_facts_grain",
        "report_metric_facts",
        "grain IN ('site', 'enterprise')",
    )
    for column in (
        "event_count",
        "event_sequence_start",
        "event_sequence_end_exclusive",
    ):
        op.alter_column(
            "report_source_batches",
            column,
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
        )


def _replace_configuration_storage() -> None:
    op.create_table(
        "system_settings",
        sa.Column("id", sa.String(length=20), nullable=False),
        sa.Column("login_attempt_limit", sa.Integer(), server_default="3", nullable=False),
        sa.Column("login_lock_minutes", sa.Integer(), server_default="5", nullable=False),
        sa.Column("log_retention_days", sa.Integer(), server_default="180", nullable=False),
        sa.Column(
            "camera_session_error_alerts", sa.Boolean(), server_default=sa.true(), nullable=False
        ),
        sa.Column(
            "gateway_service_error_alerts", sa.Boolean(), server_default=sa.true(), nullable=False
        ),
        sa.Column("sync_delay_alerts", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "failed_login_lockout_alerts", sa.Boolean(), server_default=sa.true(), nullable=False
        ),
        sa.Column("updated_by_account_id", sa.Uuid(as_uuid=False), nullable=True),
        sa.Column("updated_by_name", sa.String(length=120), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("id = 'default'", name="ck_system_settings_singleton"),
        sa.CheckConstraint(
            "login_attempt_limit IN (3, 5, 10)",
            name="ck_system_settings_login_attempt_limit",
        ),
        sa.CheckConstraint(
            "login_lock_minutes IN (5, 15, 30, 60)",
            name="ck_system_settings_login_lock_minutes",
        ),
        sa.CheckConstraint(
            "log_retention_days IN (90, 180, 365)",
            name="ck_system_settings_log_retention_days",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_account_id"],
            ["accounts.id"],
            name="fk_system_settings_updated_by_account",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        """
        INSERT INTO system_settings (
            id, login_attempt_limit, login_lock_minutes, log_retention_days,
            camera_session_error_alerts, gateway_service_error_alerts,
            sync_delay_alerts, failed_login_lockout_alerts,
            updated_by_account_id, updated_by_name, updated_at
        )
        SELECT 'default',
               CASE WHEN values_json::jsonb->>'security.loginAttemptLimit' IN ('3','5','10')
                    THEN (values_json::jsonb->>'security.loginAttemptLimit')::integer ELSE 3 END,
               CASE WHEN values_json::jsonb->>'security.loginLockMinutes' IN ('5','15','30','60')
                    THEN (values_json::jsonb->>'security.loginLockMinutes')::integer ELSE 5 END,
               CASE WHEN values_json::jsonb->>'logs.retentionDays' IN ('90','180','365')
                    THEN (values_json::jsonb->>'logs.retentionDays')::integer ELSE 180 END,
               CASE WHEN jsonb_typeof(values_json::jsonb->'notifications.cameraSessionErrorAlerts') = 'boolean'
                    THEN (values_json::jsonb->>'notifications.cameraSessionErrorAlerts')::boolean ELSE true END,
               CASE WHEN jsonb_typeof(values_json::jsonb->'notifications.gatewayServiceErrorAlerts') = 'boolean'
                    THEN (values_json::jsonb->>'notifications.gatewayServiceErrorAlerts')::boolean ELSE true END,
               CASE WHEN jsonb_typeof(values_json::jsonb->'notifications.syncDelayAlerts') = 'boolean'
                    THEN (values_json::jsonb->>'notifications.syncDelayAlerts')::boolean ELSE true END,
               CASE WHEN jsonb_typeof(values_json::jsonb->'notifications.failedLoginLockoutAlerts') = 'boolean'
                    THEN (values_json::jsonb->>'notifications.failedLoginLockoutAlerts')::boolean ELSE true END,
               NULL, updated_by, updated_at
        FROM system_configuration WHERE id = 'default'
        ON CONFLICT (id) DO NOTHING
        """
    )
    op.execute("INSERT INTO system_settings (id) VALUES ('default') ON CONFLICT DO NOTHING")

    op.create_table(
        "seed_states",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("initialized_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("account_count", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        """
        INSERT INTO seed_states (id, initialized_at, account_count)
        SELECT id, updated_at,
               CASE WHEN jsonb_typeof(values_json::jsonb->'accountIds') = 'array'
                    THEN jsonb_array_length(values_json::jsonb->'accountIds') ELSE 0 END
        FROM system_configuration
        WHERE id IN ('startup-bootstrap-v1', 'startup-development-v1')
        """
    )
    op.drop_table("system_configuration")


def _remove_duplicate_dev_delivery() -> None:
    op.drop_table("dev_deliveries")
    op.execute("DROP TYPE IF EXISTS delivery_status")


def _replace_live_state_guard() -> None:
    op.execute("DROP TRIGGER trg_site_live_state_monotonic ON site_live_state")
    op.execute("DROP FUNCTION tanaw_guard_site_live_state_monotonic()")
    op.execute(
        """
        CREATE FUNCTION tanaw_guard_site_live_state_monotonic()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            old_freshness_rank INTEGER;
            new_freshness_rank INTEGER;
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Site live state cannot be deleted';
            END IF;
            IF TG_OP = 'INSERT' THEN
                IF NEW.live_state_version != 1 OR NEW.freshness_state != 'fresh' THEN
                    RAISE EXCEPTION 'Initial site live state must be fresh version 1';
                END IF;
                RETURN NEW;
            END IF;
            IF NEW.live_state_version != OLD.live_state_version + 1 THEN
                RAISE EXCEPTION 'Live-state version must increment exactly once';
            END IF;
            IF NEW.site_id IS DISTINCT FROM OLD.site_id
               OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
               OR NEW.classification IS DISTINCT FROM OLD.classification THEN
                RAISE EXCEPTION 'Live-state topology identity cannot change';
            END IF;

            IF NEW.edge_device_id IS DISTINCT FROM OLD.edge_device_id THEN
                IF NEW.received_at < OLD.received_at OR NEW.freshness_state != 'fresh' THEN
                    RAISE EXCEPTION 'Replacement aggregator evidence must be later and fresh';
                END IF;
                RETURN NEW;
            END IF;

            IF (NEW.epoch_generation, NEW.sequence) < (OLD.epoch_generation, OLD.sequence) THEN
                RAISE EXCEPTION 'Older telemetry cannot replace current site state';
            END IF;
            IF (NEW.epoch_generation, NEW.sequence) > (OLD.epoch_generation, OLD.sequence) THEN
                IF NEW.received_at < OLD.received_at OR NEW.freshness_state != 'fresh' THEN
                    RAISE EXCEPTION 'Newer telemetry must be received later and become fresh';
                END IF;
                RETURN NEW;
            END IF;
            IF NEW.telemetry_epoch_id IS DISTINCT FROM OLD.telemetry_epoch_id
               OR NEW.telemetry_observation_id IS DISTINCT FROM OLD.telemetry_observation_id
               OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
               OR NEW.received_at IS DISTINCT FROM OLD.received_at
               OR NEW.freshness_expires_at IS DISTINCT FROM OLD.freshness_expires_at
               OR NEW.offline_after_at IS DISTINCT FROM OLD.offline_after_at
               OR NEW.metric_window_start IS DISTINCT FROM OLD.metric_window_start
               OR NEW.metric_window_end IS DISTINCT FROM OLD.metric_window_end
               OR NEW.metric_provenance IS DISTINCT FROM OLD.metric_provenance
               OR NEW.coverage_evidence_status IS DISTINCT FROM OLD.coverage_evidence_status
               OR NEW.monitored_seconds IS DISTINCT FROM OLD.monitored_seconds
               OR NEW.expected_seconds IS DISTINCT FROM OLD.expected_seconds
               OR NEW.coverage_gap_count IS DISTINCT FROM OLD.coverage_gap_count
               OR NEW.service_state IS DISTINCT FROM OLD.service_state
               OR NEW.pending_count IS DISTINCT FROM OLD.pending_count
               OR NEW.oldest_pending_at IS DISTINCT FROM OLD.oldest_pending_at
               OR NEW.last_acknowledged_at IS DISTINCT FROM OLD.last_acknowledged_at
               OR NEW.last_failure_at IS DISTINCT FROM OLD.last_failure_at
               OR NEW.last_failure_class IS DISTINCT FROM OLD.last_failure_class THEN
                RAISE EXCEPTION 'Equal telemetry ordering may only advance freshness';
            END IF;
            old_freshness_rank := CASE OLD.freshness_state
                WHEN 'fresh' THEN 1 WHEN 'stale' THEN 2 ELSE 3 END;
            new_freshness_rank := CASE NEW.freshness_state
                WHEN 'fresh' THEN 1 WHEN 'stale' THEN 2 ELSE 3 END;
            IF NEW.last_freshness_evaluated_at < OLD.last_freshness_evaluated_at
               OR new_freshness_rank < old_freshness_rank THEN
                RAISE EXCEPTION 'Freshness may only age without newer telemetry';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_site_live_state_monotonic
        BEFORE INSERT OR UPDATE OR DELETE ON site_live_state
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_site_live_state_monotonic()
        """
    )


def _require_no_camera_metric_grain(connection: Connection) -> None:
    count = connection.execute(
        sa.text("SELECT count(*) FROM report_metric_facts WHERE grain = 'camera'")
    ).scalar_one()
    if count:
        raise RuntimeError(
            "Target cutover cannot infer an exact camera identity for existing camera-grain facts."
        )


def _require_valid_configuration_json(connection: Connection) -> None:
    for state_id, values_json in connection.execute(
        sa.text("SELECT id, values_json FROM system_configuration ORDER BY id")
    ):
        try:
            candidate = json.loads(values_json)
        except (TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"System configuration {state_id!r} contains invalid JSON.") from exc
        if not isinstance(candidate, dict):
            raise RuntimeError(f"System configuration {state_id!r} must contain a JSON object.")


def downgrade() -> None:
    raise RuntimeError(
        "The target-only central ERD cutover is irreversible; restore a verified backup instead."
    )
