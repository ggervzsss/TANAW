from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.features.accounts.dependencies import get_current_operational_account, require_roles
from app.features.accounts.enterprise import (
    enterprise_identifier,
    enterprise_name,
    require_enterprise_profile,
)
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.options import format_enterprise_category
from app.features.activity_logs.service import record_activity_log as record_operational_log
from app.features.notifications.service import (
    STAFF_REPORT_RESUBMITTED_NOTIFICATION,
    STAFF_REPORT_SUBMITTED_NOTIFICATION,
    create_role_notifications,
)
from app.features.reporting.errors import (
    DuplicateReportPeriodError,
    InvalidReportWorkflowError,
)
from app.features.reporting.final_reports import (
    create_final_report,
    return_final_report_for_revision,
    update_final_report_status,
)
from app.features.reporting.final_reports import (
    list_final_reports as list_final_report_records,
)
from app.features.reporting.intake import (
    ingest_report_submission,
    list_intake_reports,
    update_report_status,
)
from app.features.reporting.models import EnterpriseReportSubmission
from app.features.reporting.schemas import (
    DesktopReportSubmissionIngest,
    FinalReportCreate,
    FinalReportRevisionReturn,
    FinalReportStatusUpdate,
    FinalReportSummary,
    IntakeReportSummary,
    ReportStatusUpdate,
    SamplePreparationCounts,
    SamplePreparationSummary,
)
from app.features.sample_data.dataset import prepared_counts, sample_dataset_marker_email

router = APIRouter(prefix="/operational", tags=["reporting"])

OperationalReadAccount = Annotated[
    Account, Depends(require_roles({"admin", "it", "staff", "enterprise"}))
]
EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]
StaffWorkflowAccount = Annotated[Account, Depends(require_roles({"admin", "staff"}))]


@router.post(
    "/desktop/report-submissions",
    response_model=IntakeReportSummary,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_desktop_report_submission(
    payload: DesktopReportSubmissionIngest,
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IntakeReportSummary:
    try:
        report = await ingest_report_submission(db, account, payload)
    except (DuplicateReportPeriodError, InvalidReportWorkflowError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await notify_staff_report_submission(db, account, report)
    await record_operational_log(
        db,
        category="Staff Submission",
        severity="Success",
        actor=enterprise_name(account),
        actor_role="Enterprise Account",
        action="Submit Enterprise Report",
        target=report.enterprise,
        summary=f"{report.enterprise} submitted {report.code} for {report.period}.",
        source_id=report.id,
        metadata={
            "enterpriseId": report.enterpriseId,
            "period": report.period,
            "uniqueCount": report.metrics["unique"],
        },
    )
    return report


@router.get("/desktop/sample-preparation", response_model=SamplePreparationSummary | None)
async def get_desktop_sample_preparation(
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SamplePreparationSummary | None:
    if get_settings().is_production:
        return None
    marker = await db.scalar(
        select(Account.id).where(Account.email == sample_dataset_marker_email())
    )
    if marker is None:
        return None
    enterprise_id = enterprise_identifier(account)
    candidates = prepared_counts(enterprise_id)
    candidate_periods = [str(candidate["period"]) for candidate in candidates]
    submitted_periods = set(
        (
            await db.scalars(
                select(EnterpriseReportSubmission.period).where(
                    EnterpriseReportSubmission.enterprise_profile_id == account.id,
                    EnterpriseReportSubmission.period.in_(candidate_periods),
                )
            )
        ).all()
    )
    pending_counts = [
        SamplePreparationCounts.model_validate(candidate)
        for candidate in candidates
        if candidate["period"] not in submitted_periods
    ]
    return SamplePreparationSummary(
        enterpriseId=enterprise_id,
        enterpriseName=enterprise_name(account),
        counts=pending_counts[0] if pending_counts else None,
        pendingCounts=pending_counts,
    )


@router.get("/reports/intake", response_model=list[IntakeReportSummary])
async def list_intake_report_submissions(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[IntakeReportSummary]:
    return await list_intake_reports(db, account)


@router.patch("/reports/intake/{report_id}/status", response_model=IntakeReportSummary)
async def update_intake_report_status(
    report_id: str,
    payload: ReportStatusUpdate,
    actor: StaffWorkflowAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IntakeReportSummary:
    try:
        report = await update_report_status(db, report_id, payload)
    except InvalidReportWorkflowError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")

    await record_operational_log(
        db,
        category="Staff Operation",
        severity="Warning" if payload.status == "Returned" else "Success",
        actor=actor.display_name,
        actor_role="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
        action=f"Report {payload.status}",
        target=report.enterprise,
        summary=f"{actor.display_name} marked {report.code} from {report.enterprise} as {payload.status}.",
        source_id=report.id,
        metadata={
            "enterpriseId": report.enterpriseId,
            "period": report.period,
            "remarks": payload.remarks,
        },
    )
    return report


@router.get("/reports/final", response_model=list[FinalReportSummary])
async def list_final_report_submissions(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[FinalReportSummary]:
    return await list_final_report_records(db, account)


@router.post(
    "/reports/final", response_model=FinalReportSummary, status_code=status.HTTP_201_CREATED
)
async def generate_final_report(
    payload: FinalReportCreate,
    actor: StaffWorkflowAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FinalReportSummary:
    try:
        final_report = await create_final_report(db, payload)
    except InvalidReportWorkflowError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if final_report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No report submissions were found for consolidation.",
        )

    await record_operational_log(
        db,
        category="Staff Operation",
        severity="Success",
        actor=actor.display_name,
        actor_role="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
        action="Generate Final Report",
        target=final_report.id,
        summary=f"{actor.display_name} generated {final_report.id} from {len(final_report.sources)} ready submissions.",
        source_id=final_report.id,
        metadata={"reportCount": len(final_report.sources), "period": final_report.period},
    )
    return final_report


@router.post("/reports/final/{report_id}/return-revision", response_model=FinalReportSummary)
async def return_final_report_revision(
    report_id: str,
    payload: FinalReportRevisionReturn,
    actor: StaffWorkflowAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FinalReportSummary:
    try:
        final_report = await return_final_report_for_revision(db, report_id, payload)
    except InvalidReportWorkflowError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if final_report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Final report not found.")

    await record_operational_log(
        db,
        category="Staff Operation",
        severity="Warning",
        actor=actor.display_name,
        actor_role="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
        action="Return Final Report for Revision",
        target=final_report.id,
        summary=f"{actor.display_name} returned {final_report.id} for source report revision.",
        source_id=final_report.id,
        metadata={
            "period": final_report.period,
            "sourceReportIds": ",".join(payload.sourceReportIds),
            "remarks": payload.remarks,
        },
    )
    return final_report


@router.patch("/reports/final/{report_id}/status", response_model=FinalReportSummary)
async def update_final_report_workflow_status(
    report_id: str,
    payload: FinalReportStatusUpdate,
    actor: StaffWorkflowAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FinalReportSummary:
    try:
        final_report = await update_final_report_status(db, report_id, payload)
    except InvalidReportWorkflowError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if final_report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Final report not found.")

    await record_operational_log(
        db,
        category="Staff Operation",
        severity="Success",
        actor=actor.display_name,
        actor_role="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
        action=f"Final Report {final_report.status}",
        target=final_report.id,
        summary=f"{actor.display_name} changed final report {final_report.id} to {final_report.status}.",
        source_id=final_report.id,
        metadata={
            "period": final_report.period,
            "status": final_report.status,
            "requestedStatus": payload.status,
            "archivedFromStatus": final_report.archivedFromStatus,
        },
    )
    return final_report


@router.get("/reports/enterprises")
async def list_report_enterprises(
    account: Annotated[Account, Depends(get_current_operational_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
    statement = (
        select(Account)
        .join(Account.enterprise_profile)
        .where(
            Account.role == AccountRole.ENTERPRISE,
            Account.status == AccountStatus.ACTIVE,
            Account.activated_at.is_not(None),
        )
        .order_by(EnterpriseProfile.enterprise_name.asc(), Account.display_name.asc())
    )
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(Account.id == account.id)

    result = await db.scalars(statement)
    return [
        {
            "id": require_enterprise_profile(account).enterprise_id,
            "name": require_enterprise_profile(account).enterprise_name,
            "category": format_enterprise_category(require_enterprise_profile(account).category)
            or "Uncategorized",
            "barangay": require_enterprise_profile(account).barangay or "Unassigned",
            "complianceOwner": require_enterprise_profile(account).manager_name or account.email,
        }
        for account in result
    ]


async def notify_staff_report_submission(
    db: AsyncSession, actor: Account, report: IntakeReportSummary
) -> None:
    is_resubmission = staff_report_notification_is_resubmission(report)
    action_label = "resubmitted" if is_resubmission else "submitted"
    notification_type = (
        STAFF_REPORT_RESUBMITTED_NOTIFICATION
        if is_resubmission
        else STAFF_REPORT_SUBMITTED_NOTIFICATION
    )
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.STAFF],
        title=notification_type,
        message=f"{report.enterprise} {action_label} {report.code} for {report.period}.",
        notification_type=notification_type,
        severity="Info",
        actor=actor,
        source_type="enterprise.report",
        source_id=report.id,
    )


def staff_report_notification_is_resubmission(report: IntakeReportSummary) -> bool:
    payload_status = (report.payload or {}).get("status")
    return isinstance(payload_status, str) and payload_status.strip().lower() == "resubmitted"
