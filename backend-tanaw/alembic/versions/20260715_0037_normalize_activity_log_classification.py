"""Normalize activity-log classification and remove client-era labels.

Revision ID: 20260715_0037
Revises: 20260714_0036
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260715_0037"
down_revision: str | Sequence[str] | None = "20260714_0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    _require_classifiable_rows(connection)

    op.drop_constraint("fk_activity_logs_mock_run", "activity_logs", type_="foreignkey")
    op.drop_index("ix_activity_logs_mock_run_id", table_name="activity_logs")
    op.alter_column("activity_logs", "source_kind", new_column_name="classification")
    op.alter_column("activity_logs", "mock_run_id", new_column_name="simulation_run_id")
    op.execute(
        "UPDATE activity_logs SET classification = CASE "
        "WHEN classification = 'real' THEN 'official' ELSE 'simulation' END"
    )
    op.alter_column(
        "activity_logs",
        "classification",
        existing_type=sa.String(length=20),
        nullable=False,
        server_default="official",
    )
    op.create_foreign_key(
        "fk_activity_logs_simulation_run",
        "activity_logs",
        "mock_data_runs",
        ["simulation_run_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_activity_logs_simulation_run_id",
        "activity_logs",
        ["simulation_run_id"],
    )
    op.create_check_constraint(
        "ck_activity_logs_classification",
        "activity_logs",
        "classification IN ('official', 'simulation')",
    )
    op.create_check_constraint(
        "ck_activity_logs_simulation_scope",
        "activity_logs",
        "classification = 'simulation' OR simulation_run_id IS NULL",
    )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260715_0037 removes client-era activity-log classification labels. "
        "Restore the verified external pre-cutover backup and matching application build instead."
    )


def _require_classifiable_rows(connection: Connection) -> None:
    invalid = int(
        connection.execute(
            sa.text(
                "SELECT count(*) FROM activity_logs "
                "WHERE source_kind NOT IN ('real', 'mock', 'hybrid') "
                "OR (source_kind = 'real' AND mock_run_id IS NOT NULL)"
            )
        ).scalar_one()
    )
    if invalid:
        raise RuntimeError(
            "Activity-log target classification cutover blocked by "
            f"{invalid} inconsistent row(s). Resolve them before target-only migration."
        )
