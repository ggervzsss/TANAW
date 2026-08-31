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
from app.features.accounts.models import Account, AccountRole, AccountStatus, SystemConfiguration
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
    get_auth_log_category,
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
from app.features.monitoring.alerts import create_operational_alert, to_operational_alert_summary
from app.features.notifications.service import (
    NOTIFY_FAILED_LOGIN_LOCKOUT_KEY,
    create_role_notifications,
    system_setting_enabled,
)

logger = logging.getLogger(__name__)

SYSTEM_SETTINGS_ID = "default"
router = APIRouter(prefix="/auth", tags=["authentication"])


async def notify_failed_login_threshold(db: AsyncSession, account: Account) -> None:
    if not await system_setting_enabled(db, NOTIFY_FAILED_LOGIN_LOCKOUT_KEY):
        return

    alert = await create_operational_alert(
        db,
        alert_type="Failed Login Threshold",
        severity="Warning",
        requester=account.display_name,
        summary=(
            f"{account.display_name} reached the failed sign-in threshold and was "
            "temporarily locked."
        ),
        required_action="Review account activity and contact the user if the lockout is suspicious.",
        resolution_mode="Remote Review",
        owner="IT",
        enterprise=(
            account.enterprise_profile.enterprise_name
            if account.enterprise_profile is not None
            else None
        ),
        source_id=f"failed-login-threshold:{account.id}",
    )
    alert_summary = to_operational_alert_summary(alert)
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.IT],
        title=f"{account.display_name}'s account is temporarily locked.",
        message=f"{alert_summary.summary} {alert_summary.requiredAction}",
        notification_type="Locked Account",
        severity="Warning",
        actor=account,
        source_type="operational.alert",
        source_id=alert_summary.id,
        replace_existing_for_source=True,
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
                await notify_failed_login_threshold(db, lockout_candidate)
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
        category=get_auth_log_category(account),
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
        category=get_auth_log_category(account),
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
