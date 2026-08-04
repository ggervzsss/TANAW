import asyncio
import logging
from time import monotonic
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.features.accounts.dependencies import (
    bearer_scheme,
    get_current_account,
)
from app.features.accounts.models import Account
from app.features.accounts.schemas import (
    PasswordChangeRequest,
)
from app.features.accounts.service import (
    change_account_password,
    to_auth_user,
)
from app.features.activity_logs.service import (
    get_actor_role_label,
)
from app.features.activity_logs.service import (
    record_activity_log as record_auth_log,
)
from app.features.auth.http_session import (
    set_auth_session_cookie,
    token_remember_preference,
)
from app.features.auth.password_recovery import (
    PasswordRecoveryError,
    request_password_reset,
    reset_password_with_token,
    verify_password_reset_code,
)
from app.features.auth.policies import (
    get_auth_log_category,
)
from app.features.auth.recovery_rate_limit import PasswordResetRateLimitExceeded
from app.features.auth.schemas import (
    ForgotPasswordRequest,
    ForgotPasswordRequestResponse,
    ForgotPasswordResetRequest,
    ForgotPasswordVerifyRequest,
    ForgotPasswordVerifyResponse,
    LoginResponse,
    StatusResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["password security"])


async def _wait_for_password_reset_response_floor(started_at: float) -> None:
    remaining = get_settings().password_reset_response_floor_seconds - (monotonic() - started_at)
    if remaining > 0:
        await asyncio.sleep(remaining)


@router.post("/change-password", response_model=LoginResponse)
async def change_password(
    payload: PasswordChangeRequest,
    response: Response,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    changed = await change_account_password(
        db, account, payload.currentPassword, payload.newPassword
    )
    if not changed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect."
        )

    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Password Changed",
        target=account.email,
        summary=f"{account.display_name} changed their account password.",
        source_id=account.id,
    )
    remember = (
        token_remember_preference(credentials.credentials) if credentials is not None else False
    )
    token = create_access_token(
        account.id,
        {"role": account.role.value, "remember": remember},
    )
    set_auth_session_cookie(response, token, remember=remember)
    return LoginResponse(token=token, user=to_auth_user(account))


@router.post("/forgot-password/request", response_model=ForgotPasswordRequestResponse)
async def forgot_password_request(
    request: Request,
    payload: ForgotPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ForgotPasswordRequestResponse:
    started_at = monotonic()
    rate_limit_error: PasswordResetRateLimitExceeded | None = None
    result = None
    try:
        result = await request_password_reset(
            db,
            str(payload.email),
            client_ip=request.client.host if request.client is not None else "unavailable",
        )
    except PasswordResetRateLimitExceeded as exc:
        rate_limit_error = exc
    finally:
        await _wait_for_password_reset_response_floor(started_at)

    if rate_limit_error is not None:
        retry_after = rate_limit_error.retry_after_seconds
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "message": "Too many recovery requests. Please wait before trying again.",
                "retryAfterSeconds": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )
    if result is None:
        raise RuntimeError("Password recovery request completed without a result.")
    return ForgotPasswordRequestResponse(
        challengeId=result.challenge_id,
        expiresInMinutes=result.expires_in_minutes,
        resendAvailableInSeconds=result.resend_available_in_seconds,
        message=(
            "If an eligible TANAW account matches, check its registered inbox and use the "
            "most recent verification code. Another code can be requested in "
            f"{result.resend_available_in_seconds} seconds."
        ),
    )


@router.post("/forgot-password/verify", response_model=ForgotPasswordVerifyResponse)
async def forgot_password_verify(
    payload: ForgotPasswordVerifyRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ForgotPasswordVerifyResponse:
    try:
        reset_token = await verify_password_reset_code(db, payload.challengeId, payload.code)
    except PasswordRecoveryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return ForgotPasswordVerifyResponse(resetToken=reset_token)


@router.post("/forgot-password/reset", response_model=StatusResponse)
async def forgot_password_reset(
    payload: ForgotPasswordResetRequest, db: Annotated[AsyncSession, Depends(get_db)]
) -> StatusResponse:
    try:
        account = await reset_password_with_token(
            db,
            challenge_id=payload.challengeId,
            reset_token=payload.resetToken,
            new_password=payload.newPassword,
        )
    except PasswordRecoveryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Success",
        actor="Account Recovery",
        actor_role="System",
        action="Password Reset",
        target=account.email,
        summary=f"{account.display_name} reset their password through account recovery.",
        source_id=account.id,
    )
    return StatusResponse(status="ok")
