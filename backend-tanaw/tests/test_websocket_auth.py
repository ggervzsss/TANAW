from types import SimpleNamespace
from typing import cast

from fastapi import WebSocket
from starlette.datastructures import URL

from app.core.http_security import websocket_security_headers
from app.core.websocket_auth import is_websocket_origin_allowed

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
