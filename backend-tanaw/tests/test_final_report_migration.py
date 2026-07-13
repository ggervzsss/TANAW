import runpy
from datetime import UTC, datetime
from pathlib import Path

import pytest


def test_final_report_migration_is_chained_target_named_and_guarded() -> None:
    migration = _migration()
    source = _migration_path().read_text()

    assert migration["revision"] == "20260713_0024"
    assert migration["down_revision"] == "20260713_0023"
    assert "CREATE TABLE report_finalizations" in source
    assert "CREATE TABLE final_report_versions" in source
    assert "CREATE TABLE final_report_source_claims" in source
    assert "CREATE SEQUENCE report_finalization_code_seq" in source
    assert "final_reports_v2" not in source
    assert "legacy Citywide title was not" in source
    assert "scope is enterprise_selection" in source
    assert "simulation-final-report-v1" in source
    assert "tanaw_guard_final_report_version_mutation" in source
    assert "tanaw_guard_report_finalization_mutation" in source
    assert "tanaw_guard_final_report_artifact_mutation" in source
    assert '"final_report_command_receipts",' in source
    assert "CREATE TRIGGER trg_{table_name}_immutable" in source


def test_final_report_migration_downgrade_requires_backup_restore() -> None:
    with pytest.raises(RuntimeError, match="backup"):
        _migration()["downgrade"]()


def test_legacy_content_hash_is_deterministic_and_scope_safe() -> None:
    migration = _migration()
    content_hash = migration["_legacy_content_hash"]
    final = {
        "prepared_by": "Legacy Staff",
        "prepared_role": "Staff Processing Division",
        "generated_on": datetime(2026, 7, 1, tzinfo=UTC),
    }
    sources = [
        {
            "report_revision_id": "a",
            "reporting_obligation_id": "b",
            "payload_hash": "sha256:" + "0" * 64,
        }
    ]
    first = content_hash(
        final=final,
        period_id="period",
        classification="official",
        resolved_sources=sources,
        metrics=[],
        demographics=[],
    )
    second = content_hash(
        final=dict(final),
        period_id="period",
        classification="official",
        resolved_sources=list(sources),
        metrics=[],
        demographics=[],
    )
    assert first == second
    assert first.startswith("sha256:") and len(first) == 71


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260713_0024_immutable_scoped_final_reports.py"
    )


def _migration() -> dict:
    return runpy.run_path(str(_migration_path()))
