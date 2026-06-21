"""enterprise account locations

Revision ID: 20260525_0004
Revises: 20260524_0003
Create Date: 2026-05-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260525_0004"
down_revision: str | Sequence[str] | None = "20260524_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("accounts", sa.Column("longitude", sa.Float(), nullable=True))
    op.add_column("accounts", sa.Column("location_source", sa.String(length=40), nullable=True))
    op.add_column("accounts", sa.Column("location_confidence", sa.Float(), nullable=True))
    op.add_column("accounts", sa.Column("geocoded_address", sa.String(length=500), nullable=True))
    op.add_column(
        "accounts", sa.Column("location_updated_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("accounts", "location_updated_at")
    op.drop_column("accounts", "geocoded_address")
    op.drop_column("accounts", "location_confidence")
    op.drop_column("accounts", "location_source")
    op.drop_column("accounts", "longitude")
    op.drop_column("accounts", "latitude")
