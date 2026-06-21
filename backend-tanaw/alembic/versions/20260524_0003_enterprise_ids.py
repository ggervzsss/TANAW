"""enterprise login identifiers

Revision ID: 20260524_0003
Revises: 20260524_0002
Create Date: 2026-05-24
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260524_0003"
down_revision: str | Sequence[str] | None = "20260524_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS enterprise_id VARCHAR(120)")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_accounts_enterprise_id ON accounts (enterprise_id)"
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_accounts_enterprise_id"), table_name="accounts")
    op.drop_column("accounts", "enterprise_id")
