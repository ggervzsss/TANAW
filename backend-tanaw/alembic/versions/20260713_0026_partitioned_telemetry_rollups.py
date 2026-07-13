"""Add bounded, partitioned hourly telemetry history.

Revision ID: 20260713_0026
Revises: 20260713_0025

The normalized observation/fact/health graph remains the only raw telemetry
store and is intentionally short-retention.  Long-lived history is represented
by site-grain hourly aggregates with explicit sample, quality, and coverage
evidence.  ``downsampled_at`` is the atomic processing marker that lets
multiple maintenance workers handle late arrivals exactly once before raw
deletion.  No shadow or compatibility telemetry table is introduced.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260713_0026"
down_revision: str | Sequence[str] | None = "20260713_0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    statements = (
        """
        ALTER TABLE telemetry_observations
        ADD COLUMN downsampled_at TIMESTAMP WITH TIME ZONE
        """,
        """
        ALTER TABLE telemetry_observations
        ADD CONSTRAINT ck_telemetry_observations_downsampled
        CHECK (downsampled_at IS NULL OR downsampled_at >= received_at)
        """,
        """
        DROP TRIGGER trg_telemetry_observations_append_only
        ON telemetry_observations
        """,
        """
        CREATE FUNCTION tanaw_guard_telemetry_observation_update()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.downsampled_at IS NULL
               AND NEW.downsampled_at IS NOT NULL
               AND (to_jsonb(OLD) - 'downsampled_at') =
                   (to_jsonb(NEW) - 'downsampled_at') THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION '% is append-only; updates are forbidden', TG_TABLE_NAME;
        END;
        $$
        """,
        """
        CREATE TRIGGER trg_telemetry_observations_append_only
        BEFORE UPDATE ON telemetry_observations
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_telemetry_observation_update()
        """,
        """
        CREATE INDEX ix_telemetry_observations_pending_downsample
        ON telemetry_observations (classification, received_at, id)
        WHERE downsampled_at IS NULL
        """,
        """
        CREATE FUNCTION tanaw_guard_telemetry_observation_delete()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.downsampled_at IS NULL THEN
                RAISE EXCEPTION 'Telemetry observation must be downsampled before deletion';
            END IF;
            IF EXISTS (
                SELECT 1 FROM telemetry_metric_facts
                WHERE telemetry_observation_id = OLD.id
            ) OR EXISTS (
                SELECT 1 FROM device_health_samples
                WHERE telemetry_observation_id = OLD.id
            ) THEN
                RAISE EXCEPTION 'Telemetry observation detail must expire before deletion';
            END IF;
            RETURN OLD;
        END;
        $$
        """,
        """
        CREATE TRIGGER trg_telemetry_observations_retention_delete
        BEFORE DELETE ON telemetry_observations
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_telemetry_observation_delete()
        """,
        """
        ALTER TABLE telemetry_metric_facts
        ADD COLUMN retention_expires_at TIMESTAMP WITH TIME ZONE
        """,
        """
        ALTER TABLE telemetry_metric_facts
        DISABLE TRIGGER trg_telemetry_metric_facts_append_only
        """,
        """
        UPDATE telemetry_metric_facts AS fact
        SET retention_expires_at = observation.retention_expires_at
        FROM telemetry_observations AS observation
        WHERE observation.id = fact.telemetry_observation_id
          AND observation.retention_expires_at IS NOT NULL
          AND fact.metric_window_end IS NOT NULL
          AND observation.retention_expires_at > fact.metric_window_end
        """,
        """
        ALTER TABLE telemetry_metric_facts
        ENABLE TRIGGER trg_telemetry_metric_facts_append_only
        """,
        """
        ALTER TABLE telemetry_metric_facts
        ADD CONSTRAINT ck_telemetry_metric_facts_retention
        CHECK (
            retention_expires_at IS NULL OR (
                metric_window_end IS NOT NULL AND retention_expires_at > metric_window_end
            )
        )
        """,
        """
        CREATE INDEX ix_telemetry_metric_facts_retention
        ON telemetry_metric_facts (retention_expires_at)
        """,
        """
        ALTER TABLE device_health_samples
        DROP CONSTRAINT fk_device_health_samples_observation_scope
        """,
        """
        ALTER TABLE device_health_samples
        ADD CONSTRAINT fk_device_health_samples_observation_scope
        FOREIGN KEY (telemetry_observation_id, edge_device_id, site_id, classification)
        REFERENCES telemetry_observations(id, edge_device_id, site_id, classification)
        ON DELETE CASCADE
        """,
        """
        CREATE TABLE site_telemetry_hourly_rollups (
            bucket_start TIMESTAMP WITH TIME ZONE NOT NULL,
            enterprise_id UUID NOT NULL,
            site_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            definition VARCHAR(120) NOT NULL,
            definition_version INTEGER NOT NULL,
            unit VARCHAR(60) NOT NULL,
            provenance VARCHAR(30) NOT NULL,
            bucket_end TIMESTAMP WITH TIME ZONE NOT NULL,
            sample_count BIGINT NOT NULL,
            known_sample_count BIGINT NOT NULL,
            unknown_sample_count BIGINT NOT NULL,
            value_sum NUMERIC(30, 6),
            value_min NUMERIC(20, 6),
            value_max NUMERIC(20, 6),
            last_value NUMERIC(20, 6),
            first_observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
            last_observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
            last_received_at TIMESTAMP WITH TIME ZONE NOT NULL,
            last_source_observation_id UUID NOT NULL,
            last_quality VARCHAR(20) NOT NULL,
            confirmed_sample_count BIGINT NOT NULL,
            degraded_sample_count BIGINT NOT NULL,
            estimated_sample_count BIGINT NOT NULL,
            unknown_quality_sample_count BIGINT NOT NULL,
            coverage_sample_count BIGINT NOT NULL,
            monitored_seconds_sum BIGINT NOT NULL,
            expected_seconds_sum BIGINT NOT NULL,
            coverage_gap_count_sum BIGINT NOT NULL,
            rollup_version BIGINT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT pk_site_telemetry_hourly_rollups PRIMARY KEY (
                bucket_start, enterprise_id, site_id, classification, definition,
                definition_version, unit, provenance
            ),
            CONSTRAINT fk_site_telemetry_hourly_rollups_site_scope
                FOREIGN KEY (site_id, enterprise_id, classification)
                REFERENCES enterprise_sites(id, enterprise_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT ck_site_telemetry_hourly_rollups_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_site_telemetry_hourly_rollups_identity CHECK (
                definition_version >= 1 AND length(trim(definition)) > 0
                AND length(trim(unit)) > 0
            ),
            CONSTRAINT ck_site_telemetry_hourly_rollups_provenance CHECK (
                provenance IN ('camera_derived', 'operator_entered', 'system_derived')
            ),
            CONSTRAINT ck_site_telemetry_hourly_rollups_window CHECK (
                (bucket_start AT TIME ZONE 'UTC') =
                    date_trunc('hour', bucket_start AT TIME ZONE 'UTC')
                AND (bucket_end AT TIME ZONE 'UTC') =
                    (bucket_start AT TIME ZONE 'UTC') + INTERVAL '1 hour'
                AND first_observed_at >= bucket_start AND first_observed_at < bucket_end
                AND last_observed_at >= first_observed_at AND last_observed_at < bucket_end
            ),
            CONSTRAINT ck_site_telemetry_hourly_rollups_samples CHECK (
                sample_count >= 1 AND known_sample_count >= 0 AND unknown_sample_count >= 0
                AND known_sample_count + unknown_sample_count = sample_count
            ),
            CONSTRAINT ck_site_telemetry_hourly_rollups_quality_counts CHECK (
                confirmed_sample_count >= 0 AND degraded_sample_count >= 0
                AND estimated_sample_count >= 0 AND unknown_quality_sample_count >= 0
                AND confirmed_sample_count + degraded_sample_count
                    + estimated_sample_count + unknown_quality_sample_count = sample_count
            ),
            CONSTRAINT ck_site_telemetry_hourly_rollups_values CHECK (
                (known_sample_count = 0 AND value_sum IS NULL AND value_min IS NULL
                    AND value_max IS NULL)
                OR (known_sample_count > 0 AND value_sum IS NOT NULL
                    AND value_min IS NOT NULL AND value_max IS NOT NULL
                    AND value_min <= value_max)
            ),
            CONSTRAINT ck_site_telemetry_hourly_rollups_last_quality CHECK (
                last_quality IN ('confirmed', 'degraded', 'estimated', 'unknown')
            ),
            CONSTRAINT ck_site_telemetry_hourly_rollups_last_value_quality CHECK (
                (last_quality = 'unknown' AND last_value IS NULL)
                OR (last_quality != 'unknown' AND last_value IS NOT NULL)
            ),
            CONSTRAINT ck_site_telemetry_hourly_rollups_coverage CHECK (
                coverage_sample_count >= 0 AND coverage_sample_count <= sample_count
                AND monitored_seconds_sum >= 0 AND expected_seconds_sum >= 0
                AND monitored_seconds_sum <= expected_seconds_sum
                AND coverage_gap_count_sum >= 0
            ),
            CONSTRAINT ck_site_telemetry_hourly_rollups_version CHECK (rollup_version >= 1)
        ) PARTITION BY RANGE (bucket_start)
        """,
        """
        CREATE TABLE site_telemetry_rollup_partitions (
            partition_name VARCHAR(80) PRIMARY KEY,
            range_start TIMESTAMP WITH TIME ZONE NOT NULL UNIQUE,
            range_end TIMESTAMP WITH TIME ZONE NOT NULL UNIQUE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_site_telemetry_rollup_partitions_name CHECK (
                partition_name ~ '^site_telemetry_hourly_rollups_[0-9]{6}$'
            ),
            CONSTRAINT ck_site_telemetry_rollup_partitions_utc_month CHECK (
                (range_start AT TIME ZONE 'UTC') =
                    date_trunc('month', range_start AT TIME ZONE 'UTC')
                AND (range_end AT TIME ZONE 'UTC') =
                    (range_start AT TIME ZONE 'UTC') + INTERVAL '1 month'
            )
        )
        """,
        """
        CREATE INDEX ix_site_telemetry_rollup_partitions_expiry
        ON site_telemetry_rollup_partitions (range_end, partition_name)
        """,
        """
        CREATE INDEX ix_site_telemetry_hourly_rollups_site_bucket
        ON site_telemetry_hourly_rollups (site_id, classification, bucket_start DESC)
        """,
        """
        CREATE INDEX ix_site_telemetry_hourly_rollups_enterprise_bucket
        ON site_telemetry_hourly_rollups (enterprise_id, classification, bucket_start DESC)
        """,
        """
        CREATE INDEX ix_site_telemetry_hourly_rollups_definition_bucket
        ON site_telemetry_hourly_rollups (definition, definition_version, bucket_start DESC)
        """,
        """
        DO $partition_setup$
        DECLARE
            month_start_utc TIMESTAMP WITHOUT TIME ZONE;
            month_end_utc TIMESTAMP WITHOUT TIME ZONE;
            month_start_bound TEXT;
            month_end_bound TEXT;
            partition_table_name TEXT;
            offset_month INTEGER;
        BEGIN
            FOR offset_month IN -1..1 LOOP
                month_start_utc := date_trunc(
                    'month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                ) + make_interval(months => offset_month);
                month_end_utc := month_start_utc + INTERVAL '1 month';
                month_start_bound := to_char(
                    month_start_utc, 'YYYY-MM-DD"T"HH24:MI:SS'
                ) || 'Z';
                month_end_bound := to_char(
                    month_end_utc, 'YYYY-MM-DD"T"HH24:MI:SS'
                ) || 'Z';
                partition_table_name := 'site_telemetry_hourly_rollups_'
                    || to_char(month_start_utc, 'YYYYMM');
                EXECUTE format(
                    'CREATE TABLE IF NOT EXISTS %I PARTITION OF '
                    'site_telemetry_hourly_rollups FOR VALUES FROM (%L) TO (%L)',
                    partition_table_name,
                    month_start_bound,
                    month_end_bound
                );
                INSERT INTO site_telemetry_rollup_partitions (
                    partition_name, range_start, range_end
                ) VALUES (
                    partition_table_name,
                    month_start_utc AT TIME ZONE 'UTC',
                    month_end_utc AT TIME ZONE 'UTC'
                )
                ON CONFLICT (partition_name) DO NOTHING;
            END LOOP;
        END
        $partition_setup$
        """,
    )
    for statement in statements:
        op.execute(statement)


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260713_0026 is intentionally irreversible because dropping retained "
        "rollups or resetting exactly-once downsampling markers would destroy telemetry "
        "evidence. Restore the verified pre-cutover backup and matching application build instead."
    )
