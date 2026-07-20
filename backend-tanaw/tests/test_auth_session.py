import pytest
from fastapi import Response
from pydantic import SecretStr

from app.core.config import Settings
from app.core.security import create_access_token
from app.features.auth import router as auth_router


def test_session_cookie_is_http_only_and_uses_development_same_site(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        auth_router,
        "get_settings",
        lambda: Settings(session_cookie_expire_minutes=480),
    )
    response = Response()

    auth_router.set_auth_session_cookie(response, "session-token", remember=False)

    cookie = response.headers["set-cookie"]
    assert "tanaw_session=session-token" in cookie
    assert "HttpOnly" in cookie
    assert "Max-Age=28800" in cookie
    assert "Path=/auth" in cookie
    assert "SameSite=lax" in cookie
    assert "Secure" not in cookie


def test_production_session_cookie_supports_credentialed_cross_site_restore(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        auth_router,
        "get_settings",
        lambda: Settings(
            environment="production",
            jwt_secret_key="production-jwt-secret-with-at-least-32-characters",
            cors_origins="https://tanaw-sanpedro.vercel.app",
            frontend_public_url="https://tanaw-sanpedro.vercel.app",
            email_delivery_mode="resend",
            resend_api_key=SecretStr("re_production_sending_key_123456789"),
            email_secret_derivation_key=SecretStr(
                "production-email-secret-different-from-jwt-2026"
            ),
            email_from_address="no-reply@mail.tanaw-sanpedro.ph",
        ),
    )
    response = Response()

    auth_router.set_auth_session_cookie(response, "session-token", remember=True)

    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=none" in cookie
    assert "Secure" in cookie


def test_remember_preference_round_trips_in_access_token() -> None:
    remembered = create_access_token("account-1", {"remember": True})
    temporary = create_access_token("account-1", {"remember": False})

    assert auth_router.token_remember_preference(remembered) is True
    assert auth_router.token_remember_preference(temporary) is False
    assert auth_router.token_remember_preference("not-a-token") is False
