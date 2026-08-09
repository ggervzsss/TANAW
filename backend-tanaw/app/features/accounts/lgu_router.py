import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.api_helpers import (
    email_change_http_exception,
    ensure_role_update_keeps_it_access,
    ensure_unique_account_email,
    sync_pending_account_activation,
)
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.schemas import (
    AccountSummary,
    LguAccountCreate,
    LguAccountUpdate,
)
from app.features.accounts.service import (
    account_role_from_value,
    create_account_with_activation,
    get_account_by_email,
    get_account_by_id,
    is_protected_startup_account,
    list_accounts_by_roles,
    to_account_summaries_with_requests,
    to_account_summary_with_requests,
)
from app.features.activity_logs.service import record_activity_log as record_account_log
from app.features.auth.challenge_service import invalidate_password_reset_challenges
from app.features.auth.email_change import (
    AccountEmailChangeError,
    request_account_email_change,
)

logger = logging.getLogger(__name__)

ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
EnterpriseReadAccount = Annotated[Account, Depends(require_roles({"it", "admin"}))]

router = APIRouter(prefix="/accounts", tags=["LGU accounts"])


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
    if account.id == actor.id and next_role != AccountRole.IT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own IT Personnel access.",
        )
    await ensure_role_update_keeps_it_access(db, account, next_role)
    requested_email = str(payload.email)
    await ensure_unique_account_email(db, requested_email, account.id)

    previous_email = account.email
    previous_role = account.role
    email_changed = previous_email != requested_email
    if (
        account.activated_at is not None
        and email_changed
        and account.status != AccountStatus.ACTIVE
    ):
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
    if previous_role != account.role:
        access_changed_at = datetime.now(UTC)
        account.token_invalid_before = access_changed_at
        await invalidate_password_reset_challenges(db, account.id, invalidated_at=access_changed_at)
    await sync_pending_account_activation(
        db,
        account,
        email_changed=email_changed and account.activated_at is None,
        previous_status=account.status,
    )
    await db.flush()
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
