from types import SimpleNamespace
from typing import cast

import pytest

from app.features.operational.models import EnterpriseReportSubmission
from app.features.operational.service import (
    InvalidReportWorkflowError,
    validate_final_report_sources,
    validate_report_review_transition,
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


def test_final_report_sources_must_be_ready_and_same_period() -> None:
    ready_report = _report("REP-001", "Ready to Consolidate", "Jun 1 - Jun 30, 2026")
    validate_final_report_sources([ready_report])

    with pytest.raises(InvalidReportWorkflowError):
        validate_final_report_sources(
            [ready_report, _report("REP-002", "Pending Review", "Jun 1 - Jun 30, 2026")]
        )

    with pytest.raises(InvalidReportWorkflowError):
        validate_final_report_sources(
            [
                ready_report,
                _report("REP-003", "Ready to Consolidate", "Jul 1 - Jul 31, 2026"),
            ]
        )


def _report(report_id: str, review_status: str, period: str) -> EnterpriseReportSubmission:
    return cast(
        EnterpriseReportSubmission,
        SimpleNamespace(report_id=report_id, review_status=review_status, period=period),
    )
