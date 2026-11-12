"""The same frozen desktop fixture is accepted and retained by Staff reporting."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.features.reporting.counting import complete_sum, snapshot_digest
from app.features.reporting.final_reports import final_report_source_snapshot
from app.features.reporting.models import EnterpriseReportSubmission
from app.features.reporting.schemas import DesktopReportSubmissionIngest

FIXTURE = Path(__file__).resolve().parents[4] / "test-fixtures/open-space-establishment-report.json"


def submission():
    saved = json.loads(FIXTURE.read_text())
    return dict(
        submissionId=saved["submission_id"],
        reportId=saved["report_id"],
        period=saved["period"],
        submittedAt=saved["submitted_at"],
        entries=saved["entries"],
        exits=saved["exits"],
        peakOccupancy=saved["peak_occupancy"],
        uniqueCount=saved["unique_count"],
        payload=saved["payload"],
    )


def test_actual_desktop_open_space_snapshot_preserves_null_movement_and_one_total():
    report = DesktopReportSubmissionIngest.model_validate(submission())
    assert report.entries is report.exits is None
    assert report.uniqueCount == 2
    assert report.peakOccupancy == 2
    source = EnterpriseReportSubmission(
        id="source-id",
        enterprise_name="Park",
        report_id=report.reportId,
        entries=report.entries,
        exits=report.exits,
        unique_count=report.uniqueCount,
        payload_json=json.dumps(report.payload),
    )
    snapshot = final_report_source_snapshot("final-id", source)
    assert snapshot.unique_count == 2
    assert snapshot.entries is snapshot.exits is None
    assert snapshot.counting_json == report.payload["counting"]
    assert snapshot.this_prov_male == snapshot.this_prov_female == 1


@pytest.mark.parametrize("change", ["hash", "metrics", "period", "payload_metrics"])
def test_mismatched_frozen_snapshot_is_rejected(change):
    body = submission()
    if change == "hash":
        body["payload"]["counting"]["unique_count"] = 20
    elif change == "metrics":
        body["entries"] = 0
    elif change == "period":
        body["period"] = "September 2026"
    else:
        body["payload"]["metrics"]["unique"] = 20
    with pytest.raises(ValidationError):
        DesktopReportSubmissionIngest.model_validate(body)


def test_month_visitor_total_and_legitimate_departures_are_not_clamped():
    body = submission()
    snapshot = body["payload"]["counting"]
    snapshot.update(entries=1, exits=4, movement_state="partial")
    snapshot["snapshot_version"] = snapshot_digest(snapshot)
    body.update(entries=1, exits=4)
    body["payload"]["metrics"].update(entries=1, exits=4)
    report = DesktopReportSubmissionIngest.model_validate(body)
    assert report.exits == 4
    assert complete_sum([1, 3]) == 4
    assert complete_sum([0, 0]) == 0
    assert complete_sum([5, None]) is None


def test_report_ingest_requires_a_versioned_establishment_snapshot():
    body = submission()
    del body["payload"]["counting"]
    with pytest.raises(ValidationError, match="counting snapshot is required"):
        DesktopReportSubmissionIngest.model_validate(body)


@pytest.mark.parametrize("mode", ["entrance-exit", "mixed"])
def test_actual_doorway_and_mixed_snapshots_keep_one_baseline_and_more_departures(mode):
    saved = json.loads((FIXTURE.parent / f"{mode}-establishment-report.json").read_text())
    report = DesktopReportSubmissionIngest.model_validate(
        dict(
            submissionId=saved["submission_id"],
            reportId=saved["report_id"],
            period=saved["period"],
            submittedAt=saved["submitted_at"],
            entries=saved["entries"],
            exits=saved["exits"],
            peakOccupancy=saved["peak_occupancy"],
            uniqueCount=saved["unique_count"],
            payload=saved["payload"],
        )
    )
    assert report.uniqueCount == 2
    assert report.entries == 3
    assert report.exits == 4
    if mode == "mixed":
        assert (
            sum(item["unique_count"] for item in report.payload["counting"]["source_breakdown"])
            == 4
        )
        assert report.uniqueCount != 4
