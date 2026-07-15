"""Constrain the target activity-log projection and link authenticated actors.

Revision ID: 20260715_0038
Revises: 20260715_0037
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260715_0038"
down_revision: str | Sequence[str] | None = "20260715_0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CATEGORIES = (
    "IT Activity",
    "Staff Submission",
    "Staff Operation",
    "Admin Operation",
    "Enterprise Activity",
    "System",
)
SEVERITIES = ("Info", "Warning", "Critical", "Success")
ACTOR_ROLES = ("Admin", "IT Personnel", "LGU Staff", "Enterprise Account", "System")


def upgrade() -> None:
    connection = op.get_bind()
    _require_allowed_values(connection, "category", CATEGORIES)
    _require_allowed_values(connection, "severity", SEVERITIES)
    _require_allowed_values(connection, "actor_role", ACTOR_ROLES)
    _require_consistent_simulation_scope(connection)
    op.drop_constraint("ck_activity_logs_simulation_scope", "activity_logs", type_="check")
    op.drop_constraint("fk_activity_logs_simulation_run", "activity_logs", type_="foreignkey")
    op.add_column("activity_logs", sa.Column("actor_account_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_activity_logs_actor_account",
        "activity_logs",
        "accounts",
        ["actor_account_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_activity_logs_simulation_run",
        "activity_logs",
        "mock_data_runs",
        ["simulation_run_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_activity_logs_category",
        "activity_logs",
        "category IN ('IT Activity', 'Staff Submission', 'Staff Operation', "
        "'Admin Operation', 'Enterprise Activity', 'System')",
    )
    op.create_check_constraint(
        "ck_activity_logs_severity",
        "activity_logs",
        "severity IN ('Info', 'Warning', 'Critical', 'Success')",
    )
    op.create_check_constraint(
        "ck_activity_logs_actor_role",
        "activity_logs",
        "actor_role IN ('Admin', 'IT Personnel', 'LGU Staff', 'Enterprise Account', 'System')",
    )
    op.create_check_constraint(
        "ck_activity_logs_simulation_scope",
        "activity_logs",
        "(classification = 'official' AND simulation_run_id IS NULL) OR "
        "(classification = 'simulation' AND simulation_run_id IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_activity_logs_required_text",
        "activity_logs",
        "length(trim(actor)) > 0 AND length(trim(action)) > 0 "
        "AND length(trim(target)) > 0 AND length(trim(summary)) > 0 "
        "AND length(summary) <= 1000",
    )
    op.create_check_constraint(
        "ck_activity_logs_metadata_size",
        "activity_logs",
        "metadata_json IS NULL OR length(metadata_json) <= 20000",
    )
    op.create_index(
        "ix_activity_logs_official_time",
        "activity_logs",
        ["classification", sa.text("timestamp DESC"), "id"],
    )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260715_0038 is part of the irreversible target-only activity-log "
        "projection. Restore the verified external pre-cutover backup instead."
    )


def _require_allowed_values(
    connection: Connection, column: str, allowed_values: tuple[str, ...]
) -> None:
    invalid = int(
        connection.execute(
            sa.text(
                f"SELECT count(*) FROM activity_logs WHERE {column} IS NULL OR {column} "
                f"NOT IN ({', '.join(f':value_{index}' for index in range(len(allowed_values)))})"
            ),
            {f"value_{index}": value for index, value in enumerate(allowed_values)},
        ).scalar_one()
    )
    if invalid:
        raise RuntimeError(f"Activity-log cutover blocked by {invalid} invalid {column} value(s).")


def _require_consistent_simulation_scope(connection: Connection) -> None:
    invalid = int(
        connection.execute(
            sa.text(
                "SELECT count(*) FROM activity_logs WHERE "
                "(classification = 'official' AND simulation_run_id IS NOT NULL) OR "
                "(classification = 'simulation' AND simulation_run_id IS NULL)"
            )
        ).scalar_one()
    )
    if invalid:
        raise RuntimeError(
            "Activity-log cutover blocked by "
            f"{invalid} record(s) with inconsistent simulation ownership."
        )
