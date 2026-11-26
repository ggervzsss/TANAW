import logging

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.schemas import AccountSummary, ProfileChangeRequestType
from app.features.accounts.service import (
    clear_pending_profile_change_request,
    get_account_by_email,
    get_pending_profile_change_request,
    to_account_summary_with_requests,
)
from app.features.activity_logs.service import record_activity_log as record_account_log
from app.features.auth.account_activation import (
    invalidate_account_activation_tokens,
    issue_account_activation,
)
from app.features.auth.email_change import (
    AccountEmailChangeError,
    resolve_account_email_change,
)
from app.features.notifications.service import (
    create_user_notification,
    mark_source_notifications_read,
)
from app.features.requests.service import close_account_change_request

logger = logging.getLogger(__name__)

PROFILE_CHANGE_SOURCE_TYPES: dict[str, str] = {
    "businessEmail": "enterprise.profile.email",
    "contactNumber": "enterprise.profile.contact",
    "enterpriseName": "enterprise.profile.name",
}


def ensure_account_can_deactivate(account: Account, next_status: AccountStatus) -> None:
    if (
        next_status == AccountStatus.INACTIVE
        and account.status == AccountStatus.ACTIVE
        and account.activated_at is None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "account_activation_pending",
                "message": "This account has not completed activation and cannot be deactivated.",
            },
        )


async def sync_pending_account_activation(
    db: AsyncSession,
    account: Account,
    *,
    email_changed: bool,
    previous_status: AccountStatus,
) -> None:
    if account.activated_at is not None:
        return
    if account.status == AccountStatus.INACTIVE:
        await invalidate_account_activation_tokens(db, account.id)
        return
    if email_changed or previous_status == AccountStatus.INACTIVE:
        await issue_account_activation(db, account)


async def ensure_privileged_account_remains_available(
    db: AsyncSession, account: Account, next_status: AccountStatus
) -> None:
    if (
        next_status != AccountStatus.INACTIVE
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is None
    ):
        return

    protected_role_messages = {
        AccountRole.IT: "Cannot disable the last active IT Personnel account.",
        AccountRole.ADMIN: "Cannot disable the last active Admin account.",
    }
    detail = protected_role_messages.get(account.role)
    if detail is None:
        return

    active_count = await db.scalar(
        select(func.count())
        .select_from(Account)
        .where(
            Account.role == account.role,
            Account.status == AccountStatus.ACTIVE,
            Account.activated_at.is_not(None),
        )
    )
    if (active_count or 0) <= 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


async def ensure_role_update_keeps_it_access(
    db: AsyncSession, account: Account, next_role: AccountRole
) -> None:
    if (
        account.role != AccountRole.IT
        or next_role == AccountRole.IT
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is None
    ):
        return

    active_it_count = await db.scalar(
        select(func.count())
        .select_from(Account)
        .where(
            Account.role == AccountRole.IT,
            Account.status == AccountStatus.ACTIVE,
            Account.activated_at.is_not(None),
        )
    )
    if (active_it_count or 0) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot demote the last active IT Personnel account.",
        )


async def ensure_unique_account_email(
    db: AsyncSession, email: str, current_account_id: str
) -> None:
    existing = await get_account_by_email(db, email)
    if existing is not None and existing.id != current_account_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )


def get_profile_request_requested_value(
    pending_request: dict[str, str], request_type: ProfileChangeRequestType
) -> str:
    key = {"businessEmail": "email", "contactNumber": "phone", "enterpriseName": "name"}
    return pending_request[key[request_type]]


def get_profile_request_current_value(
    account: Account, request_type: ProfileChangeRequestType
) -> str:
    if request_type == "businessEmail":
        return account.email
    if request_type == "enterpriseName":
        profile = account.enterprise_profile
        return profile.enterprise_name if profile is not None else account.display_name
    return account.phone or ""


def profile_request_label(request_type: ProfileChangeRequestType) -> str:
    return {
        "businessEmail": "Business Email",
        "contactNumber": "Contact Number",
        "enterpriseName": "Enterprise Name",
    }[request_type]


def email_change_http_exception(exc: AccountEmailChangeError) -> HTTPException:
    detail = str(exc)
    if detail in {"Account not found.", "Email change request not found."}:
        response_status = status.HTTP_404_NOT_FOUND
    elif "already" in detail.lower() or "pending" in detail.lower():
        response_status = status.HTTP_409_CONFLICT
    else:
        response_status = status.HTTP_400_BAD_REQUEST
    return HTTPException(status_code=response_status, detail=detail)


async def resolve_verified_email_change_request(
    db: AsyncSession,
    *,
    account_id: str,
    actor: Account,
    action: str,
) -> AccountSummary:
    try:
        account, request = await resolve_account_email_change(
            db,
            account_id=account_id,
            actor=actor,
            approve=action == "approve",
            commit=False,
        )
    except AccountEmailChangeError as exc:
        raise email_change_http_exception(exc) from exc

    approved = action == "approve"
    resolution_label = "approved" if approved else "declined"
    if account.role == AccountRole.ENTERPRISE:
        await close_account_change_request(
            db, account.id, "businessEmail", approved=approved, actor=actor
        )
    await record_account_log(
        db,
        group="Accounts",
        severity="Success" if approved else "Info",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action=f"{action.title()} Account Change",
        target=account.display_name,
        summary=(
            f"{actor.display_name} {resolution_label} {account.display_name}'s verified "
            "email change request."
        ),
        source_id=account.id,
        metadata={
            "requestId": request.id,
            "previousEmail": request.old_email,
            "requestedEmail": request.requested_email,
            "resolution": action,
            "ownershipVerified": request.verified_at is not None,
        },
    )
    await db.refresh(account)
    notification_account_id = account.id
    notification_request_id = request.id
    try:
        await create_user_notification(
            db,
            recipient=account,
            title=f"Email change request {resolution_label}.",
            message=(
                f"IT {resolution_label} your verified email change request"
                f"{f' to {request.requested_email}' if approved else ''}."
            ),
            notification_type="Account Email Change Request",
            severity="Success" if approved else "Info",
            actor=actor,
            source_type="account.profile.email",
            source_id=request.id,
        )
    except Exception:
        await db.rollback()
        logger.exception(
            "Failed to publish email-change resolution notification account_id=%s request_id=%s",
            notification_account_id,
            notification_request_id,
        )
        await db.refresh(account)
    await mark_it_account_request_complete(
        db, source_type="enterprise.profile.email", account_id=account.id
    )
    return await to_account_summary_with_requests(db, account, viewer=actor)


async def mark_it_account_request_complete(
    db: AsyncSession, *, source_type: str, account_id: str
) -> None:
    await mark_source_notifications_read(
        db,
        source_type=source_type,
        source_id=account_id,
        recipient_role=AccountRole.IT,
    )


async def notify_enterprise_profile_change_resolution(
    db: AsyncSession,
    *,
    account: Account,
    actor: Account,
    request_type: ProfileChangeRequestType,
    requested_value: str,
    approved: bool,
) -> None:
    request_label = profile_request_label(request_type)
    resolution_text = "approved" if approved else "declined"
    await create_user_notification(
        db,
        recipient=account,
        title=f"{request_label} change request {resolution_text}.",
        message=(
            f"IT {resolution_text} your {request_label.lower()} change request"
            f"{f' to {requested_value}' if approved else ''}."
        ),
        notification_type="Enterprise Profile Change Request",
        severity="Success" if approved else "Info",
        actor=actor,
        source_type=PROFILE_CHANGE_SOURCE_TYPES[request_type],
        source_id=account.id,
    )


async def resolve_enterprise_profile_change(
    db: AsyncSession,
    *,
    account: Account,
    actor: Account,
    request_type: ProfileChangeRequestType,
    action: str,
) -> AccountSummary:
    """Approve or decline a pending contact number or enterprise name change."""
    if request_type == "businessEmail":
        return await resolve_verified_email_change_request(
            db, account_id=account.id, actor=actor, action=action
        )
    profile = account.enterprise_profile
    if profile is None:
        raise RuntimeError("Enterprise account is missing its profile.")
    pending_request = get_pending_profile_change_request(account, request_type)
    if pending_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account change request not found.",
        )
    previous_value = get_profile_request_current_value(account, request_type)
    requested_value = get_profile_request_requested_value(pending_request, request_type)
    approved = action == "approve"
    if approved and request_type == "contactNumber":
        account.phone = requested_value
    if approved and request_type == "enterpriseName":
        profile.enterprise_name = requested_value
        account.display_name = requested_value
    clear_pending_profile_change_request(account, request_type)
    await db.flush()
    await db.refresh(account)
    await close_account_change_request(db, account.id, request_type, approved=approved, actor=actor)

    request_label = profile_request_label(request_type)
    resolution_label = "approved" if approved else "declined"
    await record_account_log(
        db,
        group="Accounts",
        severity="Success" if approved else "Info",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action=f"{action.title()} Account Change",
        target=profile.enterprise_name,
        summary=(
            f"{actor.display_name} {resolution_label} {profile.enterprise_name}'s "
            f"{request_label.lower()} change."
        ),
        source_id=account.id,
        it_detail=f"{request_label}: {previous_value or 'none'} → {requested_value}.",
        metadata={
            "requestType": request_type,
            "previousValue": previous_value,
            "requestedValue": requested_value,
            "resolution": action,
        },
    )
    await notify_enterprise_profile_change_resolution(
        db,
        account=account,
        actor=actor,
        request_type=request_type,
        requested_value=requested_value,
        approved=approved,
    )
    await mark_it_account_request_complete(
        db, source_type=PROFILE_CHANGE_SOURCE_TYPES[request_type], account_id=account.id
    )
    return await to_account_summary_with_requests(db, account, viewer=actor)
