import json
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.features.accounts.dependencies import get_current_account
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    DeliveryChannel,
    DeliveryStatus,
    DevDelivery,
    SystemConfiguration,
)
from app.features.accounts.schemas import AuthUser, PasswordChangeRequest, ProfileUpdate
from app.features.accounts.service import (
    change_account_password,
    get_account_by_email,
    get_account_by_login_identifier,
    invalidate_account_tokens,
    record_login,
    to_auth_user,
)
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log, get_actor_role_label
from app.features.activity_logs.websocket import activity_log_manager
from app.features.auth.password_recovery import (
    OTP_TTL_MINUTES,
    PasswordRecoveryError,
    request_password_reset,
    reset_password_with_token,
    verify_password_reset_code,
)
from app.features.auth.schemas import (
    AccountPreferences,
    ForgotPasswordRequest,
    ForgotPasswordRequestResponse,
    ForgotPasswordResetRequest,
    ForgotPasswordVerifyRequest,
    ForgotPasswordVerifyResponse,
    LoginRequest,
    LoginResponse,
    StatusResponse,
    SupportInfoResponse,
    SupportRequest,
    SystemSettingsPayload,
)
from app.features.auth.service import (
    authenticate_account,
    clear_login_failures,
    lockout_seconds_remaining,
    register_failed_login,
)
from app.features.operational.service import create_operational_alert

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


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


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest, db: Annotated[AsyncSession, Depends(get_db)]
) -> LoginResponse:
    candidate = await get_account_by_login_identifier(db, payload.username)
    if candidate is not None:
        remaining = lockout_seconds_remaining(candidate)
        if remaining > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "message": "Account temporarily locked after three failed attempts.",
                    "retryAfterSeconds": remaining,
                },
                headers={"Retry-After": str(remaining)},
            )

    account = await authenticate_account(db, payload.username, payload.password)
    if (
        account is None
        or account.status != AccountStatus.ACTIVE
        or not is_login_scope_allowed(account, payload.loginScope)
    ):
        if candidate is not None:
            remaining = register_failed_login(candidate)
            await db.commit()
            if remaining > 0:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "message": "Account temporarily locked after three failed attempts.",
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
    token = create_access_token(
        account.id,
        {"role": account.role.value, "must_change_password": account.must_change_password},
    )
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
    token = create_access_token(
        account.id, {"role": account.role.value, "must_change_password": False}
    )
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
) -> ForgotPasswordVerifyResponse:
    try:
        reset_token = verify_password_reset_code(payload.challengeId, payload.code)
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


@router.get("/support-info", response_model=SupportInfoResponse)
async def get_support_info() -> SupportInfoResponse:
    has_contact = bool(settings.support_email or settings.support_phone)
    return SupportInfoResponse(
        supportEmail=settings.support_email,
        supportPhone=settings.support_phone,
        message=(
            "Use the configured support contact below."
            if has_contact
            else "Please contact the TANAW system administrator."
        ),
    )


@router.post("/support-request", response_model=StatusResponse)
async def create_support_request(
    payload: SupportRequest, db: Annotated[AsyncSession, Depends(get_db)]
) -> StatusResponse:
    recipient = settings.support_email or "TANAW system administrator"
    db.add(
        DevDelivery(
            account_id=str(uuid4()),
            channel=DeliveryChannel.EMAIL,
            recipient=recipient,
            subject="TANAW login support request",
            body=(
                "A login support request was recorded.\n\n"
                f"Name: {payload.name.strip()}\n"
                f"Email: {payload.email}\n\n"
                f"Message:\n{payload.message.strip()}\n\n"
                "No external email was sent by the local development logger."
            ),
            status=DeliveryStatus.RECORDED,
        ),
    )
    await db.commit()
    await create_operational_alert(
        db,
        alert_type="Maintenance Request",
        severity="Warning",
        requester=payload.name.strip(),
        summary=payload.message.strip(),
        required_action="Review the login support request and contact the requester.",
        resolution_mode="Remote Review",
        owner="IT",
        enterprise=None,
        source_id=f"support:{payload.email}:{payload.message.strip()}",
    )
    return StatusResponse(status="ok")


@router.patch("/profile", response_model=AuthUser)
async def update_profile(
    payload: ProfileUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    existing = await get_account_by_email(db, str(payload.email))
    if existing is not None and existing.id != account.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already in use.")

    account.email = str(payload.email)
    account.phone = payload.phone
    if account.role == AccountRole.ENTERPRISE:
        if payload.managerName is None or payload.enterpriseName is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Manager and enterprise names are required.",
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


@router.get("/preferences", response_model=AccountPreferences)
async def get_preferences(
    account: Annotated[Account, Depends(get_current_account)],
) -> AccountPreferences:
    values = json.loads(account.preferences_json or "{}")
    return AccountPreferences.model_validate(values)


@router.patch("/preferences", response_model=AccountPreferences)
async def update_preferences(
    payload: AccountPreferences,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountPreferences:
    account.preferences_json = payload.model_dump_json()
    await db.commit()
    return payload


@router.post("/data-archive", response_model=StatusResponse)
async def request_data_archive(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StatusResponse:
    db.add(
        DevDelivery(
            account_id=account.id,
            channel=DeliveryChannel.EMAIL,
            recipient=account.email,
            subject="TANAW data archive request",
            body=(
                f"Data archive requested by {account.display_name}. "
                "The request includes available account activity, reports, and audit logs."
            ),
            status=DeliveryStatus.RECORDED,
        )
    )
    await db.commit()
    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Request Data Archive",
        target=account.email,
        summary=f"{account.display_name} requested a compliance data archive.",
        source_id=account.id,
    )
    return StatusResponse(status="recorded")


@router.get("/system-settings", response_model=SystemSettingsPayload)
async def get_system_settings(
    _: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SystemSettingsPayload:
    record = await db.scalar(select(SystemConfiguration).where(SystemConfiguration.id == "default"))
    return SystemSettingsPayload(values=json.loads(record.values_json) if record else {})


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
    record = await db.scalar(select(SystemConfiguration).where(SystemConfiguration.id == "default"))
    if record is None:
        record = SystemConfiguration(id="default")
        db.add(record)
    record.values_json = json.dumps(payload.values, sort_keys=True)
    record.updated_by = account.display_name
    await db.commit()
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
    return payload


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
        ),
    )
    await activity_log_manager.broadcast(log)
