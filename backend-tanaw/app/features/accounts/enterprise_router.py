import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.api_helpers import (
    email_change_http_exception,
    ensure_unique_account_email,
    sync_pending_account_activation,
)
from app.features.accounts.dependencies import require_roles
from app.features.accounts.location_search import LocationSearchError
from app.features.accounts.location_search_runtime import (
    LocationSearchNotConfiguredError,
    get_location_search_client,
)
from app.features.accounts.location_validation import (
    barangay_for_location,
    barangay_matches_location,
    is_inside_san_pedro,
)
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.schemas import (
    AccountSummary,
    EnterpriseAccountCreate,
    EnterpriseAccountUpdate,
    EnterpriseLocationSuggestion,
)
from app.features.accounts.service import (
    create_account_with_activation,
    generate_enterprise_id,
    get_account_by_email,
    get_account_by_id,
    list_accounts_by_roles,
    to_account_summaries_with_requests,
    to_account_summary_with_requests,
)
from app.features.activity_logs.service import record_activity_log as record_account_log
from app.features.auth.email_change import (
    AccountEmailChangeError,
    request_account_email_change,
)

logger = logging.getLogger(__name__)

ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
EnterpriseReadAccount = Annotated[Account, Depends(require_roles({"it", "admin"}))]

router = APIRouter(prefix="/accounts", tags=["enterprise accounts"])


@router.get(
    "/enterprises/location-suggestions",
    response_model=list[EnterpriseLocationSuggestion],
)
async def search_enterprise_locations(
    _: ITAccount,
    query: Annotated[str, Query(min_length=2, max_length=120)],
) -> list[EnterpriseLocationSuggestion]:
    try:
        client = get_location_search_client()
        return await client.autocomplete(query)
    except LocationSearchNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Location search is not configured. Place the marker manually instead.",
        ) from exc
    except LocationSearchError as exc:
        response_status = (
            status.HTTP_429_TOO_MANY_REQUESTS
            if exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS
            else status.HTTP_502_BAD_GATEWAY
        )
        raise HTTPException(
            status_code=response_status,
            detail="Location suggestions are temporarily unavailable. Place the marker manually instead.",
        ) from exc


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
    if not barangay_matches_location(payload.barangay, payload.latitude, payload.longitude):
        detected_barangay = barangay_for_location(payload.latitude, payload.longitude)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Map location is inside {detected_barangay}, not {payload.barangay}.",
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
    location_changed = False
    previous_location = (profile.latitude, profile.longitude)
    effective_latitude = payload.latitude if payload.latitude is not None else profile.latitude
    effective_longitude = payload.longitude if payload.longitude is not None else profile.longitude
    if payload.latitude is not None and payload.longitude is not None:
        if not is_inside_san_pedro(payload.latitude, payload.longitude):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Enterprise location must be inside San Pedro, Laguna.",
            )
        if not barangay_matches_location(payload.barangay, payload.latitude, payload.longitude):
            detected_barangay = barangay_for_location(payload.latitude, payload.longitude)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Map location is inside {detected_barangay}, not {payload.barangay}.",
            )
        location_changed = previous_location != (
            payload.latitude,
            payload.longitude,
        )
    elif effective_latitude is not None and effective_longitude is not None:
        if not barangay_matches_location(payload.barangay, effective_latitude, effective_longitude):
            detected_barangay = barangay_for_location(effective_latitude, effective_longitude)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Map location is inside {detected_barangay}, not {payload.barangay}.",
            )

    profile.enterprise_name = payload.enterpriseName
    account.display_name = payload.enterpriseName
    profile.category = payload.category
    profile.manager_name = payload.managerName
    account.phone = payload.contactNumber
    profile.barangay = payload.barangay
    profile.address = payload.address
    profile.building_capacity = payload.buildingCapacity
    if payload.latitude is not None and payload.longitude is not None:
        profile.latitude = payload.latitude
        profile.longitude = payload.longitude
        if location_changed:
            profile.location_updated_at = datetime.now(UTC)
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
        action="Update Enterprise Account",
        target=profile.enterprise_name,
        summary=f"{actor.display_name} updated enterprise account {profile.enterprise_name}.",
        source_id=account.id,
        metadata={
            "enterpriseId": profile.enterprise_id,
            "barangay": profile.barangay,
            "buildingCapacity": profile.building_capacity,
            "locationChanged": location_changed,
            "previousLatitude": previous_location[0],
            "previousLongitude": previous_location[1],
            "latitude": profile.latitude,
            "longitude": profile.longitude,
            "emailChangeRequested": email_change_requested,
            "requestedEmail": requested_email if email_change_requested else None,
        },
    )
    return await to_account_summary_with_requests(db, account)
