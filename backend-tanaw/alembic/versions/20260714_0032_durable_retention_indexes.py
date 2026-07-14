"""Add bounded retention access paths and schedule resolved attachments.

Revision ID: 20260714_0032
Revises: 20260714_0031
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260714_0032"
down_revision: str | Sequence[str] | None = "20260714_0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX ix_user_notifications_read_retention "
        "ON user_notifications(read_at, id) WHERE read_at IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX ix_operational_alerts_resolved_retention "
        "ON operational_alerts(updated_at, id) WHERE status = 'Resolved'"
    )
    op.execute(
        "CREATE INDEX ix_account_assets_deleted_retention "
        "ON account_assets(deleted_at, id) WHERE status = 'deleted'"
    )
    op.execute(
        "CREATE INDEX ix_support_attachments_deleted_retention "
        "ON support_attachments(deleted_at, id) WHERE status = 'deleted'"
    )
    op.execute(
        """
        UPDATE support_attachments AS attachment
        SET retention_expires_at = GREATEST(ticket.updated_at, attachment.created_at)
            + INTERVAL '365 days'
        FROM support_tickets AS ticket
        WHERE ticket.id = attachment.ticket_id
          AND ticket.status = 'Resolved'
          AND attachment.status = 'active'
          AND attachment.retention_expires_at IS NULL
        """
    )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260714_0032 is intentionally irreversible after retention scheduling. "
        "Restore the external pre-cutover backup and matching application build instead."
    )
