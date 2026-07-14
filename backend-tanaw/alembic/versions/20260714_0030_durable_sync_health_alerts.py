"""Add normalized durable sync-health alert condition state.

Revision ID: 20260714_0030
Revises: 20260714_0029
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260714_0030"
down_revision: str | Sequence[str] | None = "20260714_0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE SEQUENCE operational_alert_code_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE"
    )
    op.execute(
        "SELECT setval('operational_alert_code_seq', "
        "GREATEST(COALESCE(MAX(CASE WHEN alert_code ~ '^ALT-[0-9]+$' "
        "THEN substring(alert_code FROM 5)::BIGINT END), 0) + 1, 1), false) "
        "FROM operational_alerts"
    )
    op.execute(
        """
        CREATE TABLE site_sync_alert_states (
            id UUID PRIMARY KEY,
            enterprise_id UUID NOT NULL,
            site_id UUID NOT NULL,
            edge_device_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            operational_alert_id VARCHAR(36) NOT NULL
                REFERENCES operational_alerts(id) ON DELETE RESTRICT,
            status VARCHAR(20) NOT NULL,
            logical_version INTEGER NOT NULL DEFAULT 1,
            pending_count INTEGER NOT NULL,
            oldest_pending_at TIMESTAMP WITH TIME ZONE,
            last_acknowledged_at TIMESTAMP WITH TIME ZONE,
            last_failure_at TIMESTAMP WITH TIME ZONE,
            last_failure_class VARCHAR(120),
            pending_count_threshold INTEGER NOT NULL,
            oldest_age_threshold_seconds INTEGER NOT NULL,
            recovery_pending_count_threshold INTEGER NOT NULL,
            recovery_age_threshold_seconds INTEGER NOT NULL,
            opened_at TIMESTAMP WITH TIME ZONE NOT NULL,
            last_evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL,
            resolved_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_site_sync_alert_states_enterprise_scope
                FOREIGN KEY (enterprise_id, classification)
                REFERENCES enterprises(id, classification) ON DELETE RESTRICT,
            CONSTRAINT fk_site_sync_alert_states_site_scope
                FOREIGN KEY (site_id, enterprise_id, classification)
                REFERENCES enterprise_sites(id, enterprise_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT fk_site_sync_alert_states_device_scope
                FOREIGN KEY (edge_device_id, site_id, classification)
                REFERENCES edge_devices(id, site_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT ck_site_sync_alert_states_classification
                CHECK (classification IN ('official', 'simulation')),
            CONSTRAINT ck_site_sync_alert_states_status
                CHECK (status IN ('active', 'resolved')),
            CONSTRAINT ck_site_sync_alert_states_version CHECK (logical_version >= 1),
            CONSTRAINT ck_site_sync_alert_states_pending CHECK (pending_count >= 0),
            CONSTRAINT ck_site_sync_alert_states_oldest CHECK (
                (pending_count = 0 AND oldest_pending_at IS NULL) OR
                (pending_count > 0 AND oldest_pending_at IS NOT NULL)
            ),
            CONSTRAINT ck_site_sync_alert_states_failure CHECK (
                (last_failure_at IS NULL AND last_failure_class IS NULL) OR
                (last_failure_at IS NOT NULL AND last_failure_class IS NOT NULL)
            ),
            CONSTRAINT ck_site_sync_alert_states_resolution CHECK (
                (status = 'active' AND resolved_at IS NULL) OR
                (status = 'resolved' AND resolved_at IS NOT NULL)
            ),
            CONSTRAINT ck_site_sync_alert_states_count_policy CHECK (
                pending_count_threshold > recovery_pending_count_threshold AND
                recovery_pending_count_threshold >= 0
            ),
            CONSTRAINT ck_site_sync_alert_states_age_policy CHECK (
                oldest_age_threshold_seconds > recovery_age_threshold_seconds AND
                recovery_age_threshold_seconds >= 0
            ),
            CONSTRAINT uq_site_sync_alert_states_site UNIQUE (site_id, classification)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_site_sync_alert_states_status "
        "ON site_sync_alert_states(classification, status, updated_at)"
    )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260714_0030 is intentionally irreversible because sync-health "
        "alert transitions are durable operational evidence. Restore the verified "
        "pre-cutover backup and matching application build instead."
    )
