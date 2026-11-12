import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest

from app.config.camera_coverage import CameraCoverage
from app.identity.establishment_registry import EstablishmentRegistry
from app.storage.local_data_store import LocalDataStore
from app.storage.repositories.establishment_report_repository import EstablishmentReportRepository
from app.storage.repositories.establishment_repository import snapshot_digest
from app.storage.repositories.occupancy_event_repository import OccupancyEventRepository

OBSERVED = datetime(2026, 10, 10, 2, tzinfo=UTC)
SUBMITTED = datetime(2026, 11, 2, 2, tzinfo=UTC)


def observed(service: EstablishmentRegistry, key="first", *, internal=False, vector=None):
    service.observe(
        observation_id=key,
        camera_id=1,
        track_key=key,
        analysis_mode="open_space" if internal else "entrance_exit",
        kind="area_visit" if internal else "entry",
        coverage=CameraCoverage(
            role="internal_observation" if internal else "external_boundary",
            relationship="independent",
        ),
        qualified=True,
        first_at=OBSERVED,
        observed_at=OBSERVED,
        embedding=vector if vector is not None else np.array([1, 0, 0], dtype=np.float32),
    )


def request(repo, count=1, **changes):
    summary = repo.period_summary("October 2026")
    return {
        "report_id": "REP-ONE",
        "period": "October 2026",
        "now": SUBMITTED,
        "request_id": str(uuid4()),
        "expected_snapshot_version": summary["counting"]["snapshot_version"],
        "metrics": summary["metrics"],
        "payload": {
            "status": "Submitted",
            "demo": {
                "thisProvMale": str(count),
                "thisProvFemale": "0",
                "otherProvMale": "0",
                "otherProvFemale": "0",
                "foreignMale": "0",
                "foreignFemale": "0",
            },
        },
        **changes,
    }


def test_open_space_only_report_preserves_unmeasured_movement_and_frozen_counts(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service, internal=True)
    repo = EstablishmentReportRepository(service.database)
    result = repo.submit(**request(repo))
    assert result["unique_count"] == 1
    assert result["entries"] is result["exits"] is result["peak_occupancy"] is None
    saved = LocalDataStore(str(tmp_path), "park").list_report_submissions()[0]
    assert saved["entries"] is saved["exits"] is saved["peak_occupancy"] is None
    assert (
        saved["payload"]["counting"]["snapshot_version"] == result["counting"]["snapshot_version"]
    )
    assert result["counting"]["source_breakdown"][0]["additive"] is False
    assert "population_flows" not in result["counting"]["days"][0]


def test_idempotent_retry_does_not_replace_frozen_counts_after_reconciliation_changes(
    tmp_path: Path,
):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    operation = request(repo)
    first = repo.submit(**operation)
    observed(service, "additional", vector=np.array([0, 1, 0], dtype=np.float32))
    assert repo.period_summary("October 2026")["metrics"]["unique_count"] == 2
    assert repo.submit(**operation) == first
    assert LocalDataStore(str(tmp_path), "park").list_report_submissions()[0]["unique_count"] == 1


def test_operation_id_cannot_be_reused_for_different_content(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    operation = request(repo)
    repo.submit(**operation)
    with pytest.raises(ValueError, match="different report data"):
        repo.submit(**{**operation, "notes": "Changed"})


def test_stale_snapshot_or_forged_metrics_are_rejected(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    operation = request(repo)
    with pytest.raises(ValueError, match="do not match"):
        repo.submit(**{**operation, "metrics": {**operation["metrics"], "unique_count": 50}})
    observed(service, "additional", vector=np.array([0, 1, 0], dtype=np.float32))
    with pytest.raises(ValueError, match="counts changed"):
        repo.submit(**operation)


def test_resubmission_explicitly_refreshes_counts_and_keeps_previous_snapshot(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    operation = request(repo)
    first = repo.submit(**operation)
    observed(service, "additional", vector=np.array([0, 1, 0], dtype=np.float32))
    revision = request(repo, 2)
    revision["payload"]["status"] = "Resubmitted"
    second = repo.submit(**revision)
    assert first["unique_count"] == 1 and second["unique_count"] == 2
    assert repo.submit(**operation) == first
    assert LocalDataStore(str(tmp_path), "park").list_report_submissions()[0]["unique_count"] == 2
    with service.database.connection() as db:
        assert db.execute("select count(*) from report_submission_snapshots").fetchone()[0] == 2


def test_demographic_revision_can_reuse_original_snapshot_after_source_retention(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    first = request(repo)
    repo.submit(**first)
    service.cleanup(SUBMITTED + timedelta(days=200))
    revised = {
        **first,
        "request_id": str(uuid4()),
        "payload": {**first["payload"], "status": "Resubmitted"},
        "now": SUBMITTED + timedelta(days=200),
    }
    result = repo.submit(**revised)
    assert result["unique_count"] == 1
    assert result["counting"]["snapshot_version"] == first["expected_snapshot_version"]


def test_only_selected_calendar_months_raw_evidence_is_consumed(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    raw = OccupancyEventRepository(service.database)
    for event_id, at in [("selected", OBSERVED), ("next-month", SUBMITTED)]:
        raw.append({"event_id": event_id, "direction": "entry", "camera_id": 1}, at.isoformat())
    repo = EstablishmentReportRepository(service.database)
    repo.submit(**request(repo))
    with service.database.connection() as db:
        rows = {
            row[0]: row[1]
            for row in db.execute("select event_id,submitted_report_id from count_events")
        }
    assert rows == {"selected": "REP-ONE", "next-month": None}


def test_demographics_and_duplicate_period_use_one_establishment_baseline(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    with pytest.raises(ValueError, match="Demographic totals"):
        repo.submit(**request(repo, 2))
    repo.submit(**request(repo))
    with pytest.raises(ValueError, match="already been submitted"):
        repo.submit(**request(repo, report_id="REP-OTHER"))


def test_periods_come_from_recorded_local_data_and_are_enterprise_scoped(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    assert [item["period"] for item in repo.periods()] == ["October 2026"]
    other = EstablishmentRegistry(str(tmp_path), "other")
    assert EstablishmentReportRepository(other.database).periods() == []


def test_snapshot_version_survives_browser_whole_number_serialization(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    value = EstablishmentReportRepository(service.database).period_summary("October 2026")[
        "counting"
    ]
    browser = json.loads(json.dumps(value).replace("1.0", "1"))
    assert snapshot_digest(browser) == value["snapshot_version"]


def test_blank_zero_demographic_cells_use_the_same_visitor_baseline(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service, internal=True)
    repo = EstablishmentReportRepository(service.database)
    body = request(repo)
    body["payload"]["demo"] = {
        key: "" if value == "0" else value for key, value in body["payload"]["demo"].items()
    }
    assert repo.submit(**body)["payload"]["demo"]["foreignMale"] == "0"


def test_missing_identity_measurement_cannot_be_submitted_as_zero_visitors(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    service.observe(
        observation_id="unidentified",
        camera_id=1,
        track_key="person",
        analysis_mode="open_space",
        kind="area_visit",
        coverage=CameraCoverage(role="internal_observation", relationship="independent"),
        qualified=True,
        first_at=OBSERVED,
        observed_at=OBSERVED,
        embedding=None,
    )
    repo = EstablishmentReportRepository(service.database)
    result = repo.period_summary("October 2026")
    assert result["counting"]["unresolved_observations"] == 1
    assert result["counting"]["identification_state"] == "unavailable"
    with pytest.raises(ValueError, match="visitor estimate is unavailable"):
        repo.submit(**request(repo, 0))


def test_missing_independent_measurements_keep_known_movement_partial(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    service.repository.checkpoint_occupancy(
        {
            "occupancy": None,
            "partial_occupancy": 1,
            "state": "partial",
            "movement_available": True,
            "identification_available": True,
        },
        OBSERVED,
    )
    repo = EstablishmentReportRepository(service.database)
    result = repo.period_summary("October 2026")
    assert result["counting"]["movement_state"] == "partial"
    assert result["counting"]["days"][0]["reconciliation_state"] == "partial"
    assert result["metrics"]["entries"] == 1


def test_non_identifying_source_provenance_survives_detail_retention(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    service.repository.cleanup(OBSERVED + timedelta(days=31))
    snapshot = EstablishmentReportRepository(service.database).period_summary("October 2026")[
        "counting"
    ]
    evidence = snapshot["source_breakdown"][0]
    assert evidence["coverage_configurations"][0]["role"] == "external_boundary"
    assert evidence["embedding_spaces"] == ["person_reid_onnx:3"]
    assert evidence["identity_confidence"] == {"high": 1}
    assert sum(evidence["matching_decisions"].values()) == 1
    assert "visitor_id" not in json.dumps(snapshot)
