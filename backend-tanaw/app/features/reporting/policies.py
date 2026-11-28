import re
from collections.abc import Iterable, Sequence
from typing import Protocol, cast

from app.features.reporting.errors import DuplicateReportPeriodError, InvalidReportWorkflowError
from app.features.reporting.models import REPORT_RETURNED_STATUS, EnterpriseReportSubmission
from app.features.reporting.periods import reporting_period_key
from app.features.reporting.schemas import (
    FinalReportArchivedFromStatus,
)

FINAL_REPORT_ARCHIVED_STATUS = "Archived"
FINAL_REPORT_RESTORABLE_STATUSES = {"Draft", "Finalized"}
RETURNABLE_REVIEW_STATUSES = frozenset({"Pending Review", "Ready to Consolidate"})
# The activity log action written when Staff or an Admin returns a report for correction.
RETURN_REPORT_ACTION = "Return Enterprise Report"
REPORT_CODE_MAX_LENGTH = 80
REPORT_VERSION_SUFFIX = re.compile(r"-v\d+$")


class ReportVersionLike(Protocol):
    """A report version as the API describes it (IntakeReportSummary)."""

    @property
    def enterpriseId(self) -> str: ...

    @property
    def period(self) -> str: ...

    @property
    def version(self) -> int: ...


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
    if requested_status == REPORT_RETURNED_STATUS:
        raise InvalidReportWorkflowError(
            "Return a report for correction with the return action, which records the reason."
        )
    if current_status != "Pending Review":
        raise InvalidReportWorkflowError(
            f"{current_status} reports cannot be changed through intake review actions."
        )
    if requested_status != "Ready to Consolidate":
        raise InvalidReportWorkflowError(
            "Intake review can only accept a pending report as Ready to Consolidate."
        )


def validate_report_return(current_status: str) -> None:
    """Staff can return a report that is waiting for review or accepted, never one already in a
    consolidated report."""
    if current_status in RETURNABLE_REVIEW_STATUSES:
        return
    if current_status == "Consolidated":
        raise InvalidReportWorkflowError(
            "This report is already part of a consolidated report and cannot be returned."
        )
    if current_status == REPORT_RETURNED_STATUS:
        raise InvalidReportWorkflowError(
            "This report was already returned for correction. Wait for the corrected version."
        )
    raise InvalidReportWorkflowError(f"{current_status} reports cannot be returned for correction.")


def duplicate_report_period_message(period: str) -> str:
    return (
        f"A report for {period} has already been submitted. An enterprise sends one report "
        "per reporting month, and a submitted report can only be replaced after LGU staff "
        "return it for correction."
    )


def validate_new_report_submission(period: str, *, latest_review_status: str | None) -> None:
    """A period takes a first report, or a corrected one once staff returned the latest version."""
    if latest_review_status is None or latest_review_status == REPORT_RETURNED_STATUS:
        return
    raise DuplicateReportPeriodError(duplicate_report_period_message(period))


def versioned_report_code(requested_code: str, version: int) -> str:
    """The report code a version stores.

    Version 1 keeps the desktop's report ID. A corrected version keeps the desktop's ID without any
    version suffix it already carries and adds its own: RPT-2026-10-005 (or RPT-2026-10-005-v2)
    sent as version 3 is stored as RPT-2026-10-005-v3, trimmed to fit the 80-character code.
    """
    if version <= 1:
        return requested_code
    suffix = f"-v{version}"
    base = REPORT_VERSION_SUFFIX.sub("", requested_code) or requested_code
    return f"{base[: REPORT_CODE_MAX_LENGTH - len(suffix)]}{suffix}"


def latest_report_versions[T: ReportVersionLike](reports: Iterable[T]) -> list[T]:
    """The latest version of each enterprise's report per period, in the order first seen."""
    latest: dict[tuple[str, str], T] = {}
    for report in reports:
        key = (report.enterpriseId, report.period)
        current = latest.get(key)
        if current is None or report.version > current.version:
            latest[key] = report
    return list(latest.values())


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
