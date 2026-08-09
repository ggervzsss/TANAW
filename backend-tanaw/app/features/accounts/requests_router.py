import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.api_helpers import (
    ensure_account_can_deactivate,
    ensure_privileged_account_remains_available,
    get_profile_request_current_value,
    get_profile_request_requested_value,
    mark_it_account_request_complete,
    notify_enterprise_profile_change_resolution,
    profile_request_label,
    resolve_verified_email_change_request,
    sync_pending_account_activation,
)
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.schemas import (
    AccountEmailChangeRequestResolution,
    AccountStatusUpdate,
    AccountSummary,
    EnterpriseProfileChangeRequestResolution,
    ProfileChangeRequestType,
)
from app.features.accounts.service import (
    clear_pending_profile_change_request,
    get_account_by_id,
    get_pending_profile_change_request,
    is_protected_startup_account,
    to_account_summary_with_requests,
)
from app.features.activity_logs.service import record_activity_log as record_account_log
from app.features.auth.account_activation import AccountActivationError, issue_account_activation
from app.features.auth.challenge_service import invalidate_password_reset_challenges
from app.features.auth.email_change import invalidate_account_email_change_requests

logger = logging.getLogger(__name__)

ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
EnterpriseReadAccount = Annotated[Account, Depends(require_roles({"it", "admin"}))]

router = APIRouter(prefix="/accounts", tags=["account requests"])


@router.patch(
    "/enterprises/{account_id}/profile-change-requests/{request_type}",
    response_model=AccountSummary,
)
async def resolve_enterprise_profile_change_request(
    account_id: str,
    request_type: ProfileChangeRequestType,
    payload: EnterpriseProfileChangeRequestResolution,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    account = await get_account_by_id(db, account_id)
    if account is None or account.role != AccountRole.ENTERPRISE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Enterprise account not found."
        )
    profile = account.enterprise_profile
    if profile is None:
        raise RuntimeError("Enterprise account is missing its profile.")

    if request_type == "businessEmail":
        return await resolve_verified_email_change_request(
            db,
            account_id=account.id,
            actor=actor,
            action=payload.action,
        )

    pending_request = get_pending_profile_change_request(account, request_type)
    if pending_request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile change request not found.",
        )

    previous_value = get_profile_request_current_value(account, request_type)
    requested_value = get_profile_request_requested_value(pending_request, request_type)

    if payload.action == "approve":
        account.phone = requested_value

    clear_pending_profile_change_request(account, request_type)
    await db.flush()
    await db.refresh(account)

    request_label = profile_request_label(request_type)
    resolution_label = "approved" if payload.action == "approve" else "declined"
    await record_account_log(
        db,
        category="IT Activity",
        severity="Success" if payload.action == "approve" else "Info",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action=f"{payload.action.title()} Enterprise Profile Change",
        target=profile.enterprise_name,
        summary=(
            f"{actor.display_name} {resolution_label} {profile.enterprise_name}'s "
            f"{request_label.lower()} change request."
        ),
        source_id=account.id,
        metadata={
            "requestType": request_type,
            "previousValue": previous_value,
            "requestedValue": requested_value,
            "resolution": payload.action,
        },
    )
    await notify_enterprise_profile_change_resolution(
        db,
        account=account,
        actor=actor,
        request_type=request_type,
        requested_value=requested_value,
        approved=payload.action == "approve",
    )
    await mark_it_account_request_complete(
        db, source_type="enterprise.profile.contact", account_id=account.id
    )
    return await to_account_summary_with_requests(db, account)


@router.patch("/{account_id}/email-change-request", response_model=AccountSummary)
async def resolve_verified_account_email_change_request(
    account_id: str,
    payload: AccountEmailChangeRequestResolution,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    return await resolve_verified_email_change_request(
        db,
        account_id=account_id,
        actor=actor,
        action=payload.action,
    )


@router.post("/{account_id}/activation", response_model=AccountSummary)
async def resend_activation(
    account_id: str,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    account = await get_account_by_id(db, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    if account.activated_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account is already activated. Use forgot password for recovery.",
        )
    try:
        await issue_account_activation(db, account)
    except AccountActivationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.flush()
    await db.refresh(account)
    await record_account_log(
        db,
        category="IT Activity",
        severity="Success",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action="Resend Account Activation",
        target=account.display_name,
        summary=f"{actor.display_name} resent the activation link for {account.display_name}.",
        source_id=account.id,
    )
    await record_account_log(
        db,
        category="System",
        severity="Info",
        actor="TANAW System",
        actor_role="System",
        action="Activation Email Queued",
        target=account.email,
        summary=f"The system queued a new account activation email for {account.display_name}.",
        source_id=account.id,
    )
    return await to_account_summary_with_requests(db, account)


@router.patch("/{account_id}/status", response_model=AccountSummary)
async def update_account_status(
    account_id: str,
    payload: AccountStatusUpdate,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    account = await get_account_by_id(db, account_id, for_update=True)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

    next_status = AccountStatus(payload.status)
    ensure_account_can_deactivate(account, next_status)
    if is_protected_startup_account(account) and next_status != account.status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Startup-seeded system accounts are protected.",
        )
    await ensure_privileged_account_remains_available(db, account, next_status)

    previous_status = account.status
    account.status = next_status
    if previous_status != account.status:
        access_changed_at = datetime.now(UTC)
        account.token_invalid_before = access_changed_at
        await invalidate_password_reset_challenges(db, account.id, invalidated_at=access_changed_at)
        if account.status == AccountStatus.INACTIVE:
            await invalidate_account_email_change_requests(
                db,
                account.id,
                invalidated_at=access_changed_at,
                reason="The account was deactivated before the email change was completed.",
            )
    await sync_pending_account_activation(
        db,
        account,
        email_changed=False,
        previous_status=previous_status,
    )
    await db.flush()
    await db.refresh(account)
    await record_account_log(
        db,
        category="IT Activity",
        severity="Success" if account.status == AccountStatus.ACTIVE else "Warning",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action="Update Account Status",
        target=account.display_name,
        summary=f"{actor.display_name} changed {account.display_name} account status to {account.status.value}.",
        source_id=account.id,
        metadata={"status": account.status.value},
    )
    return await to_account_summary_with_requests(db, account)
