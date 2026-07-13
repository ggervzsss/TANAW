import runpy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import pytest


def test_legacy_period_parser_requires_complete_unambiguous_calendar_month() -> None:
    migration = _migration()
    parse_period = migration["_parse_legacy_period"]

    june = parse_period("Jun 1 - Jun 30, 2026", "June")
    assert june.natural_key == "month:Asia/Manila:2026-06"
    assert june.starts_at == datetime(2026, 5, 31, 16, tzinfo=UTC)
    assert june.ends_at == datetime(2026, 6, 30, 16, tzinfo=UTC)
    assert parse_period("June 2026", "Jun") == june

    with pytest.raises(ValueError, match="complete calendar month"):
        parse_period("Jun 2 - Jun 30, 2026", "June")
    with pytest.raises(ValueError, match="one calendar month"):
        parse_period("Jun 1 - Jul 31, 2026", "June")
    with pytest.raises(ValueError, match="columns disagree"):
        parse_period("Jun 1 - Jun 30, 2026", "July")


def test_legacy_demographics_are_preserved_only_when_complete_and_reconciled() -> None:
    migration = _migration()
    demographics = migration["_legacy_demographics"]
    payload = {
        "demo": {
            "thisProvMale": "3",
            "thisProvFemale": "2",
            "otherProvMale": "1",
            "otherProvFemale": "1",
            "foreignMale": "2",
            "foreignFemale": "1",
        }
    }

    facts, error = demographics(payload, 10)
    assert error is None
    assert facts == {
        "this_province:male": 3,
        "this_province:female": 2,
        "other_province:male": 1,
        "other_province:female": 1,
        "foreign:male": 2,
        "foreign:female": 1,
    }

    assert demographics(None, 10)[0] is None
    assert demographics(payload, 11)[0] is None
    assert demographics({"demo": {}}, 0)[0] is None


def test_legacy_payload_hash_is_stable_and_covers_mutable_legacy_facts() -> None:
    migration = _migration()
    payload_hash = migration["_legacy_payload_hash"]
    row = _legacy_row()

    assert payload_hash(row) == payload_hash(dict(row))
    changed = dict(row)
    changed["entries"] = 11
    assert payload_hash(row) != payload_hash(changed)
    assert payload_hash(row).startswith("sha256:")
    assert len(payload_hash(row)) == 71


def test_candidate_backfill_records_facts_receipt_event_and_blocking_exceptions() -> None:
    migration = _migration()
    parse_period = migration["_parse_legacy_period"]
    topology_type = migration["_Topology"]
    candidate_type = migration["_Candidate"]
    candidate_exceptions = migration["_candidate_exceptions"]
    backfill_candidate = migration["_backfill_candidate"]

    row = _legacy_row()
    period = parse_period(row["period"], row["month"])
    topology = topology_type(
        enterprise_id="d8d39ea2-10e3-4c88-b71d-5b88c145f8f5",
        site_id="e50f40ec-0208-4eb4-bbe1-e1cb85653ba6",
        classification="official",
        official_code=row["enterprise_id"],
        barangay="Poblacion",
        timezone_name="Asia/Manila",
        registration_effective_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    pending = candidate_exceptions(row, period, topology, "submitted")
    candidate = candidate_type(
        row=row,
        period=period,
        topology=topology,
        workflow_state="submitted",
        pending_exceptions=tuple(pending),
    )
    connection = _RecordingConnection()

    backfill_candidate(cast(Any, connection), candidate)

    assert connection.count_inserts("reporting_obligations") == 1
    assert connection.count_inserts("enterprise_reports") == 1
    assert connection.count_inserts("report_revisions") == 1
    assert connection.count_inserts("report_metric_facts") == 4
    assert connection.count_inserts("report_demographic_facts") == 6
    assert connection.count_inserts("report_source_batches") == 0
    assert connection.count_inserts("report_review_events") == 1
    assert connection.count_inserts("report_intake_receipts") == 1
    assert connection.count_inserts("report_migration_exceptions") == 3
    assert connection.exception_codes() == {
        "unverified_historical_obligation",
        "missing_source_lineage",
        "missing_coverage_evidence",
    }


def test_migration_is_chained_idempotent_guarded_and_defers_final_table_collision() -> None:
    migration = _migration()
    source = _migration_path().read_text()

    assert migration["revision"] == "20260713_0021"
    assert migration["down_revision"] == "20260713_0020"
    for statement_name in (
        "_PERIOD_INSERT",
        "_OBLIGATION_INSERT",
        "_ENTERPRISE_REPORT_INSERT",
        "_REVISION_INSERT",
        "_METRIC_INSERT",
        "_DEMOGRAPHIC_INSERT",
        "_REVIEW_EVENT_INSERT",
        "_RECEIPT_INSERT",
        "_EXCEPTION_INSERT",
    ):
        assert "ON CONFLICT (id) DO NOTHING" in str(migration[statement_name])
    assert "tanaw_reject_immutable_reporting_mutation" in source
    assert "tanaw_enforce_report_acceptance_unblocked" in source
    normalized_source = " ".join(source.split())
    assert (
        "UPDATE OF acceptance_blocked, current_revision_id, workflow_state, "
        "accepted_revision_id" in normalized_source
    )
    assert "NEW.workflow_state IN ('accepted', 'consolidated')" in source
    assert "revision.id = NEW.accepted_revision_id" in source
    assert "CREATE TABLE final_report" not in source
    assert "final_reports_v2" not in source


class _RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def execute(self, statement: object, parameters: dict[str, object] | None = None) -> None:
        self.calls.append((str(statement), parameters or {}))

    def count_inserts(self, table_name: str) -> int:
        marker = f"INSERT INTO {table_name}"
        return sum(marker in statement for statement, _parameters in self.calls)

    def exception_codes(self) -> set[object]:
        return {
            parameters["exception_code"]
            for statement, parameters in self.calls
            if "INSERT INTO report_migration_exceptions" in statement
        }


def _migration() -> dict[str, Any]:
    return runpy.run_path(str(_migration_path()))


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260713_0021_versioned_reporting_foundation.py"
    )


def _legacy_row() -> dict[str, object]:
    now = datetime(2026, 7, 1, 8, tzinfo=UTC)
    return {
        "id": "4c0b9622-7ef9-4a97-a557-0b7eab4f6a43",
        "report_id": "REP-260601",
        "enterprise_account_id": "7be13696-d85c-48f3-a9e1-5395e2dd97eb",
        "enterprise_id": "ENT-001",
        "enterprise_name": "Sample Enterprise",
        "category": "Tourism",
        "barangay": "Poblacion",
        "period": "Jun 1 - Jun 30, 2026",
        "month": "June",
        "submitted_at": now,
        "received_at": now,
        "entries": 10,
        "exits": 8,
        "peak_occupancy": 4,
        "unique_count": 10,
        "status": "Submitted",
        "review_status": "Pending Review",
        "notes": None,
        "remarks": None,
        "sync_status": "synced",
        "payload_json": (
            '{"demo":{"foreignFemale":"1","foreignMale":"2",'
            '"otherProvFemale":"1","otherProvMale":"1",'
            '"thisProvFemale":"2","thisProvMale":"3"}}'
        ),
        "source_kind": "real",
        "mock_run_id": None,
        "updated_at": now,
    }
