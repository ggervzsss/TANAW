from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import get_current_operational_account
from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.schemas import (
    ActivityLogCreate,
    ActivityLogPurgeResponse,
    ActivityLogSummary,
)
from app.features.activity_logs.service import (
    create_activity_log,
    get_activity_log_retention_days,
    get_actor_role_label,
    list_activity_logs_for_account,
    purge_expired_activity_logs,
)

router = APIRouter(prefix="/activity-logs", tags=["activity-logs"])


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


@router.post("/purge-expired", response_model=ActivityLogPurgeResponse)
async def purge_expired_logs(
    account: Annotated[Account, Depends(get_current_operational_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ActivityLogPurgeResponse:
    if account.role != AccountRole.IT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="IT Personnel access required.",
        )

    retention_days = await get_activity_log_retention_days(db)
    deleted_count = await purge_expired_activity_logs(db, retention_days)
    await create_activity_log(
        db,
        ActivityLogCreate(
            category="IT Activity",
            severity="Warning" if deleted_count else "Info",
            actor=account.display_name,
            actorRole=get_actor_role_label(account),  # type: ignore[arg-type]
            action="Delete Old Activity",
            target="System Activity",
            summary=(
                f"{account.display_name} deleted {deleted_count} activity records older than "
                f"{retention_days} days."
            ),
            sourceId="activity-log-purge",
            metadata={"deletedCount": deleted_count, "retentionDays": retention_days},
        ),
    )
    return ActivityLogPurgeResponse(deletedCount=deleted_count, retentionDays=retention_days)


@router.post("", response_model=ActivityLogSummary, status_code=status.HTTP_201_CREATED)
async def record_activity_log(
    payload: ActivityLogCreate,
    account: Annotated[Account, Depends(get_current_operational_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ActivityLogSummary:
    if account.role == AccountRole.STAFF and payload.category not in {
        "Staff Submission",
        "Staff Operation",
    }:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff accounts can only record staff reporting activity.",
        )
    if account.role == AccountRole.ENTERPRISE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enterprise accounts cannot record working logs.",
        )

    log = await create_activity_log(
        db,
        ActivityLogCreate(
            **payload.model_dump(exclude={"actor", "actorRole"}),
            actor=account.display_name,
            actorRole=get_actor_role_label(account),  # type: ignore[arg-type]
        ),
    )
    return log
