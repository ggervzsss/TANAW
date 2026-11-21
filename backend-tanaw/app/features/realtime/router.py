from __future__ import annotations

import asyncio
import json
import time
from contextlib import suppress
from datetime import UTC, datetime

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketState

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

    await _serve_connection(websocket, token, account)


async def _serve_connection(websocket: WebSocket, token: str, account: Account) -> None:
    """Keep one authenticated socket alive on a server-controlled schedule.

    Every REALTIME_HEARTBEAT_SECONDS the server re-validates the session with one
    account lookup and then sends a heartbeat. Client messages only refresh
    liveness: a pong acknowledges the heartbeat and ends that exchange, and a
    ping gets a heartbeat reply, so neither triggers an account lookup or moves
    the next scheduled check. The socket closes when the access token expires,
    when the scheduled check finds the session invalid, or when the client has
    been silent for two heartbeat intervals.
    """
    loop = asyncio.get_running_loop()
    interval = REALTIME_HEARTBEAT_SECONDS
    last_message_at = loop.time()
    next_check_at = last_message_at + interval
    session_expires_at = _session_expiry_deadline(token, loop.time())
    receive_task: asyncio.Task[str] | None = asyncio.create_task(_receive_text(websocket))
    try:
        while True:
            if receive_task is None:
                return
            active_receive_task = receive_task
            wake_at = (
                next_check_at
                if session_expires_at is None
                else min(next_check_at, session_expires_at)
            )
            completed, _ = await asyncio.wait(
                {active_receive_task},
                timeout=max(0.0, wake_at - loop.time()),
            )
            if completed:
                try:
                    message = active_receive_task.result()
                finally:
                    receive_task = None
                receive_task = asyncio.create_task(_receive_text(websocket))
                last_message_at = loop.time()
                if _is_ping(message):
                    await _send_heartbeat(websocket)

            # Checked after every wake-up, so a stream of client messages cannot
            # postpone expiry, validation, or the heartbeat.
            now = loop.time()
            if session_expires_at is not None and now >= session_expires_at:
                await realtime_manager.disconnect(
                    websocket,
                    close_code=4401,
                    reason="session_expired",
                )
                return
            if now < next_check_at:
                continue
            if now - last_message_at >= 2 * interval:
                await realtime_manager.disconnect(
                    websocket,
                    close_code=1013,
                    reason="heartbeat_timeout",
                )
                return
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
            await _send_heartbeat(websocket)
            next_check_at += interval
            if next_check_at <= now:
                # The event loop stalled past a whole interval; resume the cadence
                # from now instead of running the missed checks back to back.
                next_check_at = now + interval
    except WebSocketDisconnect:
        pass
    finally:
        if receive_task is not None:
            receive_task.cancel()
            with suppress(asyncio.CancelledError, WebSocketDisconnect):
                await receive_task
        await realtime_manager.disconnect(websocket, reason="client_disconnected")


async def _send_heartbeat(websocket: WebSocket) -> None:
    await realtime_manager.send_protocol(
        websocket,
        RealtimeHeartbeat(occurred_at=datetime.now(UTC)).model_dump(mode="json"),
    )


def _session_expiry_deadline(token: str, now: float) -> float | None:
    """Return the event-loop time at which the access token expires, if it says.

    The token was already verified during authentication, so this only lets the
    socket close at expiry without waiting for the next scheduled account check.
    """
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        return now
    except jwt.PyJWTError:
        return None
    expires_at = payload.get("exp")
    if not isinstance(expires_at, int | float):
        return None
    return now + max(0.0, float(expires_at) - time.time())


async def _receive_text(websocket: WebSocket) -> str:
    try:
        return await websocket.receive_text()
    except RuntimeError:
        # The sender or connection manager can close the socket before this task runs.
        if websocket.application_state is not WebSocketState.DISCONNECTED:
            raise
        raise WebSocketDisconnect from None


def _is_ping(message: str) -> bool:
    if message == "ping":
        return True
    try:
        parsed = json.loads(message)
    except json.JSONDecodeError:
        return False
    # A realtime.pong only acknowledges a server heartbeat. Answering it with
    # another heartbeat made every idle client loop as fast as the network allowed.
    return isinstance(parsed, dict) and parsed.get("type") == "realtime.ping"


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
