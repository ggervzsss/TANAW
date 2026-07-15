"""Make simulation terminology the only target runtime/storage vocabulary.

Revision ID: 20260715_0041
Revises: 20260715_0040
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260715_0041"
down_revision: str | Sequence[str] | None = "20260715_0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.rename_table("mock_data_runs", "simulation_runs")
    op.rename_table("mock_data_run_accounts", "simulation_run_accounts")

    renames = (
        ("simulation_runs", "mock_data_runs_pkey", "simulation_runs_pkey"),
        (
            "simulation_runs",
            "fk_mock_data_runs_target_account",
            "fk_simulation_runs_target_account",
        ),
        ("simulation_runs", "ck_mock_data_runs_range", "ck_simulation_runs_range"),
        ("simulation_runs", "ck_mock_data_runs_status", "ck_simulation_runs_status"),
        (
            "simulation_runs",
            "ck_mock_data_runs_lifecycle",
            "ck_simulation_runs_lifecycle",
        ),
        (
            "simulation_run_accounts",
            "mock_data_run_accounts_pkey",
            "simulation_run_accounts_pkey",
        ),
        (
            "simulation_run_accounts",
            "mock_data_run_accounts_run_id_fkey",
            "simulation_run_accounts_run_id_fkey",
        ),
        (
            "simulation_run_accounts",
            "mock_data_run_accounts_account_id_fkey",
            "simulation_run_accounts_account_id_fkey",
        ),
    )
    for table_name, old_name, new_name in renames:
        op.execute(f'ALTER TABLE "{table_name}" RENAME CONSTRAINT "{old_name}" TO "{new_name}"')
    op.execute(
        "ALTER INDEX ix_mock_data_run_accounts_account_id "
        "RENAME TO ix_simulation_run_accounts_account_id"
    )


def downgrade() -> None:
    raise RuntimeError(
        "Simulation storage naming is part of the irreversible target-only cutover; "
        "restore the verified pre-cutover backup instead."
    )
