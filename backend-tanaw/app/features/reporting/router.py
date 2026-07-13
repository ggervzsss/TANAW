from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.reporting.envelopes import (
    ReportSubmissionAcknowledgement,
    ReportSubmissionCommand,
)
from app.features.reporting.service import (
    ReportIntakeConflict,
    ReportIntakeError,
    submit_report_command,
)

router = APIRouter(prefix="/operational", tags=["reporting-v2"])

EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]


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
