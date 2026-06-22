"""account token invalidation timestamp

Revision ID: 20260529_0006
Revises: 20260525_0005
Create Date: 2026-05-29 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260529_0006"
down_revision: str | Sequence[str] | None = "20260525_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "accounts", sa.Column("token_invalid_before", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("accounts", "token_invalid_before")
