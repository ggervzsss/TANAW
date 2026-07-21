import asyncio
import hashlib
import json
import logging
from datetime import UTC, datetime
from time import monotonic
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, decode_access_token
from app.db.session import get_db
from app.features.accounts.dependencies import (
    bearer_scheme,
    get_account_from_access_token,
    get_current_account,
)
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
    SystemConfiguration,
)
from app.features.accounts.schemas import (
    AccountChangeRequestResponse,
    AuthUser,
    BuildingCapacityUpdate,
    BusinessEmailChangeRequest,
    ContactNumberChangeRequest,
    LeadAdminNameUpdate,
    PasswordChangeRequest,
    ProfileDisplayImageUpdate,
    ProfileUpdate,
)
from app.features.accounts.service import (
    PENDING_CONTACT_NUMBER_CHANGE_KEY,
    change_account_password,
    get_account_by_login_identifier,
    get_account_preferences,
    invalidate_account_tokens,
    set_account_preferences,
    set_display_image_data_url,
    to_auth_user,
)
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log, get_actor_role_label
from app.features.activity_logs.websocket import activity_log_manager
from app.features.auth.account_activation import (
    AccountActivationError,
    complete_account_activation,
    validate_account_activation,
)
from app.features.auth.email_change import (
    AccountEmailChangeError,
    cancel_account_email_change,
    get_active_account_email_change_request,
    request_account_email_change,
    verify_account_email_change,
)
from app.features.auth.password_recovery import (
    PasswordRecoveryError,
    request_password_reset,
    reset_password_with_token,
    verify_password_reset_code,
)
from app.features.auth.recovery_rate_limit import PasswordResetRateLimitExceeded
from app.features.auth.schemas import (
    AccountActivationCompleteRequest,
    AccountActivationCompleteResponse,
    AccountActivationValidateRequest,
    AccountActivationValidateResponse,
    AccountEmailChangeStatusResponse,
    AccountEmailChangeVerifyRequest,
    AccountEmailChangeVerifyResponse,
    AccountPreferences,
    ForgotPasswordRequest,
    ForgotPasswordRequestResponse,
    ForgotPasswordResetRequest,
    ForgotPasswordVerifyRequest,
    ForgotPasswordVerifyResponse,
    LoginRequest,
    LoginResponse,
    StatusResponse,
    SupportRequest,
    SystemSettingsPayload,
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
from app.features.operational.schemas import OperationalWebSocketEnvelope
from app.features.operational.service import (
    NOTIFY_FAILED_LOGIN_LOCKOUT_KEY,
    create_operational_alert,
    create_role_notifications,
    mark_source_notifications_read,
    system_setting_enabled,
    to_operational_alert_summary,
)
from app.features.operational.websocket import operational_ws_manager

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)
SYSTEM_SETTINGS_ID = "default"
AUTH_SESSION_COOKIE = "tanaw_session"
ENTERPRISE_CHANGE_NOTIFICATION_ROLES = (AccountRole.IT,)


def is_login_scope_allowed(account: Account, login_scope: str) -> bool:
    if login_scope == "enterprise":
        return account.role == AccountRole.ENTERPRISE

    return account.role != AccountRole.ENTERPRISE


def get_auth_log_category(account: Account) -> str:
    if account.role == AccountRole.ADMIN:
        return "Admin Operation"
    if account.role == AccountRole.IT:
        return "IT Activity"
    if account.role == AccountRole.STAFF:
        return "Staff Operation"
    return "Enterprise Activity"


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
    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(
            type="alert.created",
            data=alert_summary.model_dump(mode="json"),
        )
    )
    notifications = await create_role_notifications(
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
    for notification in notifications:
        await operational_ws_manager.broadcast(
            OperationalWebSocketEnvelope(
                type="notification.created",
                data=notification.model_dump(mode="json"),
            )
        )


async def notify_enterprise_account_change(
    db: AsyncSession,
    account: Account,
    *,
    title: str,
    message: str,
    notification_type: str,
    source_type: str,
) -> None:
    if account.role != AccountRole.ENTERPRISE:
        return

    notifications = await create_role_notifications(
        db,
        recipient_roles=ENTERPRISE_CHANGE_NOTIFICATION_ROLES,
        title=title,
        message=message,
        notification_type=notification_type,
        severity="Info",
        actor=account,
        source_type=source_type,
        source_id=account.id,
        replace_existing_for_source=True,
    )
    for notification in notifications:
        await operational_ws_manager.broadcast(
            OperationalWebSocketEnvelope(
                type="notification.created",
                data=notification.model_dump(mode="json"),
            )
        )


async def get_login_lockout_policy(db: AsyncSession) -> LoginLockoutPolicy:
    record = await db.scalar(
        select(SystemConfiguration).where(SystemConfiguration.id == SYSTEM_SETTINGS_ID)
    )
    return resolve_login_lockout_policy(load_system_settings_values(record))


def load_system_settings_values(record: SystemConfiguration | None) -> dict[str, str | bool | int]:
    if record is None:
        return {}
    try:
        values = json.loads(record.values_json)
    except json.JSONDecodeError:
        return {}
    if not isinstance(values, dict):
        return {}
    return {
        key: value
        for key, value in values.items()
        if isinstance(key, str) and isinstance(value, str | bool | int)
    }


async def _wait_for_password_reset_response_floor(started_at: float) -> None:
    remaining = get_settings().password_reset_response_floor_seconds - (monotonic() - started_at)
    if remaining > 0:
        await asyncio.sleep(remaining)


def require_enterprise_account(account: Account) -> EnterpriseProfile:
    if account.role != AccountRole.ENTERPRISE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enterprise account access required.",
        )
    if account.enterprise_profile is None:
        raise RuntimeError("Enterprise account is missing its profile.")
    return account.enterprise_profile


def enterprise_label(account: Account) -> str:
    profile = require_enterprise_account(account)
    return profile.enterprise_name


def set_pending_account_change(account: Account, key: str, value: dict[str, str]) -> None:
    preferences = get_account_preferences(account)
    preferences[key] = value
    set_account_preferences(account, preferences)


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


@router.post(
    "/account-activation/validate",
    response_model=AccountActivationValidateResponse,
)
async def validate_activation_link(
    payload: AccountActivationValidateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountActivationValidateResponse:
    try:
        activation = await validate_account_activation(db, payload.token)
    except AccountActivationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return AccountActivationValidateResponse(
        displayName=activation.display_name,
        role=activation.role,
        expiresAt=activation.expires_at,
    )


@router.post(
    "/account-activation/complete",
    response_model=AccountActivationCompleteResponse,
)
async def complete_activation(
    payload: AccountActivationCompleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountActivationCompleteResponse:
    try:
        account = await complete_account_activation(db, payload.token, payload.newPassword)
    except AccountActivationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Account Activated",
        target=account.email,
        summary=f"{account.display_name} activated their TANAW account.",
        source_id=account.id,
    )
    return AccountActivationCompleteResponse(status="ok", role=account.role.value)


@router.post(
    "/email-change/verify",
    response_model=AccountEmailChangeVerifyResponse,
)
async def verify_email_change_link(
    payload: AccountEmailChangeVerifyRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountEmailChangeVerifyResponse:
    try:
        verification = await verify_account_email_change(db, payload.token, commit=False)
    except AccountEmailChangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email verification link is invalid or expired.",
        ) from exc

    await record_auth_log(
        db,
        category="System",
        severity="Success",
        actor=verification.display_name,
        actor_role="Account Email Owner",
        action="Verify Proposed Account Email",
        target=verification.requested_email,
        summary=f"{verification.display_name} verified ownership of a proposed email address.",
        source_id=verification.account_id,
    )
    return AccountEmailChangeVerifyResponse(
        displayName=verification.display_name,
        requestedEmail=verification.requested_email,
        status="verified",
    )


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
            await db.commit()
            if remaining > 0:
                await notify_failed_login_threshold(db, lockout_candidate)
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


@router.post("/support-request", response_model=StatusResponse)
async def create_support_request(
    payload: SupportRequest, db: Annotated[AsyncSession, Depends(get_db)]
) -> StatusResponse:
    requester_name = payload.name.strip()
    requester_email = str(payload.email).strip().lower()
    alert = await create_operational_alert(
        db,
        alert_type="Maintenance Request",
        severity="Warning",
        requester=f"{requester_name} <{requester_email}>",
        summary=payload.message.strip(),
        required_action=f"Review the login support request and contact {requester_email}.",
        resolution_mode="Remote Review",
        owner="IT",
        enterprise=None,
        source_id=f"login-support:{hashlib.sha256(requester_email.encode()).hexdigest()}",
    )
    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(
            type="alert.created",
            data=to_operational_alert_summary(alert).model_dump(mode="json"),
        )
    )
    notifications = await create_role_notifications(
        db,
        recipient_roles=[AccountRole.IT],
        title=f"Login support requested by {requester_name}.",
        message=f"{requester_email}: {payload.message.strip()}",
        notification_type="Login Support Request",
        severity="Warning",
        actor=None,
        source_type="operational.alert",
        source_id=alert.id,
        replace_existing_for_source=True,
    )
    for notification in notifications:
        await operational_ws_manager.broadcast(
            OperationalWebSocketEnvelope(
                type="notification.created",
                data=notification.model_dump(mode="json"),
            )
        )
    return StatusResponse(status="ok")


@router.patch("/profile", response_model=AuthUser)
async def update_profile(
    payload: ProfileUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    if str(payload.email) != account.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email changes require the dedicated verified email-change workflow.",
        )

    profile = account.enterprise_profile
    account.phone = payload.phone
    if account.role == AccountRole.ENTERPRISE:
        if profile is None:
            raise RuntimeError("Enterprise account is missing its profile.")
        if payload.managerName is None or payload.enterpriseName is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Manager and enterprise names are required.",
            )
        if payload.phone is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Contact number is required.",
            )
        profile.manager_name = payload.managerName
        enterprise_name = payload.enterpriseName.strip()
        profile.enterprise_name = enterprise_name
        account.display_name = enterprise_name
        profile.address = payload.address
    else:
        if payload.firstName is None or payload.lastName is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="First and last names are required.",
            )
        account.first_name = payload.firstName
        account.last_name = payload.lastName
        account.display_name = f"{payload.firstName} {payload.lastName}"
    if "displayImageDataUrl" in payload.model_fields_set:
        set_display_image_data_url(account, payload.displayImageDataUrl)
    await db.commit()
    await db.refresh(account)
    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Update Profile",
        target=account.email,
        summary=f"{account.display_name} updated their profile information.",
        source_id=account.id,
    )
    return to_auth_user(account)


@router.patch("/profile/display-image", response_model=AuthUser)
async def update_profile_display_image(
    payload: ProfileDisplayImageUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    set_display_image_data_url(account, payload.displayImageDataUrl)
    await db.commit()
    await db.refresh(account)
    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Update Profile Logo",
        target=account.email,
        summary=f"{account.display_name} updated their profile logo.",
        source_id=account.id,
    )
    return to_auth_user(account)


@router.patch("/profile/lead-admin", response_model=AuthUser)
async def update_lead_admin_name(
    payload: LeadAdminNameUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    profile = require_enterprise_account(account)
    profile.manager_name = payload.managerName
    await db.commit()
    await db.refresh(account)
    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Update Lead Admin",
        target=account.email,
        summary=f"{account.display_name} updated the lead admin name.",
        source_id=account.id,
    )
    return to_auth_user(account)


@router.patch("/profile/building-capacity", response_model=AuthUser)
async def update_building_capacity(
    payload: BuildingCapacityUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    profile = require_enterprise_account(account)
    previous_capacity = profile.building_capacity
    profile.building_capacity = payload.buildingCapacity
    await db.commit()
    await db.refresh(account)
    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Update Building Capacity",
        target=account.email,
        summary=f"{account.display_name} updated building capacity to {profile.building_capacity}.",
        source_id=account.id,
        metadata={
            "previousBuildingCapacity": previous_capacity,
            "buildingCapacity": profile.building_capacity,
        },
    )
    return to_auth_user(account)


@router.post("/profile/business-email-change", response_model=AccountChangeRequestResponse)
async def request_business_email_change(
    payload: BusinessEmailChangeRequest,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountChangeRequestResponse:
    require_enterprise_account(account)
    new_email = str(payload.email)
    try:
        _, email_request = await request_account_email_change(
            db,
            account_id=account.id,
            requested_email=new_email,
            requested_by=account,
        )
    except AccountEmailChangeError as exc:
        response_status = (
            status.HTTP_409_CONFLICT
            if "already" in str(exc).lower() or "pending" in str(exc).lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=response_status, detail=str(exc)) from exc
    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Request Business Email Change",
        target=account.email,
        summary=f"{account.display_name} requested verified ownership of a new business email.",
        source_id=account.id,
        metadata={
            "requestId": email_request.id,
            "requestedEmail": email_request.requested_email,
            "status": email_request.status,
        },
    )
    enterprise = enterprise_label(account)
    notification_account_id = account.id
    notification_request_id = email_request.id
    try:
        await notify_enterprise_account_change(
            db,
            account,
            title=f"{enterprise} requested a business email change.",
            message=(
                f"{enterprise} requested a business email change to {new_email}. The proposed "
                "address must be verified before IT can approve it."
            ),
            notification_type="Enterprise Profile Change Request",
            source_type="enterprise.profile.email",
        )
    except Exception:
        await db.rollback()
        logger.exception(
            "Failed to publish email-change request notifications account_id=%s request_id=%s",
            notification_account_id,
            notification_request_id,
        )
    return AccountChangeRequestResponse(
        status="pending_verification",
        message=(
            "Verification emails were queued for the proposed and current addresses. "
            "IT can approve the change only after ownership is verified."
        ),
    )


@router.get(
    "/profile/business-email-change",
    response_model=AccountEmailChangeStatusResponse | None,
)
async def get_business_email_change_status(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountEmailChangeStatusResponse | None:
    require_enterprise_account(account)
    request = await get_active_account_email_change_request(db, account.id)
    if request is None:
        return None
    expires_at = request.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    expired = expires_at <= datetime.now(UTC)
    return AccountEmailChangeStatusResponse(
        requestId=request.id,
        requestedEmail=request.requested_email,
        status="expired" if expired else request.status,  # type: ignore[arg-type]
        isVerified=request.status == "verified" and not expired,
        expiresAt=request.expires_at,
    )


@router.delete("/profile/business-email-change", response_model=AccountChangeRequestResponse)
async def cancel_business_email_change(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountChangeRequestResponse:
    require_enterprise_account(account)
    try:
        request = await cancel_account_email_change(
            db,
            account_id=account.id,
            commit=False,
        )
    except AccountEmailChangeError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Cancel Business Email Change",
        target=account.email,
        summary=f"{account.display_name} cancelled a pending business email change.",
        source_id=account.id,
        metadata={"requestId": request.id, "requestedEmail": request.requested_email},
    )
    notifications = await mark_source_notifications_read(
        db,
        source_type="enterprise.profile.email",
        source_id=account.id,
        recipient_role=AccountRole.IT,
    )
    for notification in notifications:
        await operational_ws_manager.broadcast(
            OperationalWebSocketEnvelope(
                type="notification.updated",
                data=notification.model_dump(mode="json"),
            )
        )
    return AccountChangeRequestResponse(
        status="cancelled",
        message="The pending email change request was cancelled.",
    )


@router.post("/profile/contact-number-change", response_model=AccountChangeRequestResponse)
async def request_contact_number_change(
    payload: ContactNumberChangeRequest,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountChangeRequestResponse:
    require_enterprise_account(account)
    if payload.phone == account.phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This contact number is already active.",
        )

    set_pending_account_change(
        account,
        PENDING_CONTACT_NUMBER_CHANGE_KEY,
        {"phone": payload.phone, "requestedAt": datetime.now(UTC).isoformat()},
    )
    await db.commit()
    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Request Contact Number Change",
        target=account.email,
        summary=f"{account.display_name} requested a contact number change.",
        source_id=account.id,
    )
    enterprise = enterprise_label(account)
    await notify_enterprise_account_change(
        db,
        account,
        title=f"{enterprise} requested a contact number change.",
        message=f"{enterprise} requested a contact number change to {payload.phone}. IT review is required.",
        notification_type="Enterprise Profile Change Request",
        source_type="enterprise.profile.contact",
    )
    return AccountChangeRequestResponse(
        status="pending",
        message="Contact number change request sent to IT for review.",
    )


@router.get("/preferences", response_model=AccountPreferences)
async def get_preferences(
    account: Annotated[Account, Depends(get_current_account)],
) -> AccountPreferences:
    values = get_account_preferences(account)
    return AccountPreferences.model_validate(values)


@router.patch("/preferences", response_model=AccountPreferences)
async def update_preferences(
    payload: AccountPreferences,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountPreferences:
    values = get_account_preferences(account)
    patch_values = payload.model_dump(mode="json", exclude_unset=True)
    values.update(patch_values)
    set_account_preferences(account, values)
    await db.commit()
    return AccountPreferences.model_validate(values)


@router.get("/system-settings", response_model=SystemSettingsPayload)
async def get_system_settings(
    _: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SystemSettingsPayload:
    record = await db.scalar(
        select(SystemConfiguration).where(SystemConfiguration.id == SYSTEM_SETTINGS_ID)
    )
    return SystemSettingsPayload(
        values=load_system_settings_values(record),
        updatedBy=record.updated_by if record else None,
        updatedAt=record.updated_at if record else None,
    )


@router.patch("/system-settings", response_model=SystemSettingsPayload)
async def update_system_settings(
    payload: SystemSettingsPayload,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SystemSettingsPayload:
    if account.role != AccountRole.IT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="IT Personnel access required."
        )
    record = await db.scalar(
        select(SystemConfiguration).where(SystemConfiguration.id == SYSTEM_SETTINGS_ID)
    )
    if record is None:
        record = SystemConfiguration(id=SYSTEM_SETTINGS_ID)
        db.add(record)
    record.values_json = json.dumps(payload.values, sort_keys=True)
    record.updated_by = account.display_name
    await db.commit()
    await db.refresh(record)
    await record_auth_log(
        db,
        category="IT Activity",
        severity="Success",
        actor=account.display_name,
        actor_role="IT Personnel",
        action="Update System Settings",
        target="TANAW Configuration",
        summary=f"{account.display_name} saved persistent system settings.",
        source_id=record.id,
    )
    return SystemSettingsPayload(
        values=payload.values,
        updatedBy=record.updated_by,
        updatedAt=record.updated_at,
    )


async def record_auth_log(
    db: AsyncSession,
    *,
    category: str,
    severity: str,
    actor: str,
    actor_role: str,
    action: str,
    target: str,
    summary: str,
    source_id: str,
    metadata: dict[str, str | int | float | bool | None] | None = None,
) -> None:
    log = await create_activity_log(
        db,
        ActivityLogCreate(
            category=category,  # type: ignore[arg-type]
            severity=severity,  # type: ignore[arg-type]
            actor=actor,
            actorRole=actor_role,  # type: ignore[arg-type]
            action=action,
            target=target,
            summary=summary,
            sourceId=source_id,
            metadata=metadata,
        ),
    )
    await activity_log_manager.broadcast(log)
