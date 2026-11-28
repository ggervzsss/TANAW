from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.features.reporting.errors import (
    DuplicateReportPeriodError,
    InvalidReportWorkflowError,
    ReportAlreadyConsolidatedError,
)
from app.features.reporting.intake import report_demographics_from_payload
from app.features.reporting.models import EnterpriseReportSubmission
from app.features.reporting.periods import (
    reporting_period_key,
    reporting_period_submission_error,
)
from app.features.reporting.policies import (
    final_report_consolidation_status,
    final_report_expected_enterprises,
    resolve_final_report_status_transition,
    validate_final_report_sources,
    validate_final_report_target,
    validate_new_report_submission,
    validate_report_review_transition,
)
from app.features.reporting.schemas import (
    DesktopReportSubmissionIngest,
    FinalReportCreate,
)
from tests.support.counting import counting_snapshot


def test_pending_report_can_be_accepted() -> None:
    validate_report_review_transition("Pending Review", "Ready to Consolidate")


def test_departures_of_previous_period_visitors_are_preserved() -> None:
    report = DesktopReportSubmissionIngest(
        submissionId=uuid4(),
        reportId="REP-CARRYOVER",
        period="June 2026",
        submittedAt=datetime(2026, 7, 2, tzinfo=UTC),
        entries=2,
        exits=5,
        peakOccupancy=5,
        uniqueCount=1,
        payload={
            "counting": counting_snapshot("June 2026", entries=2, exits=5, peak=5, unique=1),
            "demo": {"thisProvMale": "1"},
            "metrics": {
                "entries": 2,
                "exits": 5,
                "peak": 5,
                "unique": 1,
            },
        },
    )
    assert report.exits == 5


@pytest.mark.parametrize("current_status", ["Ready to Consolidate", "Consolidated"])
def test_non_pending_report_cannot_be_changed_by_review_action(current_status: str) -> None:
    with pytest.raises(InvalidReportWorkflowError):
        validate_report_review_transition(current_status, "Ready to Consolidate")


def test_consolidated_status_is_not_a_direct_review_action() -> None:
    with pytest.raises(InvalidReportWorkflowError):
        validate_report_review_transition("Pending Review", "Consolidated")


def test_enterprise_sends_one_report_per_reporting_month() -> None:
    validate_new_report_submission("June 2026", period_has_report=False)

    with pytest.raises(
        DuplicateReportPeriodError,
        match="A report for June 2026 has already been submitted.*one report per reporting month",
    ):
        validate_new_report_submission("June 2026", period_has_report=True)


def test_final_report_source_ids_must_be_unique() -> None:
    with pytest.raises(ValidationError, match="Report IDs must be unique"):
        FinalReportCreate(reportIds=["report-1", "report-1"], preparedBy="Staff User")


def test_final_report_create_needs_reports_or_the_month() -> None:
    with pytest.raises(
        ValidationError, match="at least one accepted report or the reporting month"
    ):
        FinalReportCreate(reportIds=[], preparedBy="Staff User")

    assert FinalReportCreate(preparedBy="Staff User", period="October 2026").reportIds == []


def test_consolidation_is_a_draft_while_an_enterprise_has_not_reported() -> None:
    expected = final_report_expected_enterprises({"a", "b", "c"}, {"a", "b"})
    assert expected == {"a", "b", "c"}
    assert (
        final_report_consolidation_status(
            expected_enterprise_ids=expected,
            period_reports=[("a", "Consolidated"), ("b", "Consolidated")],
        )
        == "Draft"
    )


def test_consolidation_is_a_draft_while_a_sent_report_is_left_out() -> None:
    expected = final_report_expected_enterprises({"a", "b"}, {"a", "b"})
    for left_out in ("Pending Review", "Ready to Consolidate"):
        assert (
            final_report_consolidation_status(
                expected_enterprise_ids=expected,
                period_reports=[("a", "Consolidated"), ("b", left_out)],
            )
            == "Draft"
        )


def test_consolidation_is_finalized_once_every_expected_report_is_included() -> None:
    # A deactivated enterprise that reported still counts, and its report is included.
    expected = final_report_expected_enterprises({"a", "b"}, {"a", "b", "retired"})
    assert (
        final_report_consolidation_status(
            expected_enterprise_ids=expected,
            period_reports=[
                ("a", "Consolidated"),
                ("b", "Consolidated"),
                ("retired", "Consolidated"),
            ],
        )
        == "Finalized"
    )
    assert (
        final_report_consolidation_status(expected_enterprise_ids=set(), period_reports=[])
        == "Draft"
    )


def test_a_month_has_one_open_consolidated_report() -> None:
    validate_final_report_target("October 2026", None)
    validate_final_report_target("October 2026", "Draft")
    with pytest.raises(ReportAlreadyConsolidatedError, match="already final"):
        validate_final_report_target("October 2026", "Finalized")


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


@pytest.mark.parametrize("current_status", ["Draft", "Finalized"])
def test_final_report_can_be_archived_and_restored(current_status: str) -> None:
    assert resolve_final_report_status_transition(
        current_status=current_status,
        current_archived_from_status=None,
        requested_status="Archived",
    ) == ("Archived", current_status)
    assert resolve_final_report_status_transition(
        current_status="Archived",
        current_archived_from_status=current_status,
        requested_status="Draft",
    ) == (current_status, None)


@pytest.mark.parametrize(
    ("current_status", "requested_status"), [("Draft", "Finalized"), ("Finalized", "Draft")]
)
def test_draft_and_final_status_cannot_be_set_by_hand(
    current_status: str, requested_status: str
) -> None:
    with pytest.raises(InvalidReportWorkflowError, match="generating it again from Reports"):
        resolve_final_report_status_transition(
            current_status=current_status,
            current_archived_from_status=None,
            requested_status=requested_status,
        )
    assert resolve_final_report_status_transition(
        current_status=current_status,
        current_archived_from_status=None,
        requested_status=current_status,
    ) == (current_status, None)


def test_desktop_submission_uses_the_frozen_snapshot_for_demographic_validation() -> None:
    payload = DesktopReportSubmissionIngest(
        submissionId=uuid4(),
        reportId="REP-963735",
        period="June 2026",
        submittedAt=datetime(2026, 7, 5, 8, 43, 12, tzinfo=UTC),
        entries=660,
        exits=625,
        peakOccupancy=58,
        uniqueCount=525,
        payload={
            "counting": counting_snapshot("June 2026", entries=660, exits=625, peak=58, unique=525),
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
            "status": "Submitted",
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
        "thisProvUnspecified": 0,
        "thisCityMale": None,
        "thisCityFemale": None,
        "thisCityUnspecified": None,
    }


def test_report_demographics_keep_the_city_split_for_var2m() -> None:
    demo = {
        "foreignFemale": "1",
        "foreignMale": "1",
        "otherProvFemale": "2",
        "otherProvMale": "2",
        "thisProvFemale": "10",
        "thisProvMale": "8",
        "thisProvUnspecified": "4",
        "thisCityFemale": "7",
        "thisCityMale": "6",
        "thisCityUnspecified": "3",
    }

    demographics = report_demographics_from_payload({"demo": demo}, 28)

    assert demographics is not None
    assert (demographics.thisCityMale, demographics.thisCityFemale) == (6, 7)
    assert demographics.thisCityUnspecified == 3


def test_report_demographics_drop_a_city_split_larger_than_the_province() -> None:
    demo = {
        "foreignFemale": "0",
        "foreignMale": "0",
        "otherProvFemale": "0",
        "otherProvMale": "0",
        "thisProvFemale": "5",
        "thisProvMale": "5",
        "thisCityFemale": "6",
        "thisCityMale": "1",
    }

    demographics = report_demographics_from_payload({"demo": demo}, 10)

    assert demographics is not None
    assert demographics.thisProvMale == 5
    assert demographics.thisCityMale is None
    assert demographics.thisCityFemale is None


def test_report_demographics_count_visitors_without_a_recorded_sex() -> None:
    demographics = report_demographics_from_payload(
        {
            "demo": {
                "foreignFemale": "0",
                "foreignMale": "1",
                "otherProvFemale": "2",
                "otherProvMale": "0",
                "thisProvFemale": "1",
                "thisProvMale": "1",
                "thisProvUnspecified": "45",
            }
        },
        50,
    )

    assert demographics is not None
    assert demographics.thisProvUnspecified == 45
    assert report_demographics_from_payload({"demo": {"thisProvUnspecified": "x"}}, 0) is None


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
            entries=0,
            exits=0,
            peakOccupancy=0,
            uniqueCount=0,
            submittedAt=datetime(2026, 7, 1, 0, 0, tzinfo=UTC),
            payload={"demo": {}},
        )


def _report(report_id: str, review_status: str, period: str) -> EnterpriseReportSubmission:
    return cast(
        EnterpriseReportSubmission,
        SimpleNamespace(report_id=report_id, review_status=review_status, period=period),
    )
