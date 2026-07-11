from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.core.websocket_auth import receive_websocket_bearer_token
from app.db.session import AsyncSessionLocal, get_db
from app.features.accounts.dependencies import get_current_operational_account, is_token_invalidated
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import get_account_by_id
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
from app.features.activity_logs.websocket import activity_log_manager

router = APIRouter(prefix="/activity-logs", tags=["activity-logs"])


@router.get("", response_model=list[ActivityLogSummary])
async def list_activity_logs(
    account: Annotated[Account, Depends(get_current_operational_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ActivityLogSummary]:
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
    log = await create_activity_log(
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
    )
    await activity_log_manager.broadcast(log)
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
    await activity_log_manager.broadcast(log)
    return log


@router.websocket("/ws")
async def activity_logs_websocket(
    websocket: WebSocket, query_token: Annotated[str | None, Query(alias="token")] = None
) -> None:
    token = await receive_websocket_bearer_token(websocket, query_token)
    if token is None:
        return

    async with AsyncSessionLocal() as db:
        account = await authenticate_websocket_account(db, token)

    if account is None:
        await websocket.close(code=1008)
        return

    await activity_log_manager.connect(websocket, account.role.value)
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        activity_log_manager.disconnect(websocket, account.role.value)


async def authenticate_websocket_account(db: AsyncSession, token: str) -> Account | None:
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        return None

    account_id = payload.get("sub")
    if not isinstance(account_id, str):
        return None

    account = await get_account_by_id(db, account_id)
    if (
        account is None
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is None
        or is_token_invalidated(payload, account)
    ):
        return None
    return account
