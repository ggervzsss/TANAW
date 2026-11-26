from collections.abc import Sequence
from typing import cast

from app.features.reporting.errors import DuplicateReportPeriodError, InvalidReportWorkflowError
from app.features.reporting.models import EnterpriseReportSubmission
from app.features.reporting.periods import reporting_period_key
from app.features.reporting.schemas import (
    FinalReportArchivedFromStatus,
)

FINAL_REPORT_ARCHIVED_STATUS = "Archived"
FINAL_REPORT_RESTORABLE_STATUSES = {"Draft", "Finalized"}


def resolve_final_report_status_transition(
    *, current_status: str, current_archived_from_status: str | None, requested_status: str
) -> tuple[str, str | None]:
    if requested_status == FINAL_REPORT_ARCHIVED_STATUS:
        if current_status == FINAL_REPORT_ARCHIVED_STATUS:
            return FINAL_REPORT_ARCHIVED_STATUS, restore_target_status(current_archived_from_status)
        archived_from_status = (
            current_status if current_status in FINAL_REPORT_RESTORABLE_STATUSES else "Finalized"
        )
        return FINAL_REPORT_ARCHIVED_STATUS, archived_from_status

    if current_status == FINAL_REPORT_ARCHIVED_STATUS and requested_status == "Draft":
        return restore_target_status(current_archived_from_status), None

    return requested_status, None


def restore_target_status(archived_from_status: str | None) -> str:
    return (
        archived_from_status
        if archived_from_status in FINAL_REPORT_RESTORABLE_STATUSES
        else "Finalized"
    )


def to_final_report_archived_from_status(
    archived_from_status: str | None,
) -> FinalReportArchivedFromStatus | None:
    if archived_from_status in FINAL_REPORT_RESTORABLE_STATUSES:
        return cast(FinalReportArchivedFromStatus, archived_from_status)
    return None


def final_report_period(reports: Sequence[EnterpriseReportSubmission]) -> str:
    return reports[0].period


def validate_report_review_transition(current_status: str, requested_status: str) -> None:
    if current_status != "Pending Review":
        raise InvalidReportWorkflowError(
            f"{current_status} reports cannot be changed through intake review actions."
        )
    if requested_status != "Ready to Consolidate":
        raise InvalidReportWorkflowError(
            "Intake review can only accept a pending report as Ready to Consolidate."
        )


def duplicate_report_period_message(period: str) -> str:
    return (
        f"A report for {period} has already been submitted. An enterprise sends one report "
        "per reporting month, and a submitted report cannot be replaced."
    )


def validate_new_report_submission(period: str, *, period_has_report: bool) -> None:
    if period_has_report:
        raise DuplicateReportPeriodError(duplicate_report_period_message(period))


def validate_final_report_sources(reports: Sequence[EnterpriseReportSubmission]) -> None:
    invalid_reports = [
        report.report_id for report in reports if report.review_status != "Ready to Consolidate"
    ]
    if invalid_reports:
        joined_ids = ", ".join(invalid_reports)
        raise InvalidReportWorkflowError(
            f"Only reports marked Ready to Consolidate can be included in a final report: {joined_ids}."
        )

    period_keys = {reporting_period_key(report.period) for report in reports}
    if None in period_keys or len(period_keys) > 1:
        raise InvalidReportWorkflowError("A final report can only include one reporting period.")
