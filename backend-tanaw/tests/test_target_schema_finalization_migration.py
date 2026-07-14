import runpy
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest


class _FinalizationConnection:
    def __init__(self, *, open_reports: int = 0, open_telemetry: int = 0) -> None:
        self.open_reports = open_reports
        self.open_telemetry = open_telemetry

    def scalar(self, statement: object) -> int:
        sql = str(statement)
        if "report_migration_exceptions" in sql:
            return self.open_reports
        if "telemetry_migration_exceptions" in sql:
            return self.open_telemetry
        raise AssertionError(f"Unexpected finalization query: {sql}")


def test_finalization_relabels_imported_rows_and_drops_cutover_ledgers() -> None:
    migration = _migration()
    operation = MagicMock()
    operation.get_bind.return_value = _FinalizationConnection()
    migration["upgrade"].__globals__["op"] = operation

    migration["upgrade"]()

    executed_sql = "\n".join(call.args[0] for call in operation.execute.call_args_list)
    assert "migration_evidence" in executed_sql
    assert "migration_state_imported" in executed_sql
    assert "migration_final_imported" in executed_sql
    assert "unsequenced_import" in executed_sql
    assert "unqualified_import" in executed_sql
    assert "import_unspecified" in executed_sql
    assert "CREATE OR REPLACE FUNCTION tanaw_enforce_report_acceptance_unblocked" in executed_sql
    assert [call.args[0] for call in operation.drop_table.call_args_list] == [
        "report_migration_exceptions",
        "telemetry_migration_exceptions",
    ]


@pytest.mark.parametrize(
    "connection",
    (
        _FinalizationConnection(open_reports=1),
        _FinalizationConnection(open_telemetry=1),
    ),
)
def test_finalization_fails_closed_before_mutating_schema(
    connection: _FinalizationConnection,
) -> None:
    migration = _migration()
    operation = MagicMock()
    operation.get_bind.return_value = connection
    migration["upgrade"].__globals__["op"] = operation

    with pytest.raises(RuntimeError, match="resolve or waive every migration exception"):
        migration["upgrade"]()

    operation.execute.assert_not_called()
    operation.drop_table.assert_not_called()


def test_target_schema_finalization_is_irreversible() -> None:
    migration = _migration()

    with pytest.raises(RuntimeError, match="external pre-cutover backup"):
        migration["downgrade"]()


def _migration() -> dict[str, Any]:
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260714_0034_finalize_target_schema.py"
    )
    return runpy.run_path(str(path))
