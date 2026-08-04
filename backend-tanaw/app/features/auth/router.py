"""Authentication router composition."""

from fastapi import APIRouter

from app.features.auth.activation_router import router as activation_router
from app.features.auth.http_session import (
    set_auth_session_cookie,
    token_remember_preference,
)
from app.features.auth.password_router import forgot_password_request
from app.features.auth.password_router import router as password_router
from app.features.auth.profile_router import request_business_email_change
from app.features.auth.profile_router import router as profile_router
from app.features.auth.session_router import login
from app.features.auth.session_router import router as session_router
from app.features.auth.settings_router import router as settings_router
from app.features.auth.support_router import create_support_request
from app.features.auth.support_router import router as support_router

router = APIRouter()
router.include_router(activation_router)
router.include_router(session_router)
router.include_router(password_router)
router.include_router(support_router)
router.include_router(profile_router)
router.include_router(settings_router)

__all__ = [
    "create_support_request",
    "forgot_password_request",
    "login",
    "request_business_email_change",
    "router",
    "set_auth_session_cookie",
    "token_remember_preference",
]
