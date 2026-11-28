from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.features.accounts.attractions import attraction_category
from app.features.accounts.dependencies import get_current_operational_account, require_roles
from app.features.accounts.enterprise import (
    enterprise_identifier,
    enterprise_name,
    require_enterprise_profile,
)
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.activity_logs.service import record_activity_log as record_operational_log
from app.features.notifications.service import (
    STAFF_REPORT_SUBMITTED_NOTIFICATION,
    create_role_notifications,
)
from app.features.reporting.errors import (
    DuplicateReportPeriodError,
    InvalidReportWorkflowError,
)
from app.features.reporting.final_reports import (
    FINAL_REPORT_LIST_LIMIT,
    create_final_report,
    update_final_report_status,
)
from app.features.reporting.final_reports import (
    list_final_reports as list_final_report_records,
)
from app.features.reporting.idempotency import (
    claim_report_submission,
    complete_report_submission,
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
        claim = await claim_report_submission(db, account, payload)
        if claim.replay is not None:
            return claim.replay
        report = await ingest_report_submission(db, account, payload)
    except (DuplicateReportPeriodError, InvalidReportWorkflowError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await notify_staff_report_submission(db, account, report)
    await record_operational_log(
        db,
        group="Reports",
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
    await complete_report_submission(db, claim, report)
    return report


@router.get("/desktop/report-submissions", response_model=list[IntakeReportSummary])
async def list_desktop_report_submissions(
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    period: Annotated[
        str | None,
        Query(
            min_length=1,
            max_length=120,
            description="Only this reporting period, for example October 2026.",
        ),
    ] = None,
) -> list[IntakeReportSummary]:
    """The calling enterprise's own reports, newest first: whether each waits for staff review,
    was accepted, or is in a consolidated report."""
    return await list_intake_reports(db, account, period=period)


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
        group="Reports",
        severity="Success",
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
    limit: Annotated[int, Query(ge=1, le=FINAL_REPORT_LIST_LIMIT)] = FINAL_REPORT_LIST_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[FinalReportSummary]:
    return await list_final_report_records(db, account, limit=limit, offset=offset)


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

    added = len(payload.reportIds)
    outcome = "a draft of" if final_report.status == "Draft" else "the final"
    await record_operational_log(
        db,
        group="Reports",
        severity="Success",
        actor=actor.display_name,
        actor_role="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
        action="Generate Final Report",
        target=final_report.id,
        summary=(
            f"{actor.display_name} generated {outcome} {final_report.id} with "
            f"{added} newly accepted {'submission' if added == 1 else 'submissions'} "
            f"({final_report.enterpriseCount} of {final_report.enterpriseTotal} enterprises)."
        ),
        source_id=final_report.id,
        metadata={
            "reportCount": len(final_report.sources),
            "addedReportCount": added,
            "period": final_report.period,
            "status": final_report.status,
            "enterpriseCount": final_report.enterpriseCount,
            "enterpriseTotal": final_report.enterpriseTotal,
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
        group="Reports",
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
    enterprises = []
    for account in result:
        profile = require_enterprise_profile(account)
        enterprises.append(
            {
                "id": profile.enterprise_id,
                "name": profile.enterprise_name,
                "category": attraction_category(
                    profile.attraction_code, profile.attraction_description
                ),
                "barangay": profile.barangay or "Unassigned",
                "complianceOwner": profile.manager_name or account.email,
            }
        )
    return enterprises


async def notify_staff_report_submission(
    db: AsyncSession, actor: Account, report: IntakeReportSummary
) -> None:
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.STAFF],
        title=STAFF_REPORT_SUBMITTED_NOTIFICATION,
        message=f"{report.enterprise} submitted {report.code} for {report.period}.",
        notification_type=STAFF_REPORT_SUBMITTED_NOTIFICATION,
        severity="Info",
        actor=actor,
        source_type="enterprise.report",
        source_id=report.id,
    )
