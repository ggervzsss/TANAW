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
