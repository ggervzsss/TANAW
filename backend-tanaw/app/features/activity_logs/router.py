from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.keyset_pagination import ReadCursorError
from app.db.session import get_db
from app.features.accounts.dependencies import get_current_operational_account
from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.schemas import (
    ActivityLogCreate,
    ActivityLogPage,
    ActivityLogPurgeResponse,
)
from app.features.activity_logs.service import (
    create_activity_log,
    get_activity_log_retention_days,
    get_actor_role_label,
    list_activity_logs_for_account,
    purge_expired_activity_logs,
)

router = APIRouter(prefix="/activity-logs", tags=["activity-logs"])


@router.get("", response_model=ActivityLogPage)
async def list_activity_logs(
    account: Annotated[Account, Depends(get_current_operational_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
) -> ActivityLogPage:
    try:
        return await list_activity_logs_for_account(db, account, limit=limit, cursor=cursor)
    except ReadCursorError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


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
            action="Purge Expired Activity Logs",
            target="System Logs",
            summary=(
                f"{account.display_name} purged {deleted_count} activity logs older than "
                f"{retention_days} days."
            ),
            sourceId="activity-log-purge",
            metadata={"deletedCount": deleted_count, "retentionDays": retention_days},
        ),
        actor_account_id=account.id,
    )
    await db.commit()
    return ActivityLogPurgeResponse(deletedCount=deleted_count, retentionDays=retention_days)
