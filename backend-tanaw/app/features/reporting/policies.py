from collections.abc import Collection, Iterable, Sequence
from typing import cast

from app.features.reporting.errors import (
    DuplicateReportPeriodError,
    InvalidReportWorkflowError,
    ReportAlreadyConsolidatedError,
)
from app.features.reporting.models import EnterpriseReportSubmission
from app.features.reporting.periods import reporting_period_key
from app.features.reporting.schemas import (
    FinalReportArchivedFromStatus,
)

FINAL_REPORT_ARCHIVED_STATUS = "Archived"
FINAL_REPORT_DRAFT_STATUS = "Draft"
FINAL_REPORT_FINALIZED_STATUS = "Finalized"
FINAL_REPORT_RESTORABLE_STATUSES = {FINAL_REPORT_DRAFT_STATUS, FINAL_REPORT_FINALIZED_STATUS}
CONSOLIDATED_REVIEW_STATUS = "Consolidated"


def resolve_final_report_status_transition(
    *, current_status: str, current_archived_from_status: str | None, requested_status: str
) -> tuple[str, str | None]:
    """Archive a report, or restore an archived one to the status it had. Whether a report is a
    Draft or Finalized follows from its month's submissions, so neither can be set by hand."""
    if requested_status == FINAL_REPORT_ARCHIVED_STATUS:
        if current_status == FINAL_REPORT_ARCHIVED_STATUS:
            return FINAL_REPORT_ARCHIVED_STATUS, restore_target_status(current_archived_from_status)
        archived_from_status = (
            current_status
            if current_status in FINAL_REPORT_RESTORABLE_STATUSES
            else FINAL_REPORT_FINALIZED_STATUS
        )
        return FINAL_REPORT_ARCHIVED_STATUS, archived_from_status

    if current_status == FINAL_REPORT_ARCHIVED_STATUS:
        return restore_target_status(current_archived_from_status), None

    if requested_status == current_status:
        return current_status, None

    raise InvalidReportWorkflowError(
        "A consolidated report is finalized by generating it again from Reports once every "
        "enterprise's report for the month is accepted."
    )


def restore_target_status(archived_from_status: str | None) -> str:
    return (
        archived_from_status
        if archived_from_status in FINAL_REPORT_RESTORABLE_STATUSES
        else FINAL_REPORT_FINALIZED_STATUS
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


def validate_final_report_target(period: str, existing_status: str | None) -> None:
    """A month has one consolidated report that is not archived. A Draft takes newly accepted
    reports; a Finalized report is complete and takes no more."""
    if existing_status == FINAL_REPORT_FINALIZED_STATUS:
        raise ReportAlreadyConsolidatedError(
            f"The {period} consolidated report is already final. Archive it before generating "
            "another one."
        )


def final_report_expected_enterprises(
    active_enterprise_ids: Iterable[str], reporting_enterprise_ids: Iterable[str]
) -> set[str]:
    """The enterprises a month's consolidated report waits for: every active enterprise, plus any
    enterprise that sent a report for the month and has since been deactivated."""
    return {*active_enterprise_ids, *reporting_enterprise_ids}


def final_report_consolidation_status(
    *,
    expected_enterprise_ids: Collection[str],
    period_reports: Iterable[tuple[str, str]],
) -> str:
    """Finalized when every expected enterprise sent its report for the month and every report for
    the month is in the consolidated report; a Draft otherwise.

    ``period_reports`` holds each of the month's reports as (enterprise id, review status), with the
    review status as it stands after this consolidation.
    """
    reports = list(period_reports)
    reported = {enterprise_id for enterprise_id, _ in reports}
    complete = (
        bool(reports)
        and set(expected_enterprise_ids) <= reported
        and all(status == CONSOLIDATED_REVIEW_STATUS for _, status in reports)
    )
    return FINAL_REPORT_FINALIZED_STATUS if complete else FINAL_REPORT_DRAFT_STATUS
