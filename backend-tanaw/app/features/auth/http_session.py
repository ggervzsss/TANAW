import jwt
from fastapi import Response

from app.core.config import get_settings
from app.core.security import decode_access_token

AUTH_SESSION_COOKIE = "tanaw_session"


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
