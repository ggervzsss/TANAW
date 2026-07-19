"""Remove enterprise geocoding metadata.

Revision ID: 20260719_0020
Revises: 20260712_0019
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260719_0020"
down_revision: str | Sequence[str] | None = "20260712_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("accounts", "geocoded_address")
    op.drop_column("accounts", "location_confidence")
    op.drop_column("accounts", "location_source")


def downgrade() -> None:
    raise RuntimeError(
        "Downgrading would restore removed geocoding fields without their discarded data. "
        "Restore a pre-migration database backup instead."
    )
