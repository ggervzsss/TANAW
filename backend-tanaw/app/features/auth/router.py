import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.db.session import get_db
from app.features.accounts.dependencies import get_current_account
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
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
    PENDING_BUSINESS_EMAIL_CHANGE_KEY,
    PENDING_CONTACT_NUMBER_CHANGE_KEY,
    change_account_password,
    get_account_by_email,
    get_account_by_login_identifier,
    get_account_preferences,
    invalidate_account_tokens,
    record_login,
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
from app.features.auth.password_recovery import (
    OTP_TTL_MINUTES,
    PasswordRecoveryError,
    request_password_reset,
    reset_password_with_token,
    verify_password_reset_code,
)
from app.features.auth.schemas import (
    AccountActivationCompleteRequest,
    AccountActivationCompleteResponse,
    AccountActivationValidateRequest,
    AccountActivationValidateResponse,
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
    authenticate_account,
    clear_login_failures,
    lockout_seconds_remaining,
    login_lockout_message,
    register_failed_login,
    resolve_login_lockout_policy,
)
from app.features.mail.service import deliver_email, email_idempotency_key
from app.features.mail.templates import business_email_change_email
from app.features.operational.schemas import OperationalWebSocketEnvelope
from app.features.operational.service import (
    NOTIFY_FAILED_LOGIN_LOCKOUT_KEY,
    create_operational_alert,
    create_role_notifications,
    system_setting_enabled,
    to_operational_alert_summary,
)
from app.features.operational.websocket import operational_ws_manager

router = APIRouter(prefix="/auth", tags=["auth"])
SYSTEM_SETTINGS_ID = "default"
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
        enterprise=account.enterprise_name if account.role == AccountRole.ENTERPRISE else None,
        source_id=f"failed-login-threshold:{account.id}",
    )
    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(
            type="alert.created",
            data=to_operational_alert_summary(alert).model_dump(mode="json"),
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


def join_changed_fields(fields: list[str]) -> str:
    if len(fields) <= 1:
        return fields[0] if fields else "profile details"
    return f"{', '.join(fields[:-1])}, and {fields[-1]}"


def require_enterprise_account(account: Account) -> None:
    if account.role != AccountRole.ENTERPRISE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enterprise account access required.",
        )


def enterprise_label(account: Account) -> str:
    return account.enterprise_name or account.display_name


def set_pending_account_change(account: Account, key: str, value: dict[str, str]) -> None:
    preferences = get_account_preferences(account)
    preferences[key] = value
    set_account_preferences(account, preferences)


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


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest, db: Annotated[AsyncSession, Depends(get_db)]
) -> LoginResponse:
    candidate = await get_account_by_login_identifier(db, payload.username)
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

    account = await authenticate_account(db, payload.username, payload.password)
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
    await record_login(db, account)
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
    token = create_access_token(account.id, {"role": account.role.value})
    return LoginResponse(token=token, user=to_auth_user(account))


@router.get("/me", response_model=AuthUser)
async def me(account: Annotated[Account, Depends(get_current_account)]) -> AuthUser:
    return to_auth_user(account)


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
    enterprise = account.enterprise_name or account.display_name
    await notify_enterprise_account_change(
        db,
        account,
        title=f"{enterprise} changed account password.",
        message=f"{enterprise} changed account password.",
        notification_type="Enterprise Security Updated",
        source_type="enterprise.password",
    )
    token = create_access_token(account.id, {"role": account.role.value})
    return LoginResponse(token=token, user=to_auth_user(account))


@router.post("/forgot-password/request", response_model=ForgotPasswordRequestResponse)
async def forgot_password_request(
    payload: ForgotPasswordRequest, db: Annotated[AsyncSession, Depends(get_db)]
) -> ForgotPasswordRequestResponse:
    challenge = await request_password_reset(db, str(payload.email))
    return ForgotPasswordRequestResponse(challengeId=challenge.id, expiresInMinutes=OTP_TTL_MINUTES)


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
        recipient_roles=[AccountRole.ADMIN],
        title=f"Login support requested by {requester_name}.",
        message=f"{requester_email}: {payload.message.strip()}",
        notification_type="Login Support Request",
        severity="Warning",
        actor=None,
        source_type="operational.alert",
        source_id=alert.id,
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

    previous_manager_name = account.manager_name
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
        account.manager_name = payload.managerName
        enterprise_name = payload.enterpriseName.strip()
        account.enterprise_name = enterprise_name
        account.display_name = enterprise_name
        account.address = payload.address
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
    if account.role == AccountRole.ENTERPRISE:
        changed_fields: list[str] = []
        if account.manager_name != previous_manager_name:
            changed_fields.append("lead admin")
        if account.phone != previous_phone:
            changed_fields.append("contact number")

        if changed_fields:
            enterprise = account.enterprise_name or account.display_name
            changed_field_text = join_changed_fields(changed_fields)
            await notify_enterprise_account_change(
                db,
                account,
                title=f"{enterprise} updated enterprise profile details.",
                message=f"{enterprise} updated enterprise profile details: {changed_field_text}.",
                notification_type="Enterprise Profile Updated",
                source_type="enterprise.profile",
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
    require_enterprise_account(account)
    previous_manager_name = account.manager_name
    account.manager_name = payload.managerName
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
    if account.manager_name != previous_manager_name:
        enterprise = enterprise_label(account)
        await notify_enterprise_account_change(
            db,
            account,
            title=f"{enterprise} updated lead admin name.",
            message=f"{enterprise} updated lead admin name.",
            notification_type="Enterprise Profile Updated",
            source_type="enterprise.profile",
        )
    return to_auth_user(account)


@router.patch("/profile/building-capacity", response_model=AuthUser)
async def update_building_capacity(
    payload: BuildingCapacityUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    require_enterprise_account(account)
    previous_capacity = account.building_capacity
    account.building_capacity = payload.buildingCapacity
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
        summary=f"{account.display_name} updated building capacity to {account.building_capacity}.",
        source_id=account.id,
        metadata={
            "previousBuildingCapacity": previous_capacity,
            "buildingCapacity": account.building_capacity,
        },
    )
    if account.building_capacity != previous_capacity:
        enterprise = enterprise_label(account)
        await notify_enterprise_account_change(
            db,
            account,
            title=f"{enterprise} updated building capacity.",
            message=(
                f"{enterprise} updated building capacity from "
                f"{previous_capacity} to {account.building_capacity}."
            ),
            notification_type="Enterprise Profile Updated",
            source_type="enterprise.capacity",
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
    if new_email == account.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This business email is already active.",
        )
    existing = await get_account_by_email(db, new_email)
    if existing is not None and existing.id != account.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already in use.")

    set_pending_account_change(
        account,
        PENDING_BUSINESS_EMAIL_CHANGE_KEY,
        {"email": new_email, "requestedAt": datetime.now(UTC).isoformat()},
    )
    await deliver_email(
        db,
        account_id=account.id,
        recipient=new_email,
        content=business_email_change_email(account, new_email),
        idempotency_key=email_idempotency_key(
            "business-email-change", f"{account.id}-{int(datetime.now(UTC).timestamp())}"
        ),
        tags={"category": "business_email_change"},
    )
    await db.commit()
    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Request Business Email Change",
        target=account.email,
        summary=f"{account.display_name} requested a business email change.",
        source_id=account.id,
    )
    enterprise = enterprise_label(account)
    await notify_enterprise_account_change(
        db,
        account,
        title=f"{enterprise} requested a business email change.",
        message=f"{enterprise} requested a business email change to {new_email}. IT review is required.",
        notification_type="Enterprise Profile Change Request",
        source_type="enterprise.profile.email",
    )
    return AccountChangeRequestResponse(
        status="pending",
        message="Business email change request sent to IT and Admin for review.",
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
        message="Contact number change request sent to IT and Admin for review.",
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
