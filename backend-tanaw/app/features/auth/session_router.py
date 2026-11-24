import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.db.session import get_db
from app.features.accounts.dependencies import (
    bearer_scheme,
    get_account_from_access_token,
    get_current_account,
)
from app.features.accounts.models import Account, AccountStatus, SystemConfiguration
from app.features.accounts.schemas import (
    AuthUser,
)
from app.features.accounts.service import (
    get_account_by_login_identifier,
    invalidate_account_tokens,
    to_auth_user,
)
from app.features.activity_logs.service import (
    get_actor_role_label,
)
from app.features.activity_logs.service import (
    record_activity_log as record_auth_log,
)
from app.features.auth.http_session import (
    AUTH_SESSION_COOKIE,
    clear_auth_session_cookie,
    set_auth_session_cookie,
    token_remember_preference,
)
from app.features.auth.policies import (
    is_login_scope_allowed,
)
from app.features.auth.schemas import (
    LoginRequest,
    LoginResponse,
)
from app.features.auth.service import (
    LoginLockoutPolicy,
    authenticate_loaded_account,
    clear_login_failures,
    lockout_seconds_remaining,
    login_lockout_message,
    register_failed_login,
    resolve_login_lockout_policy,
)
from app.features.auth.system_settings import load_system_settings_values

logger = logging.getLogger(__name__)

SYSTEM_SETTINGS_ID = "default"
router = APIRouter(prefix="/auth", tags=["authentication"])


async def record_account_lockout(
    db: AsyncSession, account: Account, policy: LoginLockoutPolicy
) -> None:
    """A lockout is a heads-up in Activity, not an alert: it ends by itself after the lock time."""
    await record_auth_log(
        db,
        group="Login & Security",
        severity="Warning",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Account Locked",
        target=account.email,
        summary=(
            f"{account.display_name}'s account was locked for {policy.lock_minutes} minutes "
            "after too many wrong passwords."
        ),
        source_id=account.id,
        it_detail=(
            f"{policy.attempt_limit} failed sign-ins in a row. "
            f"Locked for {policy.lock_minutes} minutes."
        ),
        metadata={
            "attemptLimit": policy.attempt_limit,
            "lockMinutes": policy.lock_minutes,
        },
    )


async def get_login_lockout_policy(db: AsyncSession) -> LoginLockoutPolicy:
    record = await db.scalar(
        select(SystemConfiguration).where(SystemConfiguration.id == SYSTEM_SETTINGS_ID)
    )
    return resolve_login_lockout_policy(load_system_settings_values(record))


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    candidate = await get_account_by_login_identifier(db, payload.username, for_update=True)
    lockout_candidate = (
        candidate
        if candidate is not None
        and candidate.status == AccountStatus.ACTIVE
        and candidate.activated_at is not None
        and is_login_scope_allowed(candidate, payload.loginScope)
        else None
    )
    lockout_policy = (
        await get_login_lockout_policy(db)
        if lockout_candidate is not None
        else LoginLockoutPolicy()
    )
    if lockout_candidate is not None:
        remaining = lockout_seconds_remaining(lockout_candidate)
        if remaining > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "message": login_lockout_message(lockout_policy),
                    "retryAfterSeconds": remaining,
                },
                headers={"Retry-After": str(remaining)},
            )

    account = authenticate_loaded_account(candidate, payload.password)
    if (
        account is None
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is None
        or not is_login_scope_allowed(account, payload.loginScope)
    ):
        if lockout_candidate is not None:
            remaining = register_failed_login(lockout_candidate, policy=lockout_policy)
            if remaining > 0:
                await record_account_lockout(db, lockout_candidate, lockout_policy)
            await db.commit()
            if remaining > 0:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "message": login_lockout_message(lockout_policy),
                        "retryAfterSeconds": remaining,
                    },
                    headers={"Retry-After": str(remaining)},
                )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password."
        )

    clear_login_failures(account)
    account.last_login_at = datetime.now(UTC)
    token = create_access_token(
        account.id,
        {"role": account.role.value, "remember": payload.rememberMe},
    )
    await record_auth_log(
        db,
        group="Login & Security",
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Login",
        target=account.email,
        summary=f"{account.display_name} signed in to TANAW.",
        source_id=account.id,
    )
    set_auth_session_cookie(response, token, remember=payload.rememberMe)
    return LoginResponse(token=token, user=to_auth_user(account))


@router.post("/session", response_model=LoginResponse)
async def restore_session(
    request: Request,
    response: Response,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    token = (
        credentials.credentials
        if credentials is not None
        else request.cookies.get(AUTH_SESSION_COOKIE)
    )
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    try:
        account = await get_account_from_access_token(token, db)
    except HTTPException:
        clear_auth_session_cookie(response)
        raise
    remember = token_remember_preference(token)
    refreshed_token = create_access_token(
        account.id,
        {"role": account.role.value, "remember": remember},
    )
    set_auth_session_cookie(response, refreshed_token, remember=remember)
    return LoginResponse(token=refreshed_token, user=to_auth_user(account))


@router.get("/me", response_model=AuthUser)
async def me(account: Annotated[Account, Depends(get_current_account)]) -> AuthUser:
    return to_auth_user(account)


@router.post("/logout")
async def logout(
    response: Response,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    await record_auth_log(
        db,
        group="Login & Security",
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Logout",
        target=account.email,
        summary=f"{account.display_name} signed out of TANAW.",
        source_id=account.id,
    )
    await invalidate_account_tokens(db, account)
    clear_auth_session_cookie(response)
    return {"status": "ok"}
