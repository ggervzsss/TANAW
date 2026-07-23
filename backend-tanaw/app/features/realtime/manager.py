from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket

from app.features.realtime.contracts import RealtimeEnvelope

logger = logging.getLogger("uvicorn.error")


@dataclass(frozen=True, slots=True)
class RealtimeIdentity:
    account_id: str
    role: str
    enterprise_account_id: str | None = None
    enterprise_id: str | None = None


@dataclass(slots=True)
class _Connection:
    websocket: WebSocket
    identity: RealtimeIdentity
    queue: asyncio.Queue[dict[str, Any]]
    sender: asyncio.Task[None]


class RealtimeConnectionManager:
    def __init__(self, *, queue_size: int = 256) -> None:
        if queue_size < 8:
            raise ValueError("Realtime client queues must hold at least eight messages.")
        self._queue_size = queue_size
        self._connections: dict[WebSocket, _Connection] = {}
        self._lock = asyncio.Lock()

    @property
    def active_count(self) -> int:
        return len(self._connections)

    def connections_by_role(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for connection in self._connections.values():
            role = connection.identity.role
            counts[role] = counts.get(role, 0) + 1
        return counts

    async def connect(self, websocket: WebSocket, identity: RealtimeIdentity) -> None:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self._queue_size)
        connection = _Connection(
            websocket=websocket,
            identity=identity,
            queue=queue,
            sender=asyncio.create_task(
                self._send_loop(websocket, queue),
                name=f"tanaw-realtime-sender-{identity.account_id}",
            ),
        )
        async with self._lock:
            previous = self._connections.pop(websocket, None)
            self._connections[websocket] = connection
        if previous is not None:
            previous.sender.cancel()
        logger.info(
            "Realtime connected user_id=%s role=%s enterprise_id=%s active_connections=%s",
            identity.account_id,
            identity.role,
            identity.enterprise_id,
            self.active_count,
        )

    async def disconnect(
        self,
        websocket: WebSocket,
        *,
        close_code: int | None = None,
        reason: str = "disconnected",
    ) -> None:
        async with self._lock:
            connection = self._connections.pop(websocket, None)
        if connection is None:
            return
        current_task = asyncio.current_task()
        if connection.sender is not current_task:
            connection.sender.cancel()
            await asyncio.gather(connection.sender, return_exceptions=True)
        if close_code is not None:
            try:
                await websocket.close(code=close_code)
            except RuntimeError:
                pass
        logger.info(
            "Realtime disconnected user_id=%s role=%s reason=%s active_connections=%s",
            connection.identity.account_id,
            connection.identity.role,
            reason,
            self.active_count,
        )

    async def dispatch(self, envelope: RealtimeEnvelope, audience_roles: list[str]) -> None:
        message = envelope.model_dump(mode="json")
        slow_clients: list[WebSocket] = []
        delivered = 0
        for connection in tuple(self._connections.values()):
            if not self._is_authorized(connection.identity, envelope, audience_roles):
                continue
            try:
                connection.queue.put_nowait(message)
                delivered += 1
            except asyncio.QueueFull:
                slow_clients.append(connection.websocket)
        for websocket in slow_clients:
            logger.warning("Realtime slow client disconnected event_id=%s", envelope.event_id)
            await self.disconnect(websocket, close_code=1013, reason="slow_client")
        logger.debug(
            "Realtime event dispatched event_id=%s event_type=%s recipients=%s",
            envelope.event_id,
            envelope.event_type,
            delivered,
        )

    async def send_protocol(self, websocket: WebSocket, message: dict[str, Any]) -> bool:
        connection = self._connections.get(websocket)
        if connection is None:
            return False
        try:
            connection.queue.put_nowait(message)
        except asyncio.QueueFull:
            await self.disconnect(websocket, close_code=1013, reason="slow_client")
            return False
        return True

    async def require_resynchronization(self) -> None:
        message = {"type": "realtime.resync_required"}
        slow_clients: list[WebSocket] = []
        for connection in tuple(self._connections.values()):
            try:
                connection.queue.put_nowait(message)
            except asyncio.QueueFull:
                slow_clients.append(connection.websocket)
        for websocket in slow_clients:
            await self.disconnect(websocket, close_code=1013, reason="slow_client")

    async def close_all(self) -> None:
        for websocket in tuple(self._connections):
            await self.disconnect(websocket, close_code=1001, reason="server_shutdown")

    async def _send_loop(
        self,
        websocket: WebSocket,
        queue: asyncio.Queue[dict[str, Any]],
    ) -> None:
        try:
            while True:
                await websocket.send_json(await queue.get())
        except asyncio.CancelledError:
            raise
        except Exception:
            await self.disconnect(websocket, reason="send_failure")

    @staticmethod
    def _is_authorized(
        identity: RealtimeIdentity,
        envelope: RealtimeEnvelope,
        audience_roles: list[str],
    ) -> bool:
        if identity.role not in audience_roles:
            return False

        scope = envelope.scope
        event_type = envelope.event_type.value
        if event_type.startswith("notification."):
            return scope.recipient_account_id == identity.account_id

        if event_type.startswith("account_request.") or event_type.startswith(
            ("user.", "enterprise.")
        ):
            if identity.role == "enterprise":
                return scope.recipient_account_id == identity.account_id
            return True

        if identity.role == "enterprise":
            if scope.recipient_account_id is not None:
                return scope.recipient_account_id == identity.account_id
            if scope.enterprise_account_id is not None:
                return scope.enterprise_account_id == identity.enterprise_account_id
            if scope.enterprise_id is not None:
                return scope.enterprise_id == identity.enterprise_id
            return event_type == "system_setting.updated"

        if identity.role == "admin" and event_type.startswith("support_ticket."):
            priority = envelope.payload.get("priority") or envelope.payload.get("ticket_priority")
            return priority in {"High", "Urgent"}

        if event_type == "activity.created":
            return _can_view_activity(identity.role, envelope.payload)
        return True


def _can_view_activity(role: str, payload: Mapping[str, object]) -> bool:
    category = payload.get("category")
    actor_role = payload.get("actor_role")
    action = payload.get("action")
    severity = payload.get("severity")
    if role == "admin":
        return bool(
            category in {"Admin Operation", "Staff Submission", "Staff Operation"}
            or (
                category == "IT Activity"
                and (
                    action
                    in {
                        "Approve Enterprise Profile Change",
                        "Approve Verified Email Change",
                        "Create Enterprise Account",
                        "Create LGU Account",
                        "Decline Enterprise Profile Change",
                        "Decline Verified Email Change",
                        "Delete Old Activity",
                        "Update Account Status",
                        "Update Enterprise Account",
                        "Update LGU Account",
                        "Update Support Ticket Status",
                        "Update System Settings",
                    }
                    or (isinstance(action, str) and action.startswith("Alert "))
                )
            )
            or (
                category == "System"
                and (
                    severity in {"Warning", "Critical"}
                    or (isinstance(action, str) and action.startswith("Alert "))
                )
            )
            or severity == "Critical"
        )
    if role == "it":
        return bool(
            category in {"System", "IT Activity", "Enterprise Activity"}
            or actor_role == "IT Personnel"
        )
    return False


realtime_manager = RealtimeConnectionManager()
