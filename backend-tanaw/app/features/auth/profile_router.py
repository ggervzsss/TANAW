import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import (
    get_current_account,
)
from app.features.accounts.models import Account, AccountRole
from app.features.accounts.schemas import (
    AccountChangeRequestResponse,
    AuthUser,
    BuildingCapacityUpdate,
    BusinessEmailChangeRequest,
    ContactNumberChangeRequest,
    EnterpriseNameChangeRequest,
    LeadAdminNameUpdate,
    ProfileDisplayImageUpdate,
    ProfileUpdate,
)
from app.features.accounts.service import (
    PENDING_CONTACT_NUMBER_CHANGE_KEY,
    PENDING_ENTERPRISE_NAME_CHANGE_KEY,
    set_display_image_data_url,
    to_auth_user,
)
from app.features.activity_logs.service import (
    get_actor_role_label,
)
from app.features.activity_logs.service import (
    record_activity_log as record_auth_log,
)
from app.features.auth.email_change import (
    AccountEmailChangeError,
    cancel_account_email_change,
    get_active_account_email_change_request,
    request_account_email_change,
)
from app.features.auth.profile_helpers import (
    enterprise_label,
    require_enterprise_account,
    set_pending_account_change,
)
from app.features.auth.schemas import (
    AccountEmailChangeStatusResponse,
)
from app.features.notifications.service import (
    create_role_notifications,
    mark_source_notifications_read,
)
from app.features.requests.service import (
    cancel_account_change_request,
    open_account_change_request,
)

logger = logging.getLogger(__name__)

ENTERPRISE_CHANGE_NOTIFICATION_ROLES = (AccountRole.IT,)
router = APIRouter(prefix="/auth", tags=["account profile"])


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
        replace_existing_for_source=True,
    )


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

    profile = account.enterprise_profile
    if account.role == AccountRole.ENTERPRISE:
        if profile is None:
            raise RuntimeError("Enterprise account is missing its profile.")
        if payload.managerName is None or payload.enterpriseName is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Manager and enterprise names are required.",
            )
        # The enterprise name and contact number change only after IT approves a request.
        if payload.enterpriseName.strip() != profile.enterprise_name or (
            payload.phone is not None and payload.phone != account.phone
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Enterprise name and contact number changes need IT's approval.",
            )
        profile.manager_name = payload.managerName
        profile.address = payload.address
    else:
        account.phone = payload.phone
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
    await db.flush()
    await db.refresh(account)
    await record_auth_log(
        db,
        group="Accounts",
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Update Profile",
        target=account.email,
        summary=f"{account.display_name} updated their profile information.",
        source_id=account.id,
    )
    return to_auth_user(account)


@router.patch("/profile/display-image", response_model=AuthUser)
async def update_profile_display_image(
    payload: ProfileDisplayImageUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    set_display_image_data_url(account, payload.displayImageDataUrl)
    await db.flush()
    await db.refresh(account)
    await record_auth_log(
        db,
        group="Accounts",
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
    profile = require_enterprise_account(account)
    profile.manager_name = payload.managerName
    await db.flush()
    await db.refresh(account)
    await record_auth_log(
        db,
        group="Accounts",
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Update Lead Admin",
        target=account.email,
        summary=f"{account.display_name} updated the lead admin name.",
        source_id=account.id,
    )
    return to_auth_user(account)


@router.patch("/profile/building-capacity", response_model=AuthUser)
async def update_building_capacity(
    payload: BuildingCapacityUpdate,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    profile = require_enterprise_account(account)
    previous_capacity = profile.building_capacity
    profile.building_capacity = payload.buildingCapacity
    await db.flush()
    await db.refresh(account)
    await record_auth_log(
        db,
        group="Accounts",
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Update Building Capacity",
        target=account.email,
        summary=f"{account.display_name} updated building capacity to {profile.building_capacity}.",
        source_id=account.id,
        metadata={
            "previousBuildingCapacity": previous_capacity,
            "buildingCapacity": profile.building_capacity,
        },
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
    change = await open_account_change_request(
        db,
        account,
        "businessEmail",
        email_request.requested_email,
        email_change_request_id=email_request.id,
    )
    await record_auth_log(
        db,
        group="Requests",
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Request Account Change",
        target=change.request_code,
        summary=f"{account.display_name} asked to change its business email.",
        it_detail=f"New address: {email_request.requested_email}. It must be verified first.",
        source_id=account.id,
        metadata={
            "requestId": email_request.id,
            "requestedEmail": email_request.requested_email,
            "status": email_request.status,
        },
    )
    enterprise = enterprise_label(account)
    notification_account_id = account.id
    notification_request_id = email_request.id
    try:
        async with db.begin_nested():
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
    await cancel_account_change_request(db, account.id, "businessEmail")
    await record_auth_log(
        db,
        group="Requests",
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Cancel Account Change",
        target=account.email,
        summary=f"{account.display_name} cancelled its business email change.",
        source_id=account.id,
        metadata={"requestId": request.id, "requestedEmail": request.requested_email},
    )
    await mark_source_notifications_read(
        db,
        source_type="enterprise.profile.email",
        source_id=account.id,
        recipient_role=AccountRole.IT,
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

    set_pending_account_change(
        account,
        PENDING_CONTACT_NUMBER_CHANGE_KEY,
        {"phone": payload.phone, "requestedAt": datetime.now(UTC).isoformat()},
    )
    await db.flush()
    change = await open_account_change_request(db, account, "contactNumber", payload.phone)
    await record_auth_log(
        db,
        group="Requests",
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Request Account Change",
        target=change.request_code,
        summary=f"{account.display_name} asked to change its contact number.",
        source_id=change.id,
        it_detail=f"New contact number: {payload.phone}.",
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
        message="Contact number change request sent to IT for review.",
    )


@router.post("/profile/enterprise-name-change", response_model=AccountChangeRequestResponse)
async def request_enterprise_name_change(
    payload: EnterpriseNameChangeRequest,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountChangeRequestResponse:
    profile = require_enterprise_account(account)
    name = " ".join(payload.enterpriseName.split())
    if name == profile.enterprise_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This is already the enterprise name.",
        )
    set_pending_account_change(
        account,
        PENDING_ENTERPRISE_NAME_CHANGE_KEY,
        {"name": name, "requestedAt": datetime.now(UTC).isoformat()},
    )
    await db.flush()
    change = await open_account_change_request(db, account, "enterpriseName", name)
    await record_auth_log(
        db,
        group="Requests",
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Request Account Change",
        target=change.request_code,
        summary=f"{account.display_name} asked to change its enterprise name.",
        source_id=change.id,
        it_detail=f"New enterprise name: {name}.",
    )
    enterprise = enterprise_label(account)
    await notify_enterprise_account_change(
        db,
        account,
        title=f"{enterprise} asked to change its enterprise name.",
        message=f"{enterprise} asked to change its name to {name}. IT approval is required.",
        notification_type="Enterprise Profile Change Request",
        source_type="enterprise.profile.name",
    )
    return AccountChangeRequestResponse(
        status="pending",
        message="Enterprise name change sent to IT for approval.",
    )
