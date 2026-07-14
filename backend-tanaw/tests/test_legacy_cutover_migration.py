import runpy
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest


class _CutoverConnection:
    def __init__(self, *, open_reports: int = 0, missing_reports: int = 0) -> None:
        self.open_reports = open_reports
        self.missing_reports = missing_reports

    def scalar(self, statement: object, parameters: dict[str, object] | None = None) -> int | bool:
        sql = str(statement)
        if "FROM report_migration_exceptions" in sql and "status = 'open'" in sql:
            return self.open_reports
        if "FROM telemetry_migration_exceptions" in sql and "status = 'open'" in sql:
            return 0
        if "FROM enterprise_report_submissions AS source" in sql:
            return self.missing_reports
        return False

    def scalars(self, statement: object) -> list[object]:
        return []


def test_target_only_cutover_drops_every_superseded_table_in_dependency_order() -> None:
    migration = _migration()
    operation = MagicMock()
    operation.get_bind.return_value = _CutoverConnection()
    migration["upgrade"].__globals__["op"] = operation

    migration["upgrade"]()

    assert [call.args[0] for call in operation.drop_table.call_args_list] == [
        "final_report_sources",
        "final_reports",
        "enterprise_report_submissions",
        "enterprise_telemetry_snapshots",
    ]


@pytest.mark.parametrize(
    ("connection", "message"),
    (
        (_CutoverConnection(open_reports=1), "resolve or waive"),
        (_CutoverConnection(missing_reports=1), "no target revision or resolution"),
    ),
)
def test_target_only_cutover_fails_closed_before_dropping_sources(
    connection: _CutoverConnection, message: str
) -> None:
    migration = _migration()
    operation = MagicMock()
    operation.get_bind.return_value = connection
    migration["upgrade"].__globals__["op"] = operation

    with pytest.raises(RuntimeError, match=message):
        migration["upgrade"]()

    operation.drop_table.assert_not_called()


def test_target_only_cutover_is_irreversible() -> None:
    migration = _migration()

    with pytest.raises(RuntimeError, match="external pre-cutover backup"):
        migration["downgrade"]()


def _migration() -> dict[str, Any]:
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260714_0033_remove_legacy_report_runtime.py"
    )
    return runpy.run_path(str(path))
