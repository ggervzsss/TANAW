from collections import defaultdict

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.features.activity_logs.schemas import ActivityLogSummary
from app.features.activity_logs.service import can_role_view_log


class ActivityLogConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, websocket: WebSocket, role: str) -> None:
        if websocket.application_state == WebSocketState.CONNECTING:
            await websocket.accept()
        self._connections[role].add(websocket)

    def disconnect(self, websocket: WebSocket, role: str) -> None:
        self._connections[role].discard(websocket)

    async def broadcast(self, log: ActivityLogSummary) -> None:
        for role, sockets in list(self._connections.items()):
            if not can_role_view_log(role, log):
                continue

            stale: list[WebSocket] = []
            for socket in sockets:
                try:
                    await socket.send_json(log.model_dump(mode="json"))
                except RuntimeError, WebSocketDisconnect:
                    stale.append(socket)
                except Exception:
                    stale.append(socket)

            for socket in stale:
                self.disconnect(socket, role)


activity_log_manager = ActivityLogConnectionManager()
