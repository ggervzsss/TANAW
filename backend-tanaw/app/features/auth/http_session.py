from datetime import UTC, datetime

import jwt
from fastapi import Response

from app.core.config import get_settings
from app.core.security import create_access_token, decode_access_token
from app.features.accounts.models import Account

AUTH_SESSION_COOKIE = "tanaw_session"
# OpenID Connect's name for the time the person authenticated.
SIGNED_IN_AT_CLAIM = "auth_time"


def set_auth_session_cookie(response: Response, token: str, *, remember: bool) -> None:
    settings = get_settings()
    max_age_minutes = (
        settings.access_token_expire_minutes
        if remember
        else min(settings.session_cookie_expire_minutes, settings.access_token_expire_minutes)
    )
    response.set_cookie(
        key=AUTH_SESSION_COOKIE,
        value=token,
        max_age=max_age_minutes * 60,
        httponly=True,
        secure=settings.is_production,
        samesite="none" if settings.is_production else "lax",
        path="/auth",
    )


def clear_auth_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=AUTH_SESSION_COOKIE,
        httponly=True,
        secure=get_settings().is_production,
        samesite="none" if get_settings().is_production else "lax",
        path="/auth",
    )


def token_remember_preference(token: str) -> bool:
    try:
        return decode_access_token(token).get("remember") is True
    except jwt.PyJWTError:
        return False


def token_signed_in_at(token: str) -> datetime | None:
    """When the person signed in to this session; refreshed tokens keep the original time."""
    try:
        signed_in_at = decode_access_token(token).get(SIGNED_IN_AT_CLAIM)
    except jwt.PyJWTError:
        return None
    if isinstance(signed_in_at, bool) or not isinstance(signed_in_at, int | float):
        return None
    return datetime.fromtimestamp(signed_in_at, UTC)


def create_session_token(
    account: Account, *, remember: bool, signed_in_at: datetime | None = None
) -> str:
    """A session token for ``account``. ``signed_in_at`` carries over from the token it replaces
    (a refresh, a password change); a new sign-in starts now."""
    started = signed_in_at or datetime.now(UTC)
    return create_access_token(
        account.id,
        {
            "role": account.role.value,
            "remember": remember,
            SIGNED_IN_AT_CLAIM: started.timestamp(),
        },
    )
