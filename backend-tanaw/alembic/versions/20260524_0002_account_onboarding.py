"""account onboarding and dev deliveries

Revision ID: 20260524_0002
Revises: 20260524_0001
Create Date: 2026-05-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260524_0002"
down_revision: str | Sequence[str] | None = "20260524_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    delivery_channel = postgresql.ENUM("EMAIL", "SMS", name="delivery_channel", create_type=False)
    delivery_status = postgresql.ENUM(
        "RECORDED", "SENT", "FAILED", name="delivery_status", create_type=False
    )
    delivery_channel.create(op.get_bind(), checkfirst=True)
    delivery_status.create(op.get_bind(), checkfirst=True)

    op.add_column("accounts", sa.Column("phone", sa.String(length=40), nullable=True))
    op.add_column("accounts", sa.Column("first_name", sa.String(length=60), nullable=True))
    op.add_column("accounts", sa.Column("last_name", sa.String(length=60), nullable=True))
    op.add_column("accounts", sa.Column("enterprise_name", sa.String(length=120), nullable=True))
    op.add_column("accounts", sa.Column("category", sa.String(length=120), nullable=True))
    op.add_column("accounts", sa.Column("manager_name", sa.String(length=120), nullable=True))
    op.add_column("accounts", sa.Column("barangay", sa.String(length=120), nullable=True))
    op.add_column("accounts", sa.Column("address", sa.String(length=255), nullable=True))
    op.add_column("accounts", sa.Column("gateway_id", sa.String(length=120), nullable=True))
    op.add_column("accounts", sa.Column("gateway_status", sa.String(length=40), nullable=True))
    op.add_column(
        "accounts",
        sa.Column(
            "must_change_password", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    op.add_column(
        "accounts",
        sa.Column("temporary_password_created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "accounts",
        sa.Column("temporary_password_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "accounts", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True)
    )

    op.create_table(
        "dev_deliveries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("channel", delivery_channel, nullable=False),
        sa.Column("recipient", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", delivery_status, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_dev_deliveries_account_id"), "dev_deliveries", ["account_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_dev_deliveries_account_id"), table_name="dev_deliveries")
    op.drop_table("dev_deliveries")
    op.drop_column("accounts", "password_changed_at")
    op.drop_column("accounts", "temporary_password_expires_at")
    op.drop_column("accounts", "temporary_password_created_at")
    op.drop_column("accounts", "must_change_password")
    op.drop_column("accounts", "phone")
    op.drop_column("accounts", "gateway_status")
    op.drop_column("accounts", "gateway_id")
    op.drop_column("accounts", "address")
    op.drop_column("accounts", "barangay")
    op.drop_column("accounts", "manager_name")
    op.drop_column("accounts", "category")
    op.drop_column("accounts", "enterprise_name")
    op.drop_column("accounts", "last_name")
    op.drop_column("accounts", "first_name")
    postgresql.ENUM(name="delivery_status").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="delivery_channel").drop(op.get_bind(), checkfirst=True)
