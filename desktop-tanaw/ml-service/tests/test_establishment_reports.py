import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from support.reports import OBSERVED, SUBMITTED, observed, request

from app.identity.establishment_registry import EstablishmentRegistry
from app.storage.local_data_store import LocalDataStore
from app.storage.repositories.establishment_report_repository import EstablishmentReportRepository
from app.storage.repositories.establishment_repository import snapshot_digest
from app.storage.repositories.occupancy_event_repository import OccupancyEventRepository


@pytest.mark.parametrize("area_role", ["internal_observation", "external_boundary"])
def test_open_space_only_report_preserves_unmeasured_movement_and_frozen_counts(
    tmp_path: Path, area_role: str
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service, internal=True, area_role=area_role)
    repo = EstablishmentReportRepository(service.database)
    result = repo.submit(**request(repo))
    assert result["unique_count"] == 1
    assert result["entries"] is result["exits"] is result["peak_occupancy"] is None
    saved = LocalDataStore(str(tmp_path), "park").list_report_submissions()[0]
    assert saved["entries"] is saved["exits"] is saved["peak_occupancy"] is None
    assert (
        saved["payload"]["counting"]["snapshot_version"] == result["counting"]["snapshot_version"]
    )
    source = result["counting"]["source_breakdown"][0]
    assert source["additive"] is False
    assert source["entries"] is source["exits"] is None
    assert "population_flows" not in result["counting"]["days"][0]


def test_idempotent_retry_does_not_replace_frozen_counts_after_reconciliation_changes(
    tmp_path: Path,
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    operation = request(repo)
    first = repo.submit(**operation)
    observed(service, "additional", vector=np.array([0, 1, 0], dtype=np.float32))
    assert repo.period_summary("October 2026")["metrics"]["unique_count"] == 2
    assert repo.submit(**operation) == first
    assert LocalDataStore(str(tmp_path), "park").list_report_submissions()[0]["unique_count"] == 1


def test_operation_id_cannot_be_reused_for_different_content(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    operation = request(repo)
    repo.submit(**operation)
    with pytest.raises(ValueError, match="different report data"):
        repo.submit(**{**operation, "notes": "Changed"})


def test_stale_snapshot_or_forged_metrics_are_rejected(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    operation = request(repo)
    with pytest.raises(ValueError, match="do not match"):
        repo.submit(**{**operation, "metrics": {**operation["metrics"], "unique_count": 50}})
    observed(service, "additional", vector=np.array([0, 1, 0], dtype=np.float32))
    with pytest.raises(ValueError, match="counts changed"):
        repo.submit(**operation)


def test_a_submitted_month_cannot_be_submitted_again(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    operation = request(repo)
    first = repo.submit(**operation)
    observed(service, "additional", vector=np.array([0, 1, 0], dtype=np.float32))
    second = request(repo, 2)
    # Neither the same report nor a report under a new reference can replace it.
    for attempt in (second, {**second, "report_id": "REP-OTHER"}):
        with pytest.raises(ValueError, match="one report per reporting month"):
            repo.submit(**attempt)
    assert repo.submit(**operation) == first
    saved = LocalDataStore(str(tmp_path), "park").list_report_submissions()
    assert [(item["report_id"], item["unique_count"]) for item in saved] == [("REP-ONE", 1)]
    assert saved[0]["payload"]["status"] == "Submitted"
    with service.database.connection() as db:
        assert db.execute("select count(*) from report_submission_snapshots").fetchone()[0] == 1


def test_a_saved_report_reference_cannot_be_reused_for_another_month(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    repo.submit(**request(repo))
    later = SUBMITTED + timedelta(days=31)
    with pytest.raises(ValueError, match="REP-ONE has already been submitted"):
        repo.submit(**{**request(repo, 0), "period": "November 2026", "now": later})


def test_only_selected_calendar_months_raw_evidence_is_consumed(tmp_path: Path) -> None:
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


def test_demographics_and_duplicate_period_use_one_establishment_baseline(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    with pytest.raises(ValueError, match="Demographic totals"):
        repo.submit(**request(repo, 2))
    repo.submit(**request(repo))
    with pytest.raises(ValueError, match="already been submitted"):
        repo.submit(**request(repo, report_id="REP-OTHER"))


def test_periods_come_from_recorded_local_data_and_are_enterprise_scoped(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    assert [item["period"] for item in repo.periods()] == ["October 2026"]
    other = EstablishmentRegistry(str(tmp_path), "other")
    assert EstablishmentReportRepository(other.database).periods() == []


def test_snapshot_version_survives_browser_whole_number_serialization(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    value = EstablishmentReportRepository(service.database).period_summary("October 2026")[
        "counting"
    ]
    browser = json.loads(json.dumps(value).replace("1.0", "1"))
    assert snapshot_digest(browser) == value["snapshot_version"]


def test_blank_zero_demographic_cells_use_the_same_visitor_baseline(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service, internal=True)
    repo = EstablishmentReportRepository(service.database)
    body = request(repo)
    body["payload"]["demo"] = {
        key: "" if value == "0" else value for key, value in body["payload"]["demo"].items()
    }
    assert repo.submit(**body)["payload"]["demo"]["foreignMale"] == "0"


def test_visitors_without_a_recorded_sex_count_toward_the_baseline(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service, internal=True)
    repo = EstablishmentReportRepository(service.database)
    over = request(repo, 1)
    over["payload"]["demo"]["thisProvUnspecified"] = "1"
    with pytest.raises(ValueError, match="must match"):
        repo.submit(**over)

    body = request(repo, 0)
    body["payload"]["demo"]["thisProvUnspecified"] = "1"
    body["payload"]["origins"] = {"2026-10-01": {"otherCity": {"male": 0, "female": 0}}}
    saved = repo.submit(**body)["payload"]
    assert saved["demo"]["thisProvUnspecified"] == "1"
    assert saved["origins"] == body["payload"]["origins"]


def test_unidentified_visitors_are_reported_as_a_degraded_estimate_not_zero(
    tmp_path: Path,
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    service.observe(
        observation_id="unidentified",
        camera_id=1,
        track_key="person",
        analysis_mode="open_space",
        kind="area_visit",
        qualified=True,
        first_at=OBSERVED,
        observed_at=OBSERVED,
        embedding=None,
    )
    repo = EstablishmentReportRepository(service.database)
    result = repo.period_summary("October 2026")
    assert result["counting"]["unresolved_observations"] == 1
    assert result["counting"]["identification_state"] == "partial"
    assert result["counting"]["unique_count"] == result["counting"]["degraded_unique_count"] == 1
    assert result["metrics"]["unique_count"] == 1


def test_a_period_with_only_unsettled_identities_cannot_be_submitted_as_zero(
    tmp_path: Path,
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service, "doorway")
    repo = EstablishmentReportRepository(service.database)
    with service.database.connection() as db:
        # An identity still waiting for its decision: observed, but not yet countable.
        db.execute(
            "update establishment_observations set identity_confidence='low' where kind!='exit'"
        )
        db.execute("update visitor_identities set identity_status='provisional'")
    service.repository.rebuild_day("2026-10-10", OBSERVED)
    assert repo.period_summary("October 2026")["counting"]["unique_count"] == 0
    with pytest.raises(ValueError, match="none could be counted"):
        repo.submit(**request(repo, 0))


def test_offline_camera_keeps_the_running_cameras_counts(tmp_path: Path) -> None:
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
    # One day of the month was observed; the day itself is a normal estimate.
    assert result["counting"]["movement_state"] == "partial"
    assert result["counting"]["days"][0]["reconciliation_state"] == "estimated"
    assert result["metrics"]["entries"] == 1


def test_non_identifying_source_provenance_survives_detail_retention(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    service.repository.cleanup(OBSERVED + timedelta(days=31))
    snapshot = EstablishmentReportRepository(service.database).period_summary("October 2026")[
        "counting"
    ]
    evidence = snapshot["source_breakdown"][0]
    assert evidence["analysis_modes"] == ["entrance_exit"]
    assert evidence["embedding_spaces"] == ["person_reid_onnx:3"]
    assert evidence["identity_confidence"] == {"high": 1}
    assert sum(evidence["matching_decisions"].values()) == 1
    assert "visitor_id" not in json.dumps(snapshot)


def _store(tmp_path: Path) -> LocalDataStore:
    return LocalDataStore(str(tmp_path), "park")


def _saved(tmp_path: Path) -> dict[str, dict[str, Any]]:
    return {item["report_id"]: item for item in _store(tmp_path).list_report_submissions()}


def test_a_report_staff_returned_reopens_and_its_correction_is_the_next_version(
    tmp_path: Path,
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    raw = OccupancyEventRepository(service.database)
    raw.append({"event_id": "selected", "direction": "entry", "camera_id": 1}, OBSERVED.isoformat())
    repo = EstablishmentReportRepository(service.database)
    first = repo.submit(**request(repo))
    assert first["version"] == 1
    store = _store(tmp_path)
    # This computer missed TANAW's confirmation; a returned report reached TANAW all the same.
    assert _saved(tmp_path)["REP-ONE"]["sync_status"] == "pending_cloud_sync"

    reopened = store.reopen_report_submission("REP-ONE", "returned")
    assert reopened["reopened_at"] is not None
    assert reopened["reopen_reason"] == "returned"
    assert reopened["sync_status"] == "synced"
    assert reopened["synced_at"] is not None
    # Reopening again changes nothing.
    assert (
        store.reopen_report_submission("REP-ONE", "returned")["reopened_at"]
        == (reopened["reopened_at"])
    )

    corrected = repo.submit(**request(repo, report_id="REP-TWO"))
    assert corrected["version"] == 2
    saved = _saved(tmp_path)
    assert {key: item["version"] for key, item in saved.items()} == {"REP-ONE": 1, "REP-TWO": 2}
    assert saved["REP-ONE"]["sync_status"] == "synced"
    assert saved["REP-TWO"]["reopened_at"] is None
    # The month's raw evidence belongs to the version being sent now.
    with service.database.connection() as db:
        owner = db.execute(
            "select submitted_report_id from count_events where event_id='selected'"
        ).fetchone()[0]
    assert owner == "REP-TWO"
    # The corrected version holds the month again.
    with pytest.raises(ValueError, match="one report per reporting month"):
        repo.submit(**request(repo, report_id="REP-THREE"))


def test_a_refused_upload_keeps_its_reason_and_its_fix_keeps_the_version(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    repo = EstablishmentReportRepository(service.database)
    first = repo.submit(**request(repo))
    store = _store(tmp_path)
    with pytest.raises(ValueError, match="did not accept"):
        store.reopen_report_submission("REP-ONE", "upload_rejected")
    assert store.mark_report_upload_rejected(
        "REP-ONE", first["submission_id"], "  Totals do not match.  "
    )
    assert _saved(tmp_path)["REP-ONE"]["rejection_reason"] == "Totals do not match."
    # A later refusal without a reason keeps the one TANAW gave.
    store.mark_report_upload_rejected("REP-ONE", first["submission_id"])
    assert _saved(tmp_path)["REP-ONE"]["rejection_reason"] == "Totals do not match."
    with pytest.raises(ValueError, match="could not return it"):
        store.reopen_report_submission("REP-ONE", "returned")

    store.reopen_report_submission("REP-ONE", "upload_rejected")
    fixed = repo.submit(**request(repo, report_id="REP-FIX"))
    # TANAW never accepted the first attempt, so the fix is still version 1.
    assert fixed["version"] == 1
    assert _saved(tmp_path)["REP-FIX"]["sync_status"] == "pending_cloud_sync"


def test_reopening_needs_a_known_report_and_reason(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed(service)
    store = _store(tmp_path)
    with pytest.raises(LookupError):
        store.reopen_report_submission("REP-MISSING", "returned")
    with pytest.raises(ValueError, match="Staff return"):
        store.reopen_report_submission("REP-MISSING", "edited")
