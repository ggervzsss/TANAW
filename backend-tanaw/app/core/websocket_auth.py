from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

from app.core.config import get_settings


async def receive_websocket_bearer_token(
    websocket: WebSocket, query_token: str | None
) -> str | None:
    settings = get_settings()
    if not is_websocket_origin_allowed(
        websocket.headers.get("origin"), settings.cors_origin_list, settings.is_production
    ):
        await websocket.close(code=1008)
        return None

    await websocket.accept()

    if query_token:
        return query_token

    try:
        message = await websocket.receive_json()
    except RuntimeError, ValueError, WebSocketDisconnect:
        await websocket.close(code=1008)
        return None

    if not isinstance(message, dict):
        await websocket.close(code=1008)
        return None

    if message.get("type") != "auth":
        await websocket.close(code=1008)
        return None

    token = message.get("token")
    if not isinstance(token, str) or not token:
        await websocket.close(code=1008)
        return None

    return token


def is_websocket_origin_allowed(
    origin: str | None, allowed_origins: list[str], is_production: bool
) -> bool:
    if origin is None:
        return not is_production

    normalized_origin = origin.strip().rstrip("/")
    if not normalized_origin:
        return not is_production

    if "*" in allowed_origins:
        return not is_production

    return normalized_origin in allowed_origins
