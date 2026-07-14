from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.reporting.envelopes import (
    ReportSubmissionAcknowledgement,
    ReportSubmissionCommand,
)
from app.features.reporting.obligation_envelopes import (
    ObligationFreezeAcknowledgement,
    ObligationFreezeCommand,
    PeriodComplianceResource,
    ReminderIntentAcknowledgement,
    ReminderIntentCommand,
)
from app.features.reporting.obligations import (
    ObligationConflict,
    ObligationError,
    ObligationNotFound,
    create_reminder_intents,
    freeze_period_obligations,
    read_period_compliance,
)
from app.features.reporting.period_envelopes import (
    ReportingPeriodDiscoveryResource,
    ReportingPeriodLifecycleResult,
    ReportingPeriodPage,
    ReportingPeriodStatus,
)
from app.features.reporting.periods import (
    ReportingPeriodError,
    ReportingPeriodForbidden,
    ReportingPeriodInvalidCursor,
    ReportingPeriodNotFound,
    list_reporting_periods,
    read_reporting_period,
    run_reporting_period_lifecycle,
)
from app.features.reporting.read_envelopes import (
    EnterpriseReportDetail,
    EnterpriseReportPage,
    ReportWorkflowState,
)
from app.features.reporting.read_service import (
    ReportReadForbidden,
    ReportReadInvalidCursor,
    ReportReadNotFound,
    list_official_enterprise_reports,
    list_owned_enterprise_reports,
    read_official_enterprise_report,
    read_owned_enterprise_report,
)
from app.features.reporting.service import (
    ReportIntakeConflict,
    ReportIntakeError,
    submit_report_command,
)
from app.features.reporting.workflow import transition_report
from app.features.reporting.workflow_envelopes import (
    ReportTransitionAcknowledgement,
    ReportTransitionCommand,
)

router = APIRouter(prefix="/operational", tags=["reporting-v2"])

EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]
StaffAccount = Annotated[Account, Depends(require_roles({"staff"}))]
ComplianceReadAccount = Annotated[
    Account,
    Depends(require_roles({"staff", "admin", "enterprise"})),
]


@router.get("/reporting-periods/v2", response_model=ReportingPeriodPage)
async def list_reporting_periods_v2(
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
    periodStatus: ReportingPeriodStatus | None = None,
) -> ReportingPeriodPage:
    try:
        return await list_reporting_periods(
            db,
            account=account,
            limit=limit,
            cursor=cursor,
            period_status=periodStatus,
        )
    except ReportingPeriodInvalidCursor as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ReportingPeriodForbidden as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ReportingPeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get(
    "/reporting-periods/{reporting_period_id}/v2",
    response_model=ReportingPeriodDiscoveryResource,
)
async def read_reporting_period_v2(
    reporting_period_id: UUID,
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportingPeriodDiscoveryResource:
    try:
        return await read_reporting_period(
            db,
            account=account,
            reporting_period_id=reporting_period_id,
        )
    except ReportingPeriodNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ReportingPeriodForbidden as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.post(
    "/reporting-periods/lifecycle/run/v2",
    response_model=ReportingPeriodLifecycleResult,
)
async def run_reporting_period_lifecycle_v2(
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportingPeriodLifecycleResult:
    try:
        result = await run_reporting_period_lifecycle(db, account=account)
        await db.commit()
        return result
    except ReportingPeriodForbidden as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ObligationNotFound as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ObligationConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except (ObligationError, ReportingPeriodError) as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get("/reports/v2", response_model=EnterpriseReportPage)
async def list_enterprise_reports_v2(
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
    reportingPeriodId: UUID | None = None,
    workflowState: ReportWorkflowState | None = None,
    enterpriseId: UUID | None = None,
    siteId: UUID | None = None,
) -> EnterpriseReportPage:
    try:
        return await list_official_enterprise_reports(
            db,
            account=account,
            limit=limit,
            cursor=cursor,
            reporting_period_id=reportingPeriodId,
            workflow_state=workflowState,
            enterprise_id=enterpriseId,
            site_id=siteId,
        )
    except ReportReadForbidden as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ReportReadInvalidCursor as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get("/reports/{enterprise_report_id}/v2", response_model=EnterpriseReportDetail)
async def read_enterprise_report_v2(
    enterprise_report_id: UUID,
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EnterpriseReportDetail:
    try:
        return await read_official_enterprise_report(
            db,
            account=account,
            enterprise_report_id=enterprise_report_id,
        )
    except ReportReadForbidden as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ReportReadNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get("/enterprise/reports/v2", response_model=EnterpriseReportPage)
async def list_owned_enterprise_reports_v2(
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
    reportingPeriodId: UUID | None = None,
    workflowState: ReportWorkflowState | None = None,
) -> EnterpriseReportPage:
    try:
        return await list_owned_enterprise_reports(
            db,
            account=account,
            limit=limit,
            cursor=cursor,
            reporting_period_id=reportingPeriodId,
            workflow_state=workflowState,
        )
    except ReportReadForbidden as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ReportReadInvalidCursor as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get(
    "/enterprise/reports/{enterprise_report_id}/v2",
    response_model=EnterpriseReportDetail,
)
async def read_owned_enterprise_report_v2(
    enterprise_report_id: UUID,
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EnterpriseReportDetail:
    try:
        return await read_owned_enterprise_report(
            db,
            account=account,
            enterprise_report_id=enterprise_report_id,
        )
    except ReportReadForbidden as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ReportReadNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.post(
    "/desktop/report-submissions/v2",
    response_model=ReportSubmissionAcknowledgement,
)
async def ingest_report_submission_v2(
    command: ReportSubmissionCommand,
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportSubmissionAcknowledgement:
    try:
        acknowledgement = await submit_report_command(
            db,
            account=account,
            command=command,
        )
        await db.commit()
        return acknowledgement
    except ReportIntakeConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ReportIntakeError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.post(
    "/reports/{enterprise_report_id}/transitions/v2",
    response_model=ReportTransitionAcknowledgement,
)
async def transition_enterprise_report_v2(
    enterprise_report_id: UUID,
    command: ReportTransitionCommand,
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportTransitionAcknowledgement:
    try:
        acknowledgement = await transition_report(
            db,
            account=account,
            enterprise_report_id=enterprise_report_id,
            command=command,
        )
        await db.commit()
        return acknowledgement
    except ReportIntakeConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ReportIntakeError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.post(
    "/reporting-periods/{reporting_period_id}/obligations/freeze/v2",
    response_model=ObligationFreezeAcknowledgement,
)
async def freeze_reporting_period_obligations_v2(
    reporting_period_id: UUID,
    command: ObligationFreezeCommand,
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ObligationFreezeAcknowledgement:
    try:
        acknowledgement = await freeze_period_obligations(
            db,
            account=account,
            reporting_period_id=reporting_period_id,
            command=command,
        )
        await db.commit()
        return acknowledgement
    except ObligationNotFound as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ObligationConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ObligationError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get(
    "/reporting-periods/{reporting_period_id}/compliance/v2",
    response_model=PeriodComplianceResource,
)
async def read_reporting_period_compliance_v2(
    reporting_period_id: UUID,
    account: ComplianceReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PeriodComplianceResource:
    try:
        return await read_period_compliance(
            db,
            account=account,
            reporting_period_id=reporting_period_id,
        )
    except ObligationNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ObligationConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ObligationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.post(
    "/reporting-periods/{reporting_period_id}/reminder-intents/v2",
    response_model=ReminderIntentAcknowledgement,
)
async def create_reporting_period_reminder_intents_v2(
    reporting_period_id: UUID,
    command: ReminderIntentCommand,
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReminderIntentAcknowledgement:
    try:
        acknowledgement = await create_reminder_intents(
            db,
            account=account,
            reporting_period_id=reporting_period_id,
            command=command,
        )
        await db.commit()
        return acknowledgement
    except ObligationNotFound as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ObligationConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except ObligationError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
