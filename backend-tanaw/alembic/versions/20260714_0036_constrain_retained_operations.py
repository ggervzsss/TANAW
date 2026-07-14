"""Constrain retained operational and email lifecycles.

Revision ID: 20260714_0036
Revises: 20260714_0035
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260714_0036"
down_revision: str | Sequence[str] | None = "20260714_0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    _require_consistent_retained_rows(connection)

    op.execute(
        "CREATE SEQUENCE support_ticket_code_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE"
    )
    op.execute(
        "SELECT setval('support_ticket_code_seq', "
        "GREATEST(COALESCE(MAX(CASE WHEN ticket_code ~ '^TCK-[0-9]+$' "
        "THEN substring(ticket_code FROM 5)::BIGINT END), 0) + 1, 1), false) "
        "FROM support_tickets"
    )

    checks = (
        ("ck_mock_data_runs_range", "mock_data_runs", "range_end > range_start"),
        ("ck_mock_data_runs_status", "mock_data_runs", "status IN ('active', 'removed')"),
        (
            "ck_mock_data_runs_lifecycle",
            "mock_data_runs",
            "(status = 'active' AND ended_at IS NULL) OR "
            "(status = 'removed' AND ended_at IS NOT NULL)",
        ),
        (
            "ck_operational_alerts_type",
            "operational_alerts",
            "alert_type IN ('Maintenance Request', 'Password Reset Request', "
            "'Submission Delay', 'Threshold Breach', 'Foot Traffic Alert', "
            "'Occupancy Spike', 'Failed Login Threshold', 'Sync Delay')",
        ),
        (
            "ck_operational_alerts_severity",
            "operational_alerts",
            "severity IN ('Info', 'Warning', 'Critical')",
        ),
        (
            "ck_operational_alerts_resolution_mode",
            "operational_alerts",
            "resolution_mode IN ('On-site Visit Required', 'In-system Action', "
            "'Staff Follow-up', 'Remote Review', 'Admin Monitoring', "
            "'Automatic Health Recovery')",
        ),
        (
            "ck_operational_alerts_status",
            "operational_alerts",
            "status IN ('New', 'In Review', 'Resolved')",
        ),
        (
            "ck_operational_alerts_owner",
            "operational_alerts",
            "owner IN ('IT', 'Admin', 'System')",
        ),
        (
            "ck_user_notifications_recipient_role",
            "user_notifications",
            "recipient_role IN ('it', 'admin', 'staff', 'enterprise')",
        ),
        (
            "ck_user_notifications_severity",
            "user_notifications",
            "severity IN ('Info', 'Warning', 'Critical', 'Success')",
        ),
        (
            "ck_user_notifications_enterprise_scope",
            "user_notifications",
            "(recipient_role = 'enterprise' AND recipient_enterprise_id IS NOT NULL) OR "
            "(recipient_role != 'enterprise' AND recipient_enterprise_id IS NULL)",
        ),
        (
            "ck_user_notifications_actor_snapshot",
            "user_notifications",
            "(created_by_account_id IS NULL AND created_by_name IS NULL) OR "
            "(created_by_account_id IS NOT NULL AND created_by_name IS NOT NULL "
            "AND length(trim(created_by_name)) > 0)",
        ),
        (
            "ck_support_tickets_category",
            "support_tickets",
            "category IN ('Camera Issue', 'Report Concern', 'Maintenance', "
            "'Account & Security', 'Other')",
        ),
        (
            "ck_support_tickets_priority",
            "support_tickets",
            "priority IN ('Low', 'Normal', 'High', 'Urgent')",
        ),
        (
            "ck_support_tickets_status",
            "support_tickets",
            "status IN ('Open', 'In Review', 'Resolved')",
        ),
        (
            "ck_support_ticket_messages_author_role",
            "support_ticket_messages",
            "author_role IN ('it', 'admin', 'staff', 'enterprise')",
        ),
        (
            "ck_support_ticket_messages_content",
            "support_ticket_messages",
            "length(trim(author_name)) > 0 AND length(trim(message)) > 0",
        ),
        (
            "ck_email_outbox_status",
            "email_outbox",
            "status IN ('queued', 'processing', 'retry_scheduled', 'accepted', "
            "'recorded', 'terminal_failed', 'cancelled', 'expired', "
            "'reconciliation_required')",
        ),
        (
            "ck_email_outbox_template",
            "email_outbox",
            "template_name IN ('account_activation', 'password_reset', "
            "'business_email_change', 'account_email_change_verification', "
            "'account_email_change_request_notice', 'account_email_change_approved_old', "
            "'account_email_change_approved_new', 'support_reply')",
        ),
        ("ck_email_outbox_provider", "email_outbox", "provider IN ('local', 'resend')"),
        ("ck_email_outbox_attempt_limit", "email_outbox", "attempt_count <= max_attempts"),
        (
            "ck_email_delivery_attempt_number",
            "email_delivery_attempts",
            "attempt_number >= 1",
        ),
        (
            "ck_email_delivery_attempt_status",
            "email_delivery_attempts",
            "status IN ('queued', 'processing', 'retry_scheduled', 'accepted', "
            "'recorded', 'terminal_failed', 'cancelled', 'expired', "
            "'reconciliation_required')",
        ),
        (
            "ck_email_delivery_attempt_timestamps",
            "email_delivery_attempts",
            "finished_at >= started_at",
        ),
    )
    for name, table_name, condition in checks:
        op.create_check_constraint(name, table_name, condition)

    op.create_index(
        "uq_operational_alerts_active_source",
        "operational_alerts",
        ["alert_type", "source_id"],
        unique=True,
        postgresql_where=sa.text("source_id IS NOT NULL AND status != 'Resolved'"),
    )


def _require_consistent_retained_rows(connection: Connection) -> None:
    active_duplicate_count = int(
        connection.scalar(
            sa.text(
                """
                SELECT count(*)
                FROM (
                    SELECT alert_type, source_id
                    FROM operational_alerts
                    WHERE source_id IS NOT NULL AND status != 'Resolved'
                    GROUP BY alert_type, source_id
                    HAVING count(*) > 1
                ) AS duplicate
                """
            )
        )
        or 0
    )
    invalid_notification_scope = int(
        connection.scalar(
            sa.text(
                """
                SELECT count(*) FROM user_notifications
                WHERE (recipient_role = 'enterprise' AND recipient_enterprise_id IS NULL)
                   OR (recipient_role != 'enterprise' AND recipient_enterprise_id IS NOT NULL)
                   OR (created_by_account_id IS NULL) != (created_by_name IS NULL)
                """
            )
        )
        or 0
    )
    if active_duplicate_count or invalid_notification_scope:
        raise RuntimeError(
            "Retained operational cutover blocked by inconsistent lifecycle rows "
            f"(active_alert_duplicates={active_duplicate_count}, "
            f"notification_scope_or_actor={invalid_notification_scope})."
        )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260714_0036 establishes target operational constraints and "
        "collision-safe allocation. Restore the verified external pre-cutover "
        "backup and matching application build instead."
    )
