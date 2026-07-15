import asyncio
import hashlib
import logging
from datetime import UTC, datetime
from time import monotonic
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.features.accounts.dependencies import get_current_account
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    SystemSetting,
)
from app.features.accounts.schemas import (
    AccountChangeRequestResponse,
    AuthUser,
    BuildingCapacityUpdate,
    BusinessEmailChangeRequest,
    ContactNumberChangeRequest,
    LeadAdminNameUpdate,
    PasswordChangeRequest,
    ProfileUpdate,
)
from app.features.accounts.service import (
    change_account_password,
    get_account_by_login_identifier,
    invalidate_account_tokens,
    to_auth_user_with_asset,
)
from app.features.accounts.settings import (
    apply_system_settings,
    system_settings_values,
)
from app.features.accounts.settings import (
    get_system_settings as get_system_settings_record,
)
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log, get_actor_role_label
from app.features.alerts.service import create_operational_alert
from app.features.assets.runtime import get_asset_storage
from app.features.assets.service import (
    delete_profile_asset,
    get_account_theme,
    read_profile_asset,
    replace_profile_asset,
    request_contact_change,
    set_account_theme,
)
from app.features.assets.storage import (
    AssetStorage,
    AssetStorageError,
    AssetValidationError,
    inline_content_disposition,
    validate_image,
)
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
from app.features.notifications.service import (
    NOTIFY_FAILED_LOGIN_LOCKOUT_KEY,
    create_role_notifications,
    system_setting_enabled,
)
from app.features.topology.account_scope import (
    invalidate_site_coordinates,
    load_account_topology,
    replace_site_location,
    require_account_topology,
)

AssetStorageDependency = Annotated[AssetStorage, Depends(get_asset_storage)]
router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)
ENTERPRISE_CHANGE_NOTIFICATION_ROLES = (
    AccountRole.ADMIN,
    AccountRole.IT,
)


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

    topology = (
        await require_account_topology(db, account)
        if account.role == AccountRole.ENTERPRISE
        else None
    )
    await create_operational_alert(
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
        enterprise=topology.enterprise.name if topology is not None else None,
        source_id=f"failed-login-threshold:{account.id}",
    )
    await db.commit()


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

    await create_role_notifications(
        db,
        recipient_roles=ENTERPRISE_CHANGE_NOTIFICATION_ROLES,
        title=title,
        message=message,
        notification_type=notification_type,
        severity="Info",
        actor=account,
        source_type=source_type,
        source_id=account.id,
    )
    await db.commit()


async def get_login_lockout_policy(db: AsyncSession) -> LoginLockoutPolicy:
    return resolve_login_lockout_policy(
        system_settings_values(await get_system_settings_record(db))
    )


def join_changed_fields(fields: list[str]) -> str:
    if len(fields) <= 1:
        return fields[0] if fields else "profile details"
    return f"{', '.join(fields[:-1])}, and {fields[-1]}"


async def _wait_for_password_reset_response_floor(started_at: float) -> None:
    remaining = get_settings().password_reset_response_floor_seconds - (monotonic() - started_at)
    if remaining > 0:
        await asyncio.sleep(remaining)


def require_enterprise_account(account: Account) -> None:
    if account.role != AccountRole.ENTERPRISE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enterprise account access required.",
        )


async def enterprise_label(db: AsyncSession, account: Account) -> str:
    return (await require_account_topology(db, account)).enterprise.name


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
    payload: LoginRequest, db: Annotated[AsyncSession, Depends(get_db)]
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
    topology = await load_account_topology(db, account)
    account.last_login_at = datetime.now(UTC)
    token = create_access_token(account.id, {"role": account.role.value})
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
    return LoginResponse(
        token=token,
        user=await to_auth_user_with_asset(db, account, topology),
    )


@router.get("/me", response_model=AuthUser)
async def me(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    return await to_auth_user_with_asset(db, account, await load_account_topology(db, account))


@router.post("/logout")
async def logout(
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
    return {"status": "ok"}


@router.post("/change-password", response_model=LoginResponse)
async def change_password(
    payload: PasswordChangeRequest,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    topology = await load_account_topology(db, account)
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
    if topology is not None:
        enterprise = topology.enterprise.name
        await notify_enterprise_account_change(
            db,
            account,
            title=f"{enterprise} changed account password.",
            message=f"{enterprise} changed account password.",
            notification_type="Enterprise Security Updated",
            source_type="enterprise.password",
        )
    token = create_access_token(account.id, {"role": account.role.value})
    return LoginResponse(
        token=token,
        user=await to_auth_user_with_asset(db, account, topology),
    )


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
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.ADMIN],
        title=f"Login support requested by {requester_name}.",
        message=f"{requester_email}: {payload.message.strip()}",
        notification_type="Login Support Request",
        severity="Warning",
        actor=None,
        source_type="operational.alert",
        source_id=alert.id,
    )
    await db.commit()
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

    topology = await load_account_topology(db, account, lock=True)
    previous_manager_name = account.display_name
    previous_phone = account.phone
    account.phone = payload.phone
    if account.role == AccountRole.ENTERPRISE:
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
        if topology is None:
            raise RuntimeError("Enterprise profile has no normalized topology.")
        account.display_name = payload.managerName
        enterprise_name = payload.enterpriseName.strip()
        topology.enterprise.name = enterprise_name
        topology.site.name = f"{enterprise_name} Primary Site"
        if topology.location.address != payload.address:
            await invalidate_site_coordinates(
                db,
                topology.site,
                topology.location,
                barangay=topology.location.barangay,
                address=payload.address,
                building_capacity=topology.location.building_capacity,
            )
    else:
        if payload.firstName is None or payload.lastName is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="First and last names are required.",
            )
        account.first_name = payload.firstName
        account.last_name = payload.lastName
        account.display_name = f"{payload.firstName} {payload.lastName}"
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
    if account.role == AccountRole.ENTERPRISE:
        changed_fields: list[str] = []
        if account.display_name != previous_manager_name:
            changed_fields.append("lead admin")
        if account.phone != previous_phone:
            changed_fields.append("contact number")

        if changed_fields:
            if topology is None:
                raise RuntimeError("Enterprise profile has no normalized topology.")
            enterprise = topology.enterprise.name
            changed_field_text = join_changed_fields(changed_fields)
            await notify_enterprise_account_change(
                db,
                account,
                title=f"{enterprise} updated enterprise profile details.",
                message=f"{enterprise} updated enterprise profile details: {changed_field_text}.",
                notification_type="Enterprise Profile Updated",
                source_type="enterprise.profile",
            )
    return await to_auth_user_with_asset(db, account, topology)


@router.put("/profile/image", response_model=AuthUser)
async def upload_profile_image(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: AssetStorageDependency,
    file: Annotated[UploadFile, File()],
) -> AuthUser:
    topology = await load_account_topology(db, account)
    settings = get_settings()
    content = await file.read(settings.profile_image_max_bytes + 1)
    try:
        image = validate_image(
            file_name=file.filename or "",
            declared_mime_type=file.content_type,
            content=content,
            max_bytes=settings.profile_image_max_bytes,
        )
        await replace_profile_asset(
            db,
            storage=storage,
            account=account,
            image=image,
        )
    except AssetValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except AssetStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Profile image storage is unavailable.",
        ) from exc
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
    return await to_auth_user_with_asset(db, account, topology)


@router.get("/profile/image/{asset_id}")
async def get_profile_image(
    asset_id: str,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: AssetStorageDependency,
) -> Response:
    try:
        result = await read_profile_asset(
            db,
            storage=storage,
            account_id=account.id,
            asset_id=asset_id,
        )
    except AssetStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Profile image storage is unavailable.",
        ) from exc
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Profile image not found."
        )
    asset, content = result
    return Response(
        content=content,
        media_type=asset.mime_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": inline_content_disposition(asset.file_name),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/profile/image", response_model=AuthUser)
async def remove_profile_image(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: AssetStorageDependency,
) -> AuthUser:
    topology = await load_account_topology(db, account)
    await delete_profile_asset(db, storage=storage, account_id=account.id)
    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Remove Profile Logo",
        target=account.email,
        summary=f"{account.display_name} removed their profile logo.",
        source_id=account.id,
    )
    return await to_auth_user_with_asset(db, account, topology)


@router.patch("/profile/lead-admin", response_model=AuthUser)
async def update_lead_admin_name(
    payload: LeadAdminNameUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    require_enterprise_account(account)
    topology = await require_account_topology(db, account, lock=True)
    previous_manager_name = account.display_name
    account.display_name = payload.managerName
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
    if account.display_name != previous_manager_name:
        enterprise = topology.enterprise.name
        await notify_enterprise_account_change(
            db,
            account,
            title=f"{enterprise} updated lead admin name.",
            message=f"{enterprise} updated lead admin name.",
            notification_type="Enterprise Profile Updated",
            source_type="enterprise.profile",
        )
    return await to_auth_user_with_asset(db, account, topology)


@router.patch("/profile/building-capacity", response_model=AuthUser)
async def update_building_capacity(
    payload: BuildingCapacityUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    require_enterprise_account(account)
    topology = await require_account_topology(db, account, lock=True)
    previous_capacity = topology.location.building_capacity
    if previous_capacity != payload.buildingCapacity:
        await replace_site_location(
            db,
            site=topology.site,
            current=topology.location,
            barangay=topology.location.barangay,
            address=topology.location.address,
            timezone_name=topology.location.timezone_name,
            building_capacity=payload.buildingCapacity,
            latitude=topology.location.latitude,
            longitude=topology.location.longitude,
            location_source=topology.location.location_source,
            location_confidence=topology.location.location_confidence,
            geocoded_address=topology.location.geocoded_address,
            coordinates_confirmed_at=topology.location.coordinates_confirmed_at,
            change_reason="building_capacity_changed",
        )
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
        summary=f"{account.display_name} updated building capacity to {payload.buildingCapacity}.",
        source_id=account.id,
        metadata={
            "previousBuildingCapacity": previous_capacity,
            "buildingCapacity": payload.buildingCapacity,
        },
    )
    if payload.buildingCapacity != previous_capacity:
        enterprise = topology.enterprise.name
        await notify_enterprise_account_change(
            db,
            account,
            title=f"{enterprise} updated building capacity.",
            message=(
                f"{enterprise} updated building capacity from "
                f"{previous_capacity} to {payload.buildingCapacity}."
            ),
            notification_type="Enterprise Profile Updated",
            source_type="enterprise.capacity",
        )
    return await to_auth_user_with_asset(db, account, await require_account_topology(db, account))


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
    enterprise = await enterprise_label(db, account)
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
    enterprise = await enterprise_label(db, account)
    notification_account_id = account.id
    notification_request_id = request.id
    try:
        await notify_enterprise_account_change(
            db,
            account,
            title=f"{enterprise} cancelled a business email change request.",
            message=f"{enterprise} cancelled its pending business email change request.",
            notification_type="Enterprise Profile Change Request",
            source_type="enterprise.profile.email",
        )
    except Exception:
        await db.rollback()
        logger.exception(
            "Failed to publish email-change cancellation notifications account_id=%s request_id=%s",
            notification_account_id,
            notification_request_id,
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

    await request_contact_change(
        db,
        account_id=account.id,
        requested_value=payload.phone,
        requested_at=datetime.now(UTC),
    )
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
    enterprise = await enterprise_label(db, account)
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
        message="Contact number change request sent to IT and Admin for review.",
    )


@router.get("/preferences", response_model=AccountPreferences)
async def get_preferences(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountPreferences:
    return AccountPreferences(theme=await get_account_theme(db, account_id=account.id))


@router.patch("/preferences", response_model=AccountPreferences)
async def update_preferences(
    payload: AccountPreferences,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountPreferences:
    preference = await set_account_theme(db, account_id=account.id, theme=payload.theme)
    return AccountPreferences.model_validate({"theme": preference.theme})


@router.get("/system-settings", response_model=SystemSettingsPayload)
async def get_system_settings(
    _: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SystemSettingsPayload:
    record = await get_system_settings_record(db)
    return SystemSettingsPayload(
        values=system_settings_values(record),
        updatedBy=record.updated_by_name if record else None,
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
    record = await get_system_settings_record(db)
    if record is None:
        record = SystemSetting(id="default")
        db.add(record)
    apply_system_settings(record, payload.values)
    record.updated_by_account_id = account.id
    record.updated_by_name = account.display_name
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
        updatedBy=record.updated_by_name,
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
    await create_activity_log(
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
    await db.commit()
