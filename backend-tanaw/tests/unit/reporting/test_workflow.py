from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.features.reporting.errors import InvalidReportWorkflowError
from app.features.reporting.intake import report_demographics_from_payload
from app.features.reporting.models import EnterpriseReportSubmission
from app.features.reporting.periods import (
    reporting_period_key,
    reporting_period_submission_error,
)
from app.features.reporting.policies import (
    resolve_final_report_status_transition,
    validate_final_report_revision_return,
    validate_final_report_sources,
    validate_new_report_submission,
    validate_report_resubmission,
    validate_report_review_transition,
)
from app.features.reporting.schemas import (
    DesktopReportSubmissionIngest,
    FinalReportCreate,
)


def test_pending_report_can_be_accepted_or_returned() -> None:
    validate_report_review_transition("Pending Review", "Ready to Consolidate")
    validate_report_review_transition("Pending Review", "Returned")


@pytest.mark.parametrize("current_status", ["Ready to Consolidate", "Returned", "Consolidated"])
def test_non_pending_report_cannot_be_changed_by_review_action(current_status: str) -> None:
    with pytest.raises(InvalidReportWorkflowError):
        validate_report_review_transition(current_status, "Returned")


def test_consolidated_status_is_not_a_direct_review_action() -> None:
    with pytest.raises(InvalidReportWorkflowError):
        validate_report_review_transition("Pending Review", "Consolidated")


def test_enterprise_submission_changes_require_the_return_resubmission_workflow() -> None:
    validate_new_report_submission("Submitted")
    validate_report_resubmission("Returned", "Resubmitted")

    with pytest.raises(InvalidReportWorkflowError):
        validate_new_report_submission("Resubmitted")
    with pytest.raises(InvalidReportWorkflowError):
        validate_report_resubmission("Pending Review", "Resubmitted")
    with pytest.raises(InvalidReportWorkflowError):
        validate_report_resubmission("Returned", "Submitted")


def test_final_report_source_ids_must_be_unique() -> None:
    with pytest.raises(ValidationError, match="Report IDs must be unique"):
        FinalReportCreate(reportIds=["report-1", "report-1"], preparedBy="Staff User")


def test_final_report_sources_must_be_ready_and_same_period() -> None:
    ready_report = _report("REP-001", "Ready to Consolidate", "June 2026")
    validate_final_report_sources(
        [ready_report, _report("REP-002", "Ready to Consolidate", "June 2026")]
    )

    with pytest.raises(InvalidReportWorkflowError):
        validate_final_report_sources(
            [ready_report, _report("REP-003", "Pending Review", "June 2026")]
        )

    with pytest.raises(InvalidReportWorkflowError):
        validate_final_report_sources(
            [
                ready_report,
                _report("REP-004", "Ready to Consolidate", "July 2026"),
            ]
        )


def test_reporting_period_has_canonical_key() -> None:
    assert reporting_period_key("June 2026") == "2026-06"
    assert reporting_period_key("Jun 1 - Jun 30, 2026") is None


def test_final_report_revision_return_requires_draft_and_owned_sources() -> None:
    validate_final_report_revision_return("Draft", {"source-1", "source-2"}, {"source-1"})

    with pytest.raises(InvalidReportWorkflowError):
        validate_final_report_revision_return("Finalized", {"source-1"}, {"source-1"})

    with pytest.raises(InvalidReportWorkflowError):
        validate_final_report_revision_return("Draft", {"source-1"}, {"source-2"})


def test_returned_final_report_can_be_archived_and_restored() -> None:
    assert resolve_final_report_status_transition(
        current_status="Returned for Revision",
        current_archived_from_status=None,
        requested_status="Archived",
    ) == ("Archived", "Returned for Revision")
    assert resolve_final_report_status_transition(
        current_status="Archived",
        current_archived_from_status="Returned for Revision",
        requested_status="Returned for Revision",
    ) == ("Returned for Revision", None)


def test_desktop_resubmission_uses_payload_metrics_for_demographic_validation() -> None:
    payload = DesktopReportSubmissionIngest(
        submissionId=uuid4(),
        reportId="REP-963735",
        period="June 2026",
        submittedAt=datetime(2026, 7, 5, 8, 43, 12, tzinfo=UTC),
        entries=747,
        exits=702,
        peakOccupancy=61,
        uniqueCount=532,
        payload={
            "demo": {
                "foreignFemale": "37",
                "foreignMale": "42",
                "otherProvFemale": "68",
                "otherProvMale": "74",
                "thisProvFemale": "149",
                "thisProvMale": "155",
            },
            "metrics": {
                "entries": 660,
                "exits": 625,
                "peak": 58,
                "unique": 525,
            },
            "status": "Resubmitted",
        },
    )

    assert payload.entries == 660
    assert payload.exits == 625
    assert payload.peakOccupancy == 58
    assert payload.uniqueCount == 525
    assert payload.period == "June 2026"


def test_report_demographics_preserve_submitted_breakdown() -> None:
    demographics = report_demographics_from_payload(
        {
            "demo": {
                "foreignFemale": "27",
                "foreignMale": "27",
                "otherProvFemale": "80",
                "otherProvMale": "81",
                "thisProvFemale": "161",
                "thisProvMale": "161",
            }
        },
        537,
    )

    assert demographics is not None
    assert demographics.model_dump() == {
        "foreignFemale": 27,
        "foreignMale": 27,
        "otherProvFemale": 80,
        "otherProvMale": 81,
        "thisProvFemale": 161,
        "thisProvMale": 161,
    }


def test_report_demographics_reject_mismatched_totals() -> None:
    assert (
        report_demographics_from_payload(
            {
                "demo": {
                    "foreignFemale": "1",
                    "foreignMale": "1",
                    "otherProvFemale": "1",
                    "otherProvMale": "1",
                    "thisProvFemale": "1",
                    "thisProvMale": "1",
                }
            },
            7,
        )
        is None
    )


def test_desktop_submission_rejects_open_reporting_period() -> None:
    with pytest.raises(ValueError, match="Submission opens on Aug 1, 2026"):
        DesktopReportSubmissionIngest(
            submissionId=uuid4(),
            reportId="REP-260701",
            period="July 2026",
            submittedAt=datetime(2026, 7, 15, 8, 0, tzinfo=UTC),
            entries=10,
            exits=4,
            peakOccupancy=6,
            uniqueCount=6,
            payload={
                "demo": {
                    "foreignFemale": "1",
                    "foreignMale": "1",
                    "otherProvFemale": "1",
                    "otherProvMale": "1",
                    "thisProvFemale": "1",
                    "thisProvMale": "1",
                },
                "metrics": {
                    "entries": 10,
                    "exits": 4,
                    "peak": 6,
                    "unique": 6,
                },
                "status": "Submitted",
            },
        )


def test_reporting_period_submission_opens_on_next_manila_month() -> None:
    assert reporting_period_submission_error("July 2026", datetime(2026, 7, 31, 15, 59, tzinfo=UTC))
    assert (
        reporting_period_submission_error("July 2026", datetime(2026, 7, 31, 16, 0, tzinfo=UTC))
        is None
    )


def test_desktop_submission_rejects_noncanonical_period_format() -> None:
    with pytest.raises(ValueError, match="Month YYYY"):
        DesktopReportSubmissionIngest(
            submissionId=uuid4(),
            reportId="REP-260601",
            period="Jun 1 - Jun 30, 2026",
            submittedAt=datetime(2026, 7, 1, 0, 0, tzinfo=UTC),
            payload={"demo": {}},
        )


def _report(report_id: str, review_status: str, period: str) -> EnterpriseReportSubmission:
    return cast(
        EnterpriseReportSubmission,
        SimpleNamespace(report_id=report_id, review_status=review_status, period=period),
    )
