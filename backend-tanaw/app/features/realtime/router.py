from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from datetime import UTC, datetime

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.core.websocket_auth import receive_websocket_bearer_token
from app.db.session import AsyncSessionLocal
from app.features.accounts.dependencies import is_token_invalidated
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import get_account_by_id
from app.features.realtime.constants import REALTIME_HEARTBEAT_SECONDS
from app.features.realtime.contracts import RealtimeHeartbeat, RealtimeReady
from app.features.realtime.manager import RealtimeIdentity, realtime_manager
from app.features.realtime.models import RealtimeOutbox

router = APIRouter(prefix="/realtime", tags=["realtime"])


@router.websocket("/ws")
async def realtime_websocket(websocket: WebSocket) -> None:
    token = await receive_websocket_bearer_token(websocket, None)
    if token is None:
        return
    async with AsyncSessionLocal() as db:
        account = await authenticate_websocket_account(db, token)
        latest_sequence = int(
            await db.scalar(select(func.coalesce(func.max(RealtimeOutbox.sequence), 0))) or 0
        )
    if account is None:
        await websocket.close(code=4401)
        return

    profile = account.enterprise_profile
    identity = RealtimeIdentity(
        account_id=account.id,
        role=account.role.value,
        enterprise_account_id=account.id if account.role == AccountRole.ENTERPRISE else None,
        enterprise_id=profile.enterprise_id if profile is not None else None,
    )
    await realtime_manager.connect(websocket, identity)
    await realtime_manager.send_protocol(
        websocket,
        RealtimeReady(
            latest_sequence=latest_sequence,
            heartbeat_seconds=REALTIME_HEARTBEAT_SECONDS,
        ).model_dump(mode="json"),
    )

    receive_task: asyncio.Task[str] | None = asyncio.create_task(websocket.receive_text())
    missed_heartbeats = 0
    try:
        while True:
            if receive_task is None:
                return
            active_receive_task = receive_task
            completed, _ = await asyncio.wait(
                {active_receive_task},
                timeout=REALTIME_HEARTBEAT_SECONDS,
            )
            if completed:
                try:
                    message = active_receive_task.result()
                finally:
                    receive_task = None
                receive_task = asyncio.create_task(websocket.receive_text())
                missed_heartbeats = 0
                if _is_ping(message):
                    await realtime_manager.send_protocol(
                        websocket,
                        RealtimeHeartbeat(occurred_at=datetime.now(UTC)).model_dump(mode="json"),
                    )
            else:
                missed_heartbeats += 1
                if missed_heartbeats >= 2:
                    await realtime_manager.disconnect(
                        websocket,
                        close_code=1013,
                        reason="heartbeat_timeout",
                    )
                    return
                await realtime_manager.send_protocol(
                    websocket,
                    RealtimeHeartbeat(occurred_at=datetime.now(UTC)).model_dump(mode="json"),
                )

            async with AsyncSessionLocal() as db:
                current_account = await authenticate_websocket_account(db, token)
            if (
                current_account is None
                or current_account.id != account.id
                or current_account.role != account.role
            ):
                await realtime_manager.disconnect(
                    websocket,
                    close_code=4401,
                    reason="session_invalidated",
                )
                return
    except WebSocketDisconnect:
        pass
    finally:
        if receive_task is not None:
            receive_task.cancel()
            with suppress(asyncio.CancelledError, WebSocketDisconnect):
                await receive_task
        await realtime_manager.disconnect(websocket, reason="client_disconnected")


def _is_ping(message: str) -> bool:
    if message == "ping":
        return True
    try:
        parsed = json.loads(message)
    except json.JSONDecodeError:
        return False
    return isinstance(parsed, dict) and parsed.get("type") in {
        "realtime.ping",
        "realtime.pong",
    }


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
