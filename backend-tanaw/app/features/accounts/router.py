import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.location_validation import is_inside_san_pedro
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.schemas import (
    AccountEmailChangeRequestResolution,
    AccountStatusUpdate,
    AccountSummary,
    DeliverySummary,
    EnterpriseAccountCreate,
    EnterpriseAccountUpdate,
    EnterpriseProfileChangeRequestResolution,
    LguAccountCreate,
    LguAccountUpdate,
    ProfileChangeRequestType,
)
from app.features.accounts.service import (
    account_role_from_value,
    clear_pending_profile_change_request,
    create_account_with_activation,
    generate_enterprise_id,
    get_account_by_email,
    get_account_by_id,
    get_pending_profile_change_request,
    is_protected_startup_account,
    list_accounts_by_roles,
    to_account_summaries_with_requests,
    to_account_summary_with_requests,
    to_delivery_summary,
)
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.auth.account_activation import (
    AccountActivationError,
    invalidate_account_activation_tokens,
    issue_account_activation,
)
from app.features.auth.challenge_service import invalidate_password_reset_challenges
from app.features.auth.email_change import (
    AccountEmailChangeError,
    invalidate_account_email_change_requests,
    request_account_email_change,
    resolve_account_email_change,
)
from app.features.mail.dev_log import (
    get_dev_delivery as find_dev_delivery,
)
from app.features.mail.dev_log import (
    list_dev_deliveries as list_ephemeral_dev_deliveries,
)
from app.features.operational.service import (
    create_user_notification,
    mark_source_notifications_read,
)

router = APIRouter(prefix="/accounts", tags=["accounts"])
dev_router = APIRouter(prefix="/dev", tags=["dev"])
logger = logging.getLogger(__name__)

ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
EnterpriseReadAccount = Annotated[Account, Depends(require_roles({"it", "admin"}))]


@router.get("/lgu", response_model=list[AccountSummary])
async def list_lgu_accounts(
    _: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[AccountSummary]:
    accounts = await list_accounts_by_roles(
        db, [AccountRole.IT, AccountRole.ADMIN, AccountRole.STAFF]
    )
    return await to_account_summaries_with_requests(db, accounts)


@router.post("/lgu", response_model=AccountSummary, status_code=status.HTTP_201_CREATED)
async def create_lgu_account(
    payload: LguAccountCreate,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    existing = await get_account_by_email(db, str(payload.email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    role = account_role_from_value(payload.role)
    title_by_role = {
        AccountRole.ADMIN: "Admin",
        AccountRole.IT: "IT Personnel",
        AccountRole.STAFF: "LGU Staff",
    }
    account = await create_account_with_activation(
        db,
        email=str(payload.email),
        phone=payload.phone,
        role=role,
        display_name=f"{payload.firstName} {payload.lastName}",
        title=title_by_role[role],
        first_name=payload.firstName,
        last_name=payload.lastName,
    )
    await record_account_log(
        db,
        category="IT Activity",
        severity="Success",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action="Create LGU Account",
        target=account.email,
        summary=f"{actor.display_name} created {account.title} account {account.display_name}.",
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
        summary=f"The system queued an account activation email for {account.display_name}.",
        source_id=account.id,
    )
    return await to_account_summary_with_requests(db, account)


@router.patch("/lgu/{account_id}", response_model=AccountSummary)
async def update_lgu_account(
    account_id: str,
    payload: LguAccountUpdate,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    account = await get_account_by_id(db, account_id, for_update=True)
    if account is None or account.role == AccountRole.ENTERPRISE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LGU account not found.")
    if is_protected_startup_account(account):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Startup-seeded system accounts are protected.",
        )

    next_role = account_role_from_value(payload.role)
    next_status = AccountStatus(payload.status)
    ensure_account_can_deactivate(account, next_status)
    if account.id == actor.id and (
        next_role != AccountRole.IT or next_status != AccountStatus.ACTIVE
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own IT Personnel access.",
        )
    await ensure_role_update_keeps_it_access(db, account, next_role)
    await ensure_privileged_account_remains_available(db, account, next_status)
    requested_email = str(payload.email)
    await ensure_unique_account_email(db, requested_email, account.id)

    previous_email = account.email
    previous_role = account.role
    previous_status = account.status
    email_changed = previous_email != requested_email
    if account.activated_at is not None and email_changed and next_status != AccountStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Keep the account active while verifying a new email address.",
        )
    account.first_name = payload.firstName
    account.last_name = payload.lastName
    account.display_name = f"{payload.firstName} {payload.lastName}"
    account.phone = payload.phone
    account.role = next_role
    account.title = {
        AccountRole.ADMIN: "Admin",
        AccountRole.IT: "IT Personnel",
        AccountRole.STAFF: "LGU Staff",
    }[next_role]
    account.status = next_status
    email_change_requested = False
    if email_changed:
        if account.activated_at is None:
            account.email = requested_email
        else:
            try:
                await request_account_email_change(
                    db,
                    account_id=account.id,
                    requested_email=requested_email,
                    requested_by=actor,
                )
            except AccountEmailChangeError as exc:
                raise email_change_http_exception(exc) from exc
            email_change_requested = True
    if previous_role != account.role or previous_status != account.status:
        access_changed_at = datetime.now(UTC)
        account.token_invalid_before = access_changed_at
        await invalidate_password_reset_challenges(db, account.id, invalidated_at=access_changed_at)
    if account.status == AccountStatus.INACTIVE:
        await invalidate_account_email_change_requests(
            db,
            account.id,
            invalidated_at=datetime.now(UTC),
            reason="The account was deactivated before the email change was completed.",
        )
    await sync_pending_account_activation(
        db,
        account,
        email_changed=email_changed and account.activated_at is None,
        previous_status=previous_status,
    )
    await db.commit()
    await db.refresh(account)

    await record_account_log(
        db,
        category="IT Activity",
        severity="Success",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action="Update LGU Account",
        target=account.email,
        summary=f"{actor.display_name} updated LGU account {account.display_name}.",
        source_id=account.id,
        metadata={
            "emailChangeRequested": email_change_requested,
            "requestedEmail": requested_email if email_change_requested else None,
        },
    )
    return await to_account_summary_with_requests(db, account)


@router.get("/enterprises", response_model=list[AccountSummary])
async def list_enterprise_accounts(
    _: EnterpriseReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[AccountSummary]:
    accounts = await list_accounts_by_roles(db, [AccountRole.ENTERPRISE])
    return await to_account_summaries_with_requests(db, accounts)


@router.post("/enterprises", response_model=AccountSummary, status_code=status.HTTP_201_CREATED)
async def create_enterprise_account(
    payload: EnterpriseAccountCreate,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    existing = await get_account_by_email(db, str(payload.email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    if not is_inside_san_pedro(payload.latitude, payload.longitude):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enterprise location must be inside San Pedro, Laguna.",
        )

    enterprise_id = await generate_enterprise_id(db, payload.enterpriseId or payload.enterpriseName)
    account = await create_account_with_activation(
        db,
        email=str(payload.email),
        phone=payload.contactNumber,
        role=AccountRole.ENTERPRISE,
        display_name=payload.enterpriseName,
        title="Enterprise Account",
        enterprise_profile=EnterpriseProfile(
            enterprise_name=payload.enterpriseName,
            category=payload.category,
            manager_name=payload.managerName,
            barangay=payload.barangay,
            address=payload.address,
            latitude=payload.latitude,
            longitude=payload.longitude,
            location_updated_at=datetime.now(UTC),
            enterprise_id=enterprise_id,
            gateway_status="Not Linked",
            building_capacity=payload.buildingCapacity,
        ),
    )
    profile = account.enterprise_profile
    if profile is None:
        raise RuntimeError("Enterprise account was created without a profile.")
    await record_account_log(
        db,
        category="IT Activity",
        severity="Success",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action="Create Enterprise Account",
        target=profile.enterprise_name,
        summary=f"{actor.display_name} registered enterprise account {profile.enterprise_name}.",
        source_id=account.id,
        metadata={
            "enterpriseId": profile.enterprise_id,
            "barangay": profile.barangay,
            "buildingCapacity": profile.building_capacity,
        },
    )
    await record_account_log(
        db,
        category="System",
        severity="Info",
        actor="TANAW System",
        actor_role="System",
        action="Activation Email Queued",
        target=account.email,
        summary=f"The system queued an account activation email for enterprise {profile.enterprise_name}.",
        source_id=account.id,
    )
    return await to_account_summary_with_requests(db, account)


@router.patch("/enterprises/{account_id}", response_model=AccountSummary)
async def update_enterprise_account(
    account_id: str,
    payload: EnterpriseAccountUpdate,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    account = await get_account_by_id(db, account_id, for_update=True)
    if account is None or account.role != AccountRole.ENTERPRISE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Enterprise account not found."
        )
    profile = account.enterprise_profile
    if profile is None:
        raise RuntimeError("Enterprise account is missing its profile.")

    requested_email = str(payload.email)
    await ensure_unique_account_email(db, requested_email, account.id)
    previous_email = account.email
    previous_status = account.status
    next_status = AccountStatus(payload.status)
    ensure_account_can_deactivate(account, next_status)
    email_changed = previous_email != requested_email
    if account.activated_at is not None and email_changed and next_status != AccountStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Keep the account active while verifying a new email address.",
        )
    profile.enterprise_name = payload.enterpriseName
    account.display_name = payload.enterpriseName
    profile.category = payload.category
    profile.manager_name = payload.managerName
    account.phone = payload.contactNumber
    profile.barangay = payload.barangay
    profile.address = payload.address
    profile.building_capacity = payload.buildingCapacity
    account.status = next_status
    email_change_requested = False
    if email_changed:
        if account.activated_at is None:
            account.email = requested_email
        else:
            try:
                await request_account_email_change(
                    db,
                    account_id=account.id,
                    requested_email=requested_email,
                    requested_by=actor,
                )
            except AccountEmailChangeError as exc:
                raise email_change_http_exception(exc) from exc
            email_change_requested = True
    if previous_status != account.status:
        access_changed_at = datetime.now(UTC)
        account.token_invalid_before = access_changed_at
        await invalidate_password_reset_challenges(db, account.id, invalidated_at=access_changed_at)
    if account.status == AccountStatus.INACTIVE:
        await invalidate_account_email_change_requests(
            db,
            account.id,
            invalidated_at=datetime.now(UTC),
            reason="The account was deactivated before the email change was completed.",
        )
    await sync_pending_account_activation(
        db,
        account,
        email_changed=email_changed and account.activated_at is None,
        previous_status=previous_status,
    )
    await db.commit()
    await db.refresh(account)

    await record_account_log(
        db,
        category="IT Activity",
        severity="Success",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action="Update Enterprise Account",
        target=profile.enterprise_name,
        summary=f"{actor.display_name} updated enterprise account {profile.enterprise_name}.",
        source_id=account.id,
        metadata={
            "enterpriseId": profile.enterprise_id,
            "barangay": profile.barangay,
            "buildingCapacity": profile.building_capacity,
            "status": account.status.value,
            "emailChangeRequested": email_change_requested,
            "requestedEmail": requested_email if email_change_requested else None,
        },
    )
    return await to_account_summary_with_requests(db, account)


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
    await db.commit()
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
    await db.commit()
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
    await db.commit()
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
    return pending_request["email" if request_type == "businessEmail" else "phone"]


def get_profile_request_current_value(
    account: Account, request_type: ProfileChangeRequestType
) -> str:
    if request_type == "businessEmail":
        return account.email
    return account.phone or ""


def profile_request_label(request_type: ProfileChangeRequestType) -> str:
    return "Business Email" if request_type == "businessEmail" else "Contact Number"


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
    await record_account_log(
        db,
        category="IT Activity",
        severity="Success" if approved else "Info",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action=f"{action.title()} Verified Email Change",
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
    return await to_account_summary_with_requests(db, account)


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
        source_type=(
            "enterprise.profile.email"
            if request_type == "businessEmail"
            else "enterprise.profile.contact"
        ),
        source_id=account.id,
    )


async def record_account_log(
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


@dev_router.get("/deliveries", response_model=list[DeliverySummary])
async def get_dev_deliveries(
    _: ITAccount,
) -> list[DeliverySummary]:
    ensure_dev_log_available()
    deliveries = list_ephemeral_dev_deliveries()
    return [to_delivery_summary(delivery) for delivery in deliveries]


@dev_router.get("/deliveries/{delivery_id}", response_model=DeliverySummary)
async def get_dev_delivery(
    delivery_id: str,
    _: ITAccount,
) -> DeliverySummary:
    ensure_dev_log_available()
    delivery = find_dev_delivery(delivery_id)
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found.")
    return to_delivery_summary(delivery)


def ensure_dev_log_available() -> None:
    if get_settings().is_production:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
