from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import WebSocket
from starlette.datastructures import URL

from app.core.http_security import websocket_security_headers
from app.core.websocket_auth import is_websocket_origin_allowed
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.activity_logs import router as activity_logs_router
from app.features.operational import router as operational_router

TRUSTED_FRONTEND_ORIGIN = "https://tanaw-sanpedro.vercel.app"


def test_websocket_origin_allows_trusted_production_frontend() -> None:
    assert is_websocket_origin_allowed(
        TRUSTED_FRONTEND_ORIGIN,
        [TRUSTED_FRONTEND_ORIGIN],
        is_production=True,
    )


def test_websocket_origin_rejects_unknown_production_origin() -> None:
    assert not is_websocket_origin_allowed(
        "https://evil.example",
        [TRUSTED_FRONTEND_ORIGIN],
        is_production=True,
    )


def test_websocket_origin_rejects_missing_origin_in_production() -> None:
    assert not is_websocket_origin_allowed(None, [TRUSTED_FRONTEND_ORIGIN], is_production=True)


def test_websocket_origin_allows_missing_origin_in_development() -> None:
    assert is_websocket_origin_allowed(None, ["http://localhost:5173"], is_production=False)


def test_websocket_origin_does_not_allow_wildcard_in_production() -> None:
    assert not is_websocket_origin_allowed("https://evil.example", ["*"], is_production=True)


def test_websocket_security_headers_include_hsts_for_secure_non_local_handshake() -> None:
    websocket = cast(
        WebSocket,
        SimpleNamespace(
            headers={"x-forwarded-proto": "https"},
            url=URL("wss://tanaw.onrender.com/operational/ws"),
        ),
    )

    headers = {key.decode(): value.decode() for key, value in websocket_security_headers(websocket)}

    assert headers["strict-transport-security"] == "max-age=31536000; includeSubDomains; preload"
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert headers["cache-control"] == "no-cache, no-store, must-revalidate, private"


def test_websocket_security_headers_do_not_hsts_local_development_handshake() -> None:
    websocket = cast(
        WebSocket,
        SimpleNamespace(headers={}, url=URL("ws://localhost:5174/operational/ws")),
    )

    headers = {key.decode(): value.decode() for key, value in websocket_security_headers(websocket)}

    assert "strict-transport-security" not in headers
    assert headers["x-content-type-options"] == "nosniff"


class AsyncSessionContext:
    async def __aenter__(self) -> MagicMock:
        return MagicMock()

    async def __aexit__(self, *_: object) -> None:
        return None


def active_it_account() -> Account:
    return Account(
        id="websocket-account-1",
        email="websocket-it@example.com",
        password_hash="unused-password-hash",
        role=AccountRole.IT,
        display_name="WebSocket IT",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_operational_websocket_closes_when_session_is_invalidated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    websocket = MagicMock()
    websocket.receive_text = AsyncMock(return_value="ping")
    websocket.close = AsyncMock()
    websocket.send_text = AsyncMock()
    manager = SimpleNamespace(connect=AsyncMock(), disconnect=MagicMock())
    authenticate = AsyncMock(side_effect=[active_it_account(), None])
    monkeypatch.setattr(
        operational_router,
        "receive_websocket_bearer_token",
        AsyncMock(return_value="access-token"),
    )
    monkeypatch.setattr(operational_router, "authenticate_websocket_account", authenticate)
    monkeypatch.setattr(operational_router, "AsyncSessionLocal", AsyncSessionContext)
    monkeypatch.setattr(operational_router, "operational_ws_manager", manager)

    await operational_router.operational_websocket(cast(WebSocket, websocket))

    websocket.close.assert_awaited_once_with(code=1008)
    websocket.send_text.assert_not_awaited()
    assert authenticate.await_count == 2
    manager.disconnect.assert_called_once()


@pytest.mark.asyncio
async def test_activity_log_websocket_closes_when_session_is_invalidated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    websocket = MagicMock()
    websocket.receive_text = AsyncMock(return_value="ping")
    websocket.close = AsyncMock()
    websocket.send_text = AsyncMock()
    manager = SimpleNamespace(connect=AsyncMock(), disconnect=MagicMock())
    authenticate = AsyncMock(side_effect=[active_it_account(), None])
    monkeypatch.setattr(
        activity_logs_router,
        "receive_websocket_bearer_token",
        AsyncMock(return_value="access-token"),
    )
    monkeypatch.setattr(activity_logs_router, "authenticate_websocket_account", authenticate)
    monkeypatch.setattr(activity_logs_router, "AsyncSessionLocal", AsyncSessionContext)
    monkeypatch.setattr(activity_logs_router, "activity_log_manager", manager)

    await activity_logs_router.activity_logs_websocket(cast(WebSocket, websocket))

    websocket.close.assert_awaited_once_with(code=1008)
    websocket.send_text.assert_not_awaited()
    assert authenticate.await_count == 2
    manager.disconnect.assert_called_once()
