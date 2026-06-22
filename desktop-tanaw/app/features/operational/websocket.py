from collections import defaultdict

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.features.operational.schemas import OperationalWebSocketEnvelope
from app.features.operational.service import can_view_operational_event


class OperationalConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._enterprise_ids: dict[WebSocket, str | None] = {}

    async def connect(
        self, websocket: WebSocket, role: str, enterprise_id: str | None = None
    ) -> None:
        if websocket.application_state == WebSocketState.CONNECTING:
            await websocket.accept()
        self._connections[role].add(websocket)
        self._enterprise_ids[websocket] = enterprise_id

    def disconnect(self, websocket: WebSocket, role: str) -> None:
        self._connections[role].discard(websocket)
        self._enterprise_ids.pop(websocket, None)

    async def broadcast(self, envelope: OperationalWebSocketEnvelope) -> None:
        for role, sockets in list(self._connections.items()):
            if not can_view_operational_event(role, envelope.type):
                continue

            stale: list[WebSocket] = []
            for socket in sockets:
                if role == "enterprise" and not self._is_enterprise_event_recipient(
                    socket, envelope
                ):
                    continue
                try:
                    await socket.send_json(envelope.model_dump(mode="json"))
                except RuntimeError, WebSocketDisconnect:
                    stale.append(socket)
                except Exception:
                    stale.append(socket)

            for socket in stale:
                self.disconnect(socket, role)

    def _is_enterprise_event_recipient(
        self, socket: WebSocket, envelope: OperationalWebSocketEnvelope
    ) -> bool:
        if envelope.type != "report.updated":
            return False
        enterprise_id = self._enterprise_ids.get(socket)
        return bool(enterprise_id and envelope.data.get("enterpriseId") == enterprise_id)


operational_ws_manager = OperationalConnectionManager()
