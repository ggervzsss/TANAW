"""Add transactional and inbound email persistence.

Revision ID: 20260710_0011
Revises: 20260704_0010
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260710_0011"
down_revision: str | Sequence[str] | None = "20260704_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "dev_deliveries",
        sa.Column("provider", sa.String(length=40), nullable=False, server_default="local"),
    )
    op.add_column(
        "dev_deliveries", sa.Column("provider_message_id", sa.String(length=120), nullable=True)
    )
    op.add_column("dev_deliveries", sa.Column("error_message", sa.Text(), nullable=True))
    op.create_index(
        "ix_dev_deliveries_provider_message_id",
        "dev_deliveries",
        ["provider_message_id"],
        unique=True,
    )

    op.create_table(
        "password_reset_challenges",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=True),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("verified", sa.Boolean(), nullable=False),
        sa.Column("code_consumed", sa.Boolean(), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False),
        sa.Column("reset_token_hash", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_password_reset_challenges_email", "password_reset_challenges", ["email"])
    op.create_index(
        "ix_password_reset_challenges_account_id", "password_reset_challenges", ["account_id"]
    )
    op.create_index(
        "ix_password_reset_challenges_expires_at", "password_reset_challenges", ["expires_at"]
    )

    op.create_table(
        "inbound_email_receipts",
        sa.Column("provider_email_id", sa.String(length=120), nullable=False),
        sa.Column("webhook_event_id", sa.String(length=120), nullable=False),
        sa.Column("message_id", sa.String(length=500), nullable=True),
        sa.Column("sender_email", sa.String(length=255), nullable=False),
        sa.Column("ticket_id", sa.String(length=36), nullable=True),
        sa.Column("disposition", sa.String(length=40), nullable=False),
        sa.Column(
            "received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
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
        "ix_inbound_email_receipts_message_id", "inbound_email_receipts", ["message_id"]
    )
    op.create_index(
        "ix_inbound_email_receipts_sender_email", "inbound_email_receipts", ["sender_email"]
    )
    op.create_index("ix_inbound_email_receipts_ticket_id", "inbound_email_receipts", ["ticket_id"])


def downgrade() -> None:
    op.drop_index("ix_inbound_email_receipts_ticket_id", table_name="inbound_email_receipts")
    op.drop_index("ix_inbound_email_receipts_sender_email", table_name="inbound_email_receipts")
    op.drop_index("ix_inbound_email_receipts_message_id", table_name="inbound_email_receipts")
    op.drop_index("ix_inbound_email_receipts_webhook_event_id", table_name="inbound_email_receipts")
    op.drop_table("inbound_email_receipts")
    op.drop_index("ix_password_reset_challenges_expires_at", table_name="password_reset_challenges")
    op.drop_index("ix_password_reset_challenges_account_id", table_name="password_reset_challenges")
    op.drop_index("ix_password_reset_challenges_email", table_name="password_reset_challenges")
    op.drop_table("password_reset_challenges")
    op.drop_index("ix_dev_deliveries_provider_message_id", table_name="dev_deliveries")
    op.drop_column("dev_deliveries", "error_message")
    op.drop_column("dev_deliveries", "provider_message_id")
    op.drop_column("dev_deliveries", "provider")
