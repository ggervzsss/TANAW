"""preserve final report status across archive restore

Revision ID: 20260704_0010
Revises: 20260703_0009
Create Date: 2026-07-04 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260704_0010"
down_revision: str | Sequence[str] | None = "20260703_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "final_reports", sa.Column("archived_from_status", sa.String(length=40), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("final_reports", "archived_from_status")
