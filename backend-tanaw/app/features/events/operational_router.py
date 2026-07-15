import asyncio
from contextlib import suppress
from typing import Annotated

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.client_compatibility import (
    ClientGeneration,
    reject_unsupported_websocket_generation,
)
from app.core.config import get_settings
from app.core.security import decode_access_token
from app.core.websocket_auth import receive_websocket_bearer_token
from app.db.session import AsyncSessionLocal
from app.features.accounts.dependencies import is_token_invalidated
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import get_account_by_id
from app.features.events.operational_websocket import operational_ws_manager
from app.features.topology.account_scope import load_account_topology

router = APIRouter(prefix="/operational", tags=["realtime"])
WEBSOCKET_REAUTH_INTERVAL_SECONDS = 30.0


@router.websocket("/ws")
async def operational_websocket(
    websocket: WebSocket,
    query_token: Annotated[str | None, Query(alias="token")] = None,
    client_name: Annotated[str | None, Query(alias="client")] = None,
    client_version: Annotated[str | None, Query(alias="clientVersion")] = None,
    contract_version: Annotated[str | None, Query(alias="contractVersion")] = None,
    release_id: Annotated[str | None, Query(alias="releaseId")] = None,
) -> None:
    if await reject_unsupported_websocket_generation(
        websocket,
        ClientGeneration(client_name, client_version, contract_version, release_id),
        get_settings(),
    ):
        return
    token = await receive_websocket_bearer_token(websocket, query_token)
    if token is None:
        return

    async with AsyncSessionLocal() as db:
        account = await authenticate_websocket_account(db, token)
        account_topology = (
            await load_account_topology(db, account)
            if account is not None and account.role == AccountRole.ENTERPRISE
            else None
        )
        topology_membership = account_topology.membership if account_topology is not None else None

    if account is None:
        await websocket.close(code=1008)
        return
    if account.role == AccountRole.ENTERPRISE and topology_membership is None:
        await websocket.close(code=1008)
        return

    await operational_ws_manager.connect(
        websocket,
        account.role.value,
        account.id,
        topology_enterprise_id=(
            topology_membership.enterprise_id if topology_membership is not None else None
        ),
        classification=(
            topology_membership.classification if topology_membership is not None else None
        ),
    )
    receive_task: asyncio.Task[str] | None = asyncio.create_task(websocket.receive_text())
    try:
        while True:
            if receive_task is None:
                raise RuntimeError("WebSocket receive task is unavailable.")
            active_receive_task = receive_task
            completed, _ = await asyncio.wait(
                {active_receive_task}, timeout=WEBSOCKET_REAUTH_INTERVAL_SECONDS
            )
            if not completed:
                message = None
            else:
                try:
                    message = active_receive_task.result()
                finally:
                    receive_task = None
                receive_task = asyncio.create_task(websocket.receive_text())
            async with AsyncSessionLocal() as db:
                current_account = await authenticate_websocket_account(db, token)
                current_topology = (
                    await load_account_topology(db, current_account)
                    if current_account is not None
                    and current_account.role == AccountRole.ENTERPRISE
                    else None
                )
                current_membership = (
                    current_topology.membership if current_topology is not None else None
                )
            if current_account is None:
                await websocket.close(code=1008)
                return
            if current_account.id != account.id or current_account.role != account.role:
                await websocket.close(code=1008)
                return
            if account.role == AccountRole.ENTERPRISE and (
                topology_membership is None
                or current_membership is None
                or current_membership.id != topology_membership.id
                or current_membership.enterprise_id != topology_membership.enterprise_id
                or current_membership.classification != topology_membership.classification
            ):
                await websocket.close(code=1008)
                return
            if message == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        if receive_task is not None:
            receive_task.cancel()
            with suppress(asyncio.CancelledError, WebSocketDisconnect):
                await receive_task
        operational_ws_manager.disconnect(websocket, account.role.value)


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
