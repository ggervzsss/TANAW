from collections import defaultdict

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.features.operational.schemas import OperationalWebSocketEnvelope
from app.features.operational.service import can_view_operational_event


class OperationalConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._account_ids: dict[WebSocket, str | None] = {}
        self._enterprise_ids: dict[WebSocket, str | None] = {}
        self._topology_enterprise_ids: dict[WebSocket, str | None] = {}
        self._classifications: dict[WebSocket, str | None] = {}

    async def connect(
        self,
        websocket: WebSocket,
        role: str,
        account_id: str | None = None,
        enterprise_id: str | None = None,
        topology_enterprise_id: str | None = None,
        classification: str | None = None,
    ) -> None:
        if websocket.application_state == WebSocketState.CONNECTING:
            await websocket.accept()
        self._connections[role].add(websocket)
        self._account_ids[websocket] = account_id
        self._enterprise_ids[websocket] = enterprise_id
        self._topology_enterprise_ids[websocket] = topology_enterprise_id
        self._classifications[websocket] = classification

    def disconnect(self, websocket: WebSocket, role: str) -> None:
        self._connections[role].discard(websocket)
        self._account_ids.pop(websocket, None)
        self._enterprise_ids.pop(websocket, None)
        self._topology_enterprise_ids.pop(websocket, None)
        self._classifications.pop(websocket, None)

    async def broadcast(self, envelope: OperationalWebSocketEnvelope) -> None:
        for role, sockets in list(self._connections.items()):
            if not can_view_operational_event(role, envelope.type):
                continue

            stale: list[WebSocket] = []
            for socket in sockets:
                if envelope.type == "resource.invalidated":
                    if not self._is_resource_invalidation_recipient(socket, role, envelope):
                        continue
                elif envelope.type in {"notification.created", "notification.updated"}:
                    if not self._is_notification_recipient(socket, envelope):
                        continue
                elif role == "enterprise" and not self._is_enterprise_event_recipient(
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

    def _is_resource_invalidation_recipient(
        self,
        socket: WebSocket,
        role: str,
        envelope: OperationalWebSocketEnvelope,
    ) -> bool:
        audience_roles = envelope.data.get("audienceRoles")
        if not isinstance(audience_roles, list) or role not in audience_roles:
            return False
        scope = envelope.data.get("scope")
        if not isinstance(scope, dict) or scope.get("classification") != "official":
            return False
        if role != "enterprise":
            return True
        return bool(
            self._topology_enterprise_ids.get(socket)
            and self._topology_enterprise_ids.get(socket) == scope.get("enterpriseId")
            and self._classifications.get(socket) == scope.get("classification")
        )

    def _is_enterprise_event_recipient(
        self, socket: WebSocket, envelope: OperationalWebSocketEnvelope
    ) -> bool:
        enterprise_id = self._enterprise_ids.get(socket)
        if not enterprise_id:
            return False
        if envelope.type == "report.updated":
            return envelope.data.get("enterpriseId") == enterprise_id
        if envelope.type in {"notification.created", "notification.updated"}:
            return envelope.data.get("recipientEnterpriseId") == enterprise_id
        return False

    def _is_notification_recipient(
        self, socket: WebSocket, envelope: OperationalWebSocketEnvelope
    ) -> bool:
        account_id = self._account_ids.get(socket)
        if account_id and envelope.data.get("recipientAccountId") == account_id:
            return True

        enterprise_id = self._enterprise_ids.get(socket)
        return bool(enterprise_id and envelope.data.get("recipientEnterpriseId") == enterprise_id)


operational_ws_manager = OperationalConnectionManager()
