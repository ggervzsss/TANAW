"""Remove inbound email persistence.

Revision ID: 20260710_0013
Revises: 20260710_0012
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260710_0013"
down_revision: str | Sequence[str] | None = "20260710_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS inbound_email_receipts")


def downgrade() -> None:
    op.create_table(
        "inbound_email_receipts",
        sa.Column("provider_email_id", sa.String(length=120), nullable=False),
        sa.Column("webhook_event_id", sa.String(length=120), nullable=False),
        sa.Column("message_id", sa.String(length=500), nullable=True),
        sa.Column("sender_email", sa.String(length=255), nullable=False),
        sa.Column("ticket_id", sa.String(length=36), nullable=True),
        sa.Column("disposition", sa.String(length=40), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("provider_email_id"),
    )
    op.create_index(
        "ix_inbound_email_receipts_webhook_event_id",
        "inbound_email_receipts",
        ["webhook_event_id"],
        unique=True,
    )
    op.create_index(
        "ix_inbound_email_receipts_message_id",
        "inbound_email_receipts",
        ["message_id"],
    )
    op.create_index(
        "ix_inbound_email_receipts_sender_email",
        "inbound_email_receipts",
        ["sender_email"],
    )
    op.create_index(
        "ix_inbound_email_receipts_ticket_id",
        "inbound_email_receipts",
        ["ticket_id"],
    )
