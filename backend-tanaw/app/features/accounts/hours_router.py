"""Opening hours and temporary closures, kept by IT and by the enterprise itself.

Both change right away, without IT's approval, and each change is recorded in Activity.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import get_current_account, require_roles
from app.features.accounts.models import Account, AccountRole, EnterpriseClosure
from app.features.accounts.opening_hours import (
    ClosureCreate,
    ClosureSummary,
    OpeningHours,
    dump_opening_hours,
)
from app.features.accounts.schemas import AuthUser
from app.features.accounts.service import get_account_by_id, to_auth_user
from app.features.activity_logs.service import get_actor_role_label, record_activity_log

router = APIRouter(tags=["opening hours"])

ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
ReaderAccount = Annotated[Account, Depends(require_roles({"it", "admin"}))]
Db = Annotated[AsyncSession, Depends(get_db)]


def to_closure_summary(closure: EnterpriseClosure) -> ClosureSummary:
    return ClosureSummary(
        id=closure.id,
        startDate=closure.start_date,
        endDate=closure.end_date,
        reason=closure.reason,
        createdBy=closure.created_by_name,
    )


def _enterprise_name(account: Account) -> str:
    profile = account.enterprise_profile
    return profile.enterprise_name if profile is not None else account.display_name


async def _enterprise(db: AsyncSession, account_id: str) -> Account:
    account = await get_account_by_id(db, account_id)
    if (
        account is None
        or account.role != AccountRole.ENTERPRISE
        or account.enterprise_profile is None
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Enterprise not found.")
    return account


def _own_enterprise(account: Account) -> Account:
    if account.role != AccountRole.ENTERPRISE or account.enterprise_profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only enterprises keep opening hours."
        )
    return account


async def _list(db: AsyncSession, enterprise: Account) -> list[ClosureSummary]:
    rows = await db.scalars(
        select(EnterpriseClosure)
        .where(EnterpriseClosure.enterprise_profile_id == enterprise.id)
        .order_by(EnterpriseClosure.start_date.asc())
    )
    return [to_closure_summary(row) for row in rows]


async def _add(
    db: AsyncSession, enterprise: Account, actor: Account, payload: ClosureCreate
) -> ClosureSummary:
    closure = EnterpriseClosure(
        enterprise_profile_id=enterprise.id,
        start_date=payload.startDate,
        end_date=payload.endDate,
        reason=payload.reason,
        created_by_name=actor.display_name,
    )
    db.add(closure)
    await db.flush()
    await db.refresh(closure)
    place = _enterprise_name(enterprise)
    when = (
        payload.startDate.strftime("%b %d").replace(" 0", " ")
        if payload.startDate == payload.endDate
        else f"{payload.startDate.strftime('%b %d').replace(' 0', ' ')} to "
        f"{payload.endDate.strftime('%b %d').replace(' 0', ' ')}"
    )
    await record_activity_log(
        db,
        group="Enterprises",
        severity="Info",
        actor=actor.display_name,
        actor_role=get_actor_role_label(actor),
        action="Mark Temporarily Closed",
        target=place,
        summary=f"{place} is marked temporarily closed, {when}"
        + (f": {payload.reason}." if payload.reason else "."),
        source_id=closure.id,
    )
    return to_closure_summary(closure)


async def _remove(db: AsyncSession, enterprise: Account, actor: Account, closure_id: str) -> None:
    result = await db.execute(
        delete(EnterpriseClosure)
        .where(
            EnterpriseClosure.id == closure_id,
            EnterpriseClosure.enterprise_profile_id == enterprise.id,
        )
        .returning(EnterpriseClosure.id)
    )
    if result.first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Closure not found.")
    place = _enterprise_name(enterprise)
    await record_activity_log(
        db,
        group="Enterprises",
        severity="Info",
        actor=actor.display_name,
        actor_role=get_actor_role_label(actor),
        action="Clear Temporary Closure",
        target=place,
        summary=f"{place}'s temporary closure was removed.",
        source_id=closure_id,
    )


@router.get("/accounts/enterprises/{account_id}/closures", response_model=list[ClosureSummary])
async def list_enterprise_closures(
    account_id: str, _: ReaderAccount, db: Db
) -> list[ClosureSummary]:
    return await _list(db, await _enterprise(db, account_id))


@router.post(
    "/accounts/enterprises/{account_id}/closures",
    response_model=ClosureSummary,
    status_code=status.HTTP_201_CREATED,
)
async def add_enterprise_closure(
    account_id: str, payload: ClosureCreate, actor: ITAccount, db: Db
) -> ClosureSummary:
    return await _add(db, await _enterprise(db, account_id), actor, payload)


@router.delete(
    "/accounts/enterprises/{account_id}/closures/{closure_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_enterprise_closure(
    account_id: str, closure_id: str, actor: ITAccount, db: Db
) -> None:
    await _remove(db, await _enterprise(db, account_id), actor, closure_id)


@router.patch("/auth/profile/opening-hours", response_model=AuthUser)
async def update_own_opening_hours(
    payload: OpeningHours,
    account: Annotated[Account, Depends(get_current_account)],
    db: Db,
) -> AuthUser:
    enterprise = _own_enterprise(account)
    profile = enterprise.enterprise_profile
    assert profile is not None
    profile.opening_hours_json = dump_opening_hours(payload)
    await db.flush()
    await db.refresh(enterprise)
    await record_activity_log(
        db,
        group="Enterprises",
        severity="Info",
        actor=enterprise.display_name,
        actor_role=get_actor_role_label(enterprise),
        action="Change Opening Hours",
        target=profile.enterprise_name,
        summary=f"{profile.enterprise_name} changed its opening hours.",
        source_id=enterprise.id,
    )
    return to_auth_user(enterprise)


@router.get("/auth/profile/closures", response_model=list[ClosureSummary])
async def list_own_closures(
    account: Annotated[Account, Depends(get_current_account)], db: Db
) -> list[ClosureSummary]:
    return await _list(db, _own_enterprise(account))


@router.post(
    "/auth/profile/closures", response_model=ClosureSummary, status_code=status.HTTP_201_CREATED
)
async def add_own_closure(
    payload: ClosureCreate, account: Annotated[Account, Depends(get_current_account)], db: Db
) -> ClosureSummary:
    enterprise = _own_enterprise(account)
    return await _add(db, enterprise, enterprise, payload)


@router.delete("/auth/profile/closures/{closure_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_own_closure(
    closure_id: str, account: Annotated[Account, Depends(get_current_account)], db: Db
) -> None:
    enterprise = _own_enterprise(account)
    await _remove(db, enterprise, enterprise, closure_id)
