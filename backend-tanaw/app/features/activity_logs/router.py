from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import get_current_operational_account
from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.schemas import (
    ActivityLogCleanupStatus,
    ActivityLogPurgeResponse,
    ActivityLogSummary,
)
from app.features.activity_logs.service import (
    get_activity_cleanup_status,
    list_activity_logs_for_account,
    purge_old_activity,
)

router = APIRouter(prefix="/activity-logs", tags=["activity-logs"])


def _require_it(account: Account) -> None:
    if account.role != AccountRole.IT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="IT Personnel access required.",
        )


@router.get("", response_model=list[ActivityLogSummary])
async def list_activity_logs(
    account: Annotated[Account, Depends(get_current_operational_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ActivityLogSummary]:
    if account.role not in {AccountRole.ADMIN, AccountRole.IT}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or IT Personnel access required.",
        )
    return await list_activity_logs_for_account(db, account)


@router.get("/cleanup", response_model=ActivityLogCleanupStatus)
async def get_cleanup_status(
    account: Annotated[Account, Depends(get_current_operational_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ActivityLogCleanupStatus:
    _require_it(account)
    return await get_activity_cleanup_status(db)


@router.post("/purge-expired", response_model=ActivityLogPurgeResponse)
async def purge_expired_logs(
    account: Annotated[Account, Depends(get_current_operational_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ActivityLogPurgeResponse:
    _require_it(account)
    deleted_count, retention_days = await purge_old_activity(db, account)
    return ActivityLogPurgeResponse(deletedCount=deleted_count, retentionDays=retention_days)
