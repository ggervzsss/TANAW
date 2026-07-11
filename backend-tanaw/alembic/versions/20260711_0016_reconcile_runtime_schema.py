"""Reconcile schema objects that legacy startup code created at runtime.

Revision ID: 20260711_0016
Revises: 20260711_0015

This migration is intentionally idempotent because deployed TANAW databases may
already contain some or all of these objects. Its downgrade is deliberately
blocked: dropping operational and support tables would destroy application data.
Restore a pre-migration backup instead of downgrading through this revision.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260711_0016"
down_revision: str | Sequence[str] | None = "20260711_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    account_columns = (
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS preferences_json TEXT",
    )
    for statement in account_columns:
        op.execute(statement)

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS system_configuration (
            id VARCHAR(40) PRIMARY KEY,
            values_json TEXT NOT NULL,
            updated_by VARCHAR(120),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS operational_alerts (
            id VARCHAR(36) PRIMARY KEY,
            alert_code VARCHAR(40) NOT NULL,
            alert_type VARCHAR(80) NOT NULL,
            severity VARCHAR(20) NOT NULL,
            enterprise VARCHAR(120),
            requester VARCHAR(120) NOT NULL,
            summary TEXT NOT NULL,
            required_action TEXT NOT NULL,
            resolution_mode VARCHAR(80) NOT NULL,
            status VARCHAR(20) NOT NULL,
            owner VARCHAR(20) NOT NULL,
            source_id VARCHAR(120),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    _create_indexes(
        (
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_operational_alerts_alert_code ON operational_alerts (alert_code)",
            "CREATE INDEX IF NOT EXISTS ix_operational_alerts_alert_type ON operational_alerts (alert_type)",
            "CREATE INDEX IF NOT EXISTS ix_operational_alerts_severity ON operational_alerts (severity)",
            "CREATE INDEX IF NOT EXISTS ix_operational_alerts_status ON operational_alerts (status)",
            "CREATE INDEX IF NOT EXISTS ix_operational_alerts_owner ON operational_alerts (owner)",
            "CREATE INDEX IF NOT EXISTS ix_operational_alerts_source_id ON operational_alerts (source_id)",
            "CREATE INDEX IF NOT EXISTS ix_operational_alerts_created_at ON operational_alerts (created_at)",
        )
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS support_tickets (
            id VARCHAR(36) PRIMARY KEY,
            ticket_code VARCHAR(40) NOT NULL,
            enterprise_account_id VARCHAR(36) NOT NULL,
            enterprise_id VARCHAR(120) NOT NULL,
            enterprise_name VARCHAR(120) NOT NULL,
            category VARCHAR(60) NOT NULL,
            priority VARCHAR(20) NOT NULL,
            subject VARCHAR(160) NOT NULL,
            description TEXT NOT NULL,
            affected_area VARCHAR(120),
            camera_node VARCHAR(120),
            attachments_json TEXT,
            status VARCHAR(30) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS attachments_json TEXT")
    _create_indexes(
        (
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_support_tickets_ticket_code ON support_tickets (ticket_code)",
            "CREATE INDEX IF NOT EXISTS ix_support_tickets_enterprise_account_id ON support_tickets (enterprise_account_id)",
            "CREATE INDEX IF NOT EXISTS ix_support_tickets_enterprise_id ON support_tickets (enterprise_id)",
            "CREATE INDEX IF NOT EXISTS ix_support_tickets_category ON support_tickets (category)",
            "CREATE INDEX IF NOT EXISTS ix_support_tickets_priority ON support_tickets (priority)",
            "CREATE INDEX IF NOT EXISTS ix_support_tickets_status ON support_tickets (status)",
            "CREATE INDEX IF NOT EXISTS ix_support_tickets_created_at ON support_tickets (created_at)",
        )
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS support_ticket_messages (
            id VARCHAR(36) PRIMARY KEY,
            ticket_id VARCHAR(36) NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
            author_account_id VARCHAR(36) NOT NULL,
            author_name VARCHAR(120) NOT NULL,
            author_role VARCHAR(40) NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    _create_indexes(
        (
            "CREATE INDEX IF NOT EXISTS ix_support_ticket_messages_ticket_id ON support_ticket_messages (ticket_id)",
            "CREATE INDEX IF NOT EXISTS ix_support_ticket_messages_author_account_id ON support_ticket_messages (author_account_id)",
            "CREATE INDEX IF NOT EXISTS ix_support_ticket_messages_created_at ON support_ticket_messages (created_at)",
        )
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_notifications (
            id VARCHAR(36) PRIMARY KEY,
            recipient_account_id VARCHAR(36) NOT NULL,
            recipient_role VARCHAR(40) NOT NULL,
            recipient_enterprise_id VARCHAR(120),
            title VARCHAR(160) NOT NULL,
            message TEXT NOT NULL,
            notification_type VARCHAR(60) NOT NULL,
            severity VARCHAR(20) NOT NULL,
            source_type VARCHAR(80),
            source_id VARCHAR(120),
            created_by_account_id VARCHAR(36),
            created_by_name VARCHAR(120),
            read_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    _create_indexes(
        (
            "CREATE INDEX IF NOT EXISTS ix_user_notifications_recipient_account_id ON user_notifications (recipient_account_id)",
            "CREATE INDEX IF NOT EXISTS ix_user_notifications_recipient_role ON user_notifications (recipient_role)",
            "CREATE INDEX IF NOT EXISTS ix_user_notifications_recipient_enterprise_id ON user_notifications (recipient_enterprise_id)",
            "CREATE INDEX IF NOT EXISTS ix_user_notifications_notification_type ON user_notifications (notification_type)",
            "CREATE INDEX IF NOT EXISTS ix_user_notifications_severity ON user_notifications (severity)",
            "CREATE INDEX IF NOT EXISTS ix_user_notifications_source_id ON user_notifications (source_id)",
            "CREATE INDEX IF NOT EXISTS ix_user_notifications_created_at ON user_notifications (created_at)",
        )
    )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260711_0016 is intentionally irreversible because its tables contain "
        "operational and support data. Restore a verified pre-migration database backup instead."
    )


def _create_indexes(statements: tuple[str, ...]) -> None:
    for statement in statements:
        op.execute(statement)
