from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.final_reports.envelopes import (
    FinalizationAcknowledgement,
    FinalizeReportsCommand,
)
from app.features.final_reports.service import (
    FinalizationConflict,
    FinalizationError,
    finalize_report_command,
)

router = APIRouter(prefix="/operational", tags=["final-reports-v2"])

StaffAccount = Annotated[Account, Depends(require_roles({"staff"}))]


@router.post(
    "/reports/finalizations/v2",
    response_model=FinalizationAcknowledgement,
)
async def finalize_reports_v2(
    command: FinalizeReportsCommand,
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FinalizationAcknowledgement:
    try:
        acknowledgement = await finalize_report_command(db, account=account, command=command)
        await db.commit()
        return acknowledgement
    except FinalizationConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except FinalizationError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
