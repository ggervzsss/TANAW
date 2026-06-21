from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.geocoding import (
    GeocodingNoResult,
    GeocodingUnavailable,
    geocode_enterprise_address,
    is_inside_san_pedro,
    reverse_geocode_enterprise_location,
)
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.schemas import (
    AccountStatusUpdate,
    AccountSummary,
    DeliverySummary,
    EnterpriseAccountCreate,
    EnterpriseAccountUpdate,
    EnterpriseGeocodeRequest,
    EnterpriseGeocodeResult,
    EnterpriseReverseGeocodeRequest,
    EnterpriseReverseGeocodeResult,
    LguAccountCreate,
    LguAccountUpdate,
)
from app.features.accounts.service import (
    account_role_from_value,
    create_account_with_temporary_password,
    generate_enterprise_id,
    get_account_by_email,
    get_account_by_id,
    get_dev_delivery_by_id,
    is_protected_default_it_account,
    list_accounts_by_roles,
    list_dev_deliveries,
    reset_account_password,
    to_account_summary,
    to_delivery_summary,
)
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.activity_logs.websocket import activity_log_manager

router = APIRouter(prefix="/accounts", tags=["accounts"])
dev_router = APIRouter(prefix="/dev", tags=["dev"])

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
    return [to_account_summary(account) for account in accounts]


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
    account = await create_account_with_temporary_password(
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
        action="Credentials Sent",
        target=account.email,
        summary=f"The system recorded onboarding credentials for {account.display_name}.",
        source_id=account.id,
    )
    return to_account_summary(account)


@router.patch("/lgu/{account_id}", response_model=AccountSummary)
async def update_lgu_account(
    account_id: str,
    payload: LguAccountUpdate,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    account = await get_account_by_id(db, account_id)
    if account is None or account.role == AccountRole.ENTERPRISE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LGU account not found.")
    if is_protected_default_it_account(account):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Default IT Personnel is a protected system account.",
        )

    next_role = account_role_from_value(payload.role)
    next_status = AccountStatus(payload.status)
    if account.id == actor.id and (
        next_role != AccountRole.IT or next_status != AccountStatus.ACTIVE
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own IT Personnel access.",
        )
    await ensure_role_update_keeps_it_access(db, account, next_role)
    await ensure_privileged_account_remains_available(db, account, next_status)
    await ensure_unique_account_email(db, str(payload.email), account.id)

    account.first_name = payload.firstName
    account.last_name = payload.lastName
    account.display_name = f"{payload.firstName} {payload.lastName}"
    account.email = str(payload.email)
    account.phone = payload.phone
    account.role = next_role
    account.title = {
        AccountRole.ADMIN: "Admin",
        AccountRole.IT: "IT Personnel",
        AccountRole.STAFF: "LGU Staff",
    }[next_role]
    account.status = next_status
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
    )
    return to_account_summary(account)


@router.get("/enterprises", response_model=list[AccountSummary])
async def list_enterprise_accounts(
    _: EnterpriseReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[AccountSummary]:
    accounts = await list_accounts_by_roles(db, [AccountRole.ENTERPRISE])
    return [to_account_summary(account) for account in accounts]


@router.post("/enterprises/geocode", response_model=EnterpriseGeocodeResult)
async def geocode_enterprise_location(
    payload: EnterpriseGeocodeRequest,
    _: ITAccount,
) -> EnterpriseGeocodeResult:
    try:
        candidate = await geocode_enterprise_address(
            payload.address, payload.barangay, payload.enterpriseName
        )
    except GeocodingNoResult as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except GeocodingUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    return EnterpriseGeocodeResult(
        latitude=candidate.latitude,
        longitude=candidate.longitude,
        displayAddress=candidate.display_address,
        confidence=candidate.confidence,
        provider=candidate.provider,
        source=candidate.source,
    )


@router.post("/enterprises/reverse-geocode", response_model=EnterpriseReverseGeocodeResult)
async def reverse_geocode_enterprise_location_endpoint(
    payload: EnterpriseReverseGeocodeRequest,
    _: ITAccount,
) -> EnterpriseReverseGeocodeResult:
    try:
        candidate = await reverse_geocode_enterprise_location(payload.latitude, payload.longitude)
    except GeocodingNoResult as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except GeocodingUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    return EnterpriseReverseGeocodeResult(
        latitude=candidate.latitude,
        longitude=candidate.longitude,
        displayAddress=candidate.display_address,
        confidence=candidate.confidence,
        provider=candidate.provider,
        source=candidate.source,
        address=candidate.address,
        barangay=candidate.barangay,
    )


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

    latitude = payload.latitude
    longitude = payload.longitude
    location_source = payload.locationSource
    location_confidence = payload.locationConfidence
    geocoded_address = payload.geocodedAddress
    location_updated_at = None

    if (latitude is None) != (longitude is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Latitude and longitude must be provided together.",
        )

    if latitude is not None and longitude is not None:
        if not is_inside_san_pedro(latitude, longitude):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Enterprise location must be inside San Pedro, Laguna.",
            )
        location_source = location_source or "manual"
        location_updated_at = datetime.now(UTC)
    else:
        try:
            candidate = await geocode_enterprise_address(
                payload.address, payload.barangay, payload.enterpriseName
            )
        except GeocodingNoResult, GeocodingUnavailable:
            candidate = None

        if candidate is not None:
            latitude = candidate.latitude
            longitude = candidate.longitude
            location_source = candidate.source
            location_confidence = candidate.confidence
            geocoded_address = candidate.display_address
            location_updated_at = datetime.now(UTC)

    enterprise_id = await generate_enterprise_id(db, payload.enterpriseId or payload.enterpriseName)
    account = await create_account_with_temporary_password(
        db,
        email=str(payload.email),
        phone=payload.contactNumber,
        role=AccountRole.ENTERPRISE,
        display_name=payload.enterpriseName,
        title="Enterprise Account",
        enterprise_name=payload.enterpriseName,
        category=payload.category,
        manager_name=payload.managerName,
        barangay=payload.barangay,
        address=payload.address,
        latitude=latitude,
        longitude=longitude,
        location_source=location_source,
        location_confidence=location_confidence,
        geocoded_address=geocoded_address,
        location_updated_at=location_updated_at,
        enterprise_id=enterprise_id,
        gateway_status="Not Linked",
    )
    await record_account_log(
        db,
        category="IT Activity",
        severity="Success",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action="Create Enterprise Account",
        target=account.enterprise_name or account.email,
        summary=f"{actor.display_name} registered enterprise account {account.enterprise_name}.",
        source_id=account.id,
        metadata={"enterpriseId": account.enterprise_id, "barangay": account.barangay},
    )
    await record_account_log(
        db,
        category="System",
        severity="Info",
        actor="TANAW System",
        actor_role="System",
        action="Credentials Sent",
        target=account.email,
        summary=f"The system recorded onboarding credentials for enterprise {account.enterprise_name}.",
        source_id=account.id,
    )
    return to_account_summary(account)


@router.patch("/enterprises/{account_id}", response_model=AccountSummary)
async def update_enterprise_account(
    account_id: str,
    payload: EnterpriseAccountUpdate,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    account = await get_account_by_id(db, account_id)
    if account is None or account.role != AccountRole.ENTERPRISE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Enterprise account not found."
        )

    await ensure_unique_account_email(db, str(payload.email), account.id)
    account.enterprise_name = payload.enterpriseName
    account.display_name = payload.enterpriseName
    account.category = payload.category
    account.manager_name = payload.managerName
    account.email = str(payload.email)
    account.phone = payload.contactNumber
    account.barangay = payload.barangay
    account.address = payload.address
    account.status = AccountStatus(payload.status)
    await db.commit()
    await db.refresh(account)

    await record_account_log(
        db,
        category="IT Activity",
        severity="Success",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action="Update Enterprise Account",
        target=account.enterprise_name or account.email,
        summary=f"{actor.display_name} updated enterprise account {account.enterprise_name}.",
        source_id=account.id,
        metadata={
            "enterpriseId": account.enterprise_id,
            "barangay": account.barangay,
            "status": account.status.value,
        },
    )
    return to_account_summary(account)


@router.post("/{account_id}/reset-password", response_model=AccountSummary)
async def reset_password(
    account_id: str,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    account = await get_account_by_id(db, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    if is_protected_default_it_account(account):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Default IT Personnel is a protected system account.",
        )
    await ensure_credential_reset_keeps_it_access(db, account, actor)
    updated_account = await reset_account_password(db, account)
    await record_account_log(
        db,
        category="IT Activity",
        severity="Warning",
        actor=actor.display_name,
        actor_role="IT Personnel",
        action="Reset Password",
        target=updated_account.display_name,
        summary=f"{actor.display_name} reset temporary credentials for {updated_account.display_name}.",
        source_id=updated_account.id,
    )
    await record_account_log(
        db,
        category="System",
        severity="Info",
        actor="TANAW System",
        actor_role="System",
        action="Credentials Sent",
        target=updated_account.email,
        summary=f"The system recorded reset credentials for {updated_account.display_name}.",
        source_id=updated_account.id,
    )
    return to_account_summary(updated_account)


@router.patch("/{account_id}/status", response_model=AccountSummary)
async def update_account_status(
    account_id: str,
    payload: AccountStatusUpdate,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountSummary:
    account = await get_account_by_id(db, account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

    next_status = AccountStatus(payload.status)
    if is_protected_default_it_account(account) and next_status != account.status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Default IT Personnel is a protected system account.",
        )
    await ensure_privileged_account_remains_available(db, account, next_status)

    account.status = next_status
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
    return to_account_summary(account)


async def ensure_privileged_account_remains_available(
    db: AsyncSession, account: Account, next_status: AccountStatus
) -> None:
    if next_status != AccountStatus.INACTIVE or account.status != AccountStatus.ACTIVE:
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
    ):
        return

    active_it_count = await db.scalar(
        select(func.count())
        .select_from(Account)
        .where(
            Account.role == AccountRole.IT,
            Account.status == AccountStatus.ACTIVE,
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


async def ensure_credential_reset_keeps_it_access(
    db: AsyncSession, account: Account, actor: Account
) -> None:
    if account.role != AccountRole.IT:
        return

    if account.id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot reset your own IT Personnel credentials while signed in. Ask another IT Personnel account to perform the reset or use the configured recovery process.",
        )

    if account.status != AccountStatus.ACTIVE:
        return

    active_it_count = await db.scalar(
        select(func.count())
        .select_from(Account)
        .where(
            Account.role == AccountRole.IT,
            Account.status == AccountStatus.ACTIVE,
        )
    )
    if (active_it_count or 0) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot reset credentials for the last active IT Personnel account.",
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


@dev_router.get("/deliveries", response_model=list[DeliverySummary])
async def get_dev_deliveries(
    _: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DeliverySummary]:
    deliveries = await list_dev_deliveries(db)
    return [to_delivery_summary(delivery) for delivery in deliveries]


@dev_router.get("/deliveries/{delivery_id}", response_model=DeliverySummary)
async def get_dev_delivery(
    delivery_id: str,
    _: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeliverySummary:
    delivery = await get_dev_delivery_by_id(db, delivery_id)
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found.")
    return to_delivery_summary(delivery)
