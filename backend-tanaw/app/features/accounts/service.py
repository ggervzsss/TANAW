import json
import re
import secrets
from datetime import UTC, datetime
from typing import Literal, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.password_policy import validate_password_policy
from app.core.security import hash_password, verify_password
from app.features.accounts.models import (
    Account,
    AccountEmailChangeRequest,
    AccountEmailChangeStatus,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.accounts.options import format_enterprise_category
from app.features.accounts.schemas import (
    AccountProfileChangeRequest,
    AccountSummary,
    AuthUser,
    DeliverySummary,
    ProfileChangeRequestType,
)
from app.features.auth.account_activation import issue_account_activation
from app.features.auth.challenge_service import invalidate_password_reset_challenges
from app.features.auth.email_change import (
    ACTIVE_EMAIL_CHANGE_STATUSES,
)
from app.features.mail.dev_log import DevDeliveryEvent

DISPLAY_IMAGE_DATA_URL_KEY = "displayImageDataUrl"
PENDING_BUSINESS_EMAIL_CHANGE_KEY = "pendingBusinessEmailChange"
PENDING_CONTACT_NUMBER_CHANGE_KEY = "pendingContactNumberChange"

PROFILE_CHANGE_REQUEST_CONFIG: dict[ProfileChangeRequestType, tuple[str, str, str]] = {
    "businessEmail": (
        PENDING_BUSINESS_EMAIL_CHANGE_KEY,
        "Business Email",
        "email",
    ),
    "contactNumber": (
        PENDING_CONTACT_NUMBER_CHANGE_KEY,
        "Contact Number",
        "phone",
    ),
}


def get_account_preferences(account: Account) -> dict[str, object]:
    try:
        values = json.loads(account.preferences_json or "{}")
    except json.JSONDecodeError:
        return {}
    return values if isinstance(values, dict) else {}


def set_account_preferences(account: Account, values: dict[str, object]) -> None:
    account.preferences_json = json.dumps(values) if values else None


def get_pending_profile_change_request(
    account: Account, request_type: ProfileChangeRequestType
) -> dict[str, str] | None:
    key, _, value_key = PROFILE_CHANGE_REQUEST_CONFIG[request_type]
    raw_request = get_account_preferences(account).get(key)
    if not isinstance(raw_request, dict):
        return None

    requested_value = raw_request.get(value_key)
    if not isinstance(requested_value, str) or not requested_value:
        return None

    requested_at = raw_request.get("requestedAt")
    return {
        value_key: requested_value,
        "requestedAt": requested_at if isinstance(requested_at, str) else "",
    }


def clear_pending_profile_change_request(
    account: Account, request_type: ProfileChangeRequestType
) -> None:
    key, _, _ = PROFILE_CHANGE_REQUEST_CONFIG[request_type]
    values = get_account_preferences(account)
    values.pop(key, None)
    set_account_preferences(account, values)


def set_display_image_data_url(account: Account, data_url: str | None) -> None:
    values = get_account_preferences(account)
    if data_url:
        values[DISPLAY_IMAGE_DATA_URL_KEY] = data_url
    else:
        values.pop(DISPLAY_IMAGE_DATA_URL_KEY, None)
    set_account_preferences(account, values)


def to_auth_user(account: Account) -> AuthUser:
    display_image_data_url = get_account_preferences(account).get(DISPLAY_IMAGE_DATA_URL_KEY)
    profile = account.enterprise_profile
    return AuthUser(
        id=account.id,
        email=account.email,
        displayName=account.display_name,
        role=account.role.value,
        title=account.title,
        phone=account.phone,
        firstName=account.first_name,
        lastName=account.last_name,
        enterpriseId=profile.enterprise_id if profile else None,
        enterpriseName=profile.enterprise_name if profile else None,
        category=format_enterprise_category(profile.category) if profile else None,
        managerName=profile.manager_name if profile else None,
        barangay=profile.barangay if profile else None,
        address=profile.address if profile else None,
        buildingCapacity=profile.building_capacity if profile else 100,
        displayImageDataUrl=display_image_data_url
        if isinstance(display_image_data_url, str)
        else None,
    )


def to_account_summary(
    account: Account,
    *,
    email_change_request: AccountEmailChangeRequest | None = None,
) -> AccountSummary:
    profile = account.enterprise_profile
    return AccountSummary(
        id=account.id,
        email=account.email,
        phone=account.phone,
        firstName=account.first_name,
        lastName=account.last_name,
        enterpriseName=profile.enterprise_name if profile else None,
        category=format_enterprise_category(profile.category) if profile else None,
        managerName=profile.manager_name if profile else None,
        barangay=profile.barangay if profile else None,
        address=profile.address if profile else None,
        latitude=profile.latitude if profile else None,
        longitude=profile.longitude if profile else None,
        locationUpdatedAt=profile.location_updated_at if profile else None,
        enterpriseId=profile.enterprise_id if profile else None,
        gatewayStatus=profile.gateway_status if profile else None,
        buildingCapacity=profile.building_capacity if profile else 100,
        displayName=account.display_name,
        role=account.role.value,
        title=account.title,
        status=account.status.value,
        isActivated=account.activated_at is not None,
        isProtectedDefault=is_protected_startup_account(account),
        profileChangeRequests=get_profile_change_requests(
            account,
            email_change_request=email_change_request,
        ),
        createdAt=account.created_at,
        lastLoginAt=account.last_login_at,
    )


def get_profile_change_requests(
    account: Account,
    *,
    email_change_request: AccountEmailChangeRequest | None = None,
) -> list[AccountProfileChangeRequest]:
    requests: list[AccountProfileChangeRequest] = []
    if email_change_request is not None:
        expires_at = email_change_request.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        is_expired = expires_at <= datetime.now(UTC)
        is_verified = (
            email_change_request.status == AccountEmailChangeStatus.VERIFIED.value
            and not is_expired
        )
        requests.append(
            AccountProfileChangeRequest(
                type="businessEmail",
                label="Business Email" if account.role == AccountRole.ENTERPRISE else "Email",
                requestedValue=email_change_request.requested_email,
                requestedAt=email_change_request.created_at.isoformat(),
                requestId=email_change_request.id,
                status=(
                    "expired"
                    if is_expired
                    else cast(
                        Literal["pending_verification", "verified"],
                        email_change_request.status,
                    )
                ),
                isVerified=is_verified,
                canApprove=is_verified,
                expiresAt=email_change_request.expires_at,
            )
        )
    if account.role != AccountRole.ENTERPRISE:
        return requests
    for request_type, (_, label, value_key) in PROFILE_CHANGE_REQUEST_CONFIG.items():
        if request_type == "businessEmail":
            continue
        pending_request = get_pending_profile_change_request(account, request_type)
        if pending_request is None:
            continue
        requested_value = pending_request.get(value_key)
        if not requested_value:
            continue
        requested_at = pending_request.get("requestedAt") or None
        requests.append(
            AccountProfileChangeRequest(
                type=cast(ProfileChangeRequestType, request_type),
                label=label,
                requestedValue=requested_value,
                requestedAt=requested_at,
                status="pending_review",
                isVerified=False,
                canApprove=True,
            )
        )
    return requests


async def to_account_summaries_with_requests(
    db: AsyncSession,
    accounts: list[Account],
) -> list[AccountSummary]:
    account_ids = [account.id for account in accounts]
    email_requests = (
        list(
            await db.scalars(
                select(AccountEmailChangeRequest).where(
                    AccountEmailChangeRequest.account_id.in_(account_ids),
                    AccountEmailChangeRequest.status.in_(ACTIVE_EMAIL_CHANGE_STATUSES),
                )
            )
        )
        if account_ids
        else []
    )
    requests_by_account = {request.account_id: request for request in email_requests}
    return [
        to_account_summary(
            account,
            email_change_request=requests_by_account.get(account.id),
        )
        for account in accounts
    ]


async def to_account_summary_with_requests(
    db: AsyncSession,
    account: Account,
) -> AccountSummary:
    return (await to_account_summaries_with_requests(db, [account]))[0]


def to_delivery_summary(delivery: DevDeliveryEvent) -> DeliverySummary:
    return DeliverySummary(
        id=delivery.id,
        accountId=delivery.account_id,
        recipient=delivery.recipient,
        subject=delivery.subject,
        body=delivery.body,
        status=delivery.status,
        createdAt=delivery.created_at,
    )


def is_protected_startup_account(account: Account) -> bool:
    return account.is_protected_system_account is True


async def get_account_by_email(db: AsyncSession, email: str) -> Account | None:
    result = await db.scalars(select(Account).where(Account.email == email.lower()))
    return result.first()


async def get_account_by_login_identifier(
    db: AsyncSession,
    identifier: str,
    *,
    for_update: bool = False,
) -> Account | None:
    normalized = identifier.strip().lower()
    statement = select(Account).where(
        (Account.email == normalized)
        | Account.enterprise_profile.has(EnterpriseProfile.enterprise_id == normalized)
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    return cast(Account | None, await db.scalar(statement))


async def get_account_by_id(
    db: AsyncSession,
    account_id: str,
    *,
    for_update: bool = False,
) -> Account | None:
    statement = select(Account).where(Account.id == account_id)
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    return cast(Account | None, await db.scalar(statement))


async def invalidate_account_tokens(db: AsyncSession, account: Account) -> None:
    account.token_invalid_before = datetime.now(UTC)
    await db.commit()


def account_role_from_value(value: str) -> AccountRole:
    return {
        "admin": AccountRole.ADMIN,
        "it": AccountRole.IT,
        "staff": AccountRole.STAFF,
        "enterprise": AccountRole.ENTERPRISE,
    }[value]


def normalize_enterprise_id_seed(value: str) -> str:
    normalized = value.strip().lower().replace("'", "").replace("’", "").replace("`", "")
    normalized = re.sub(r"[^a-z0-9]+", "_", normalized)
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized or "enterprise"


async def generate_enterprise_id(db: AsyncSession, seed: str) -> str:
    base = normalize_enterprise_id_seed(seed)
    suffix = "@tanaw.sanpedro"
    result = await db.scalars(
        select(EnterpriseProfile.enterprise_id).where(
            EnterpriseProfile.enterprise_id.like(f"{base}\\_%{suffix}", escape="\\")
        )
    )
    existing = {enterprise_id for enterprise_id in result if enterprise_id}
    next_sequence = 1
    while True:
        enterprise_id = f"{base}_{next_sequence:03d}{suffix}"
        if enterprise_id not in existing:
            return enterprise_id
        next_sequence += 1


async def list_accounts_by_roles(db: AsyncSession, roles: list[AccountRole]) -> list[Account]:
    result = await db.scalars(
        select(Account).where(Account.role.in_(roles)).order_by(Account.created_at.desc())
    )
    return list(result)


async def create_account_with_activation(
    db: AsyncSession,
    *,
    email: str,
    phone: str | None,
    role: AccountRole,
    display_name: str,
    title: str,
    first_name: str | None = None,
    last_name: str | None = None,
    enterprise_profile: EnterpriseProfile | None = None,
) -> Account:
    if role == AccountRole.ENTERPRISE and enterprise_profile is None:
        raise ValueError("Enterprise accounts require an enterprise profile.")
    if role != AccountRole.ENTERPRISE and enterprise_profile is not None:
        raise ValueError("Only enterprise accounts may have an enterprise profile.")

    account = Account(
        email=email.lower(),
        phone=phone,
        first_name=first_name,
        last_name=last_name,
        password_hash=hash_password(secrets.token_urlsafe(48)),
        role=role,
        display_name=display_name,
        title=title,
        status=AccountStatus.ACTIVE,
        activated_at=None,
        enterprise_profile=enterprise_profile,
    )
    db.add(account)
    await db.flush()
    await issue_account_activation(db, account, lock_account=False)
    await db.commit()
    await db.refresh(account)
    return account


async def change_account_password(
    db: AsyncSession, account: Account, current_password: str, new_password: str
) -> bool:
    if not verify_password(current_password, account.password_hash):
        return False

    validate_password_policy(new_password)
    now = datetime.now(UTC)
    account.password_hash = hash_password(new_password)
    account.password_changed_at = now
    account.token_invalid_before = now
    await invalidate_password_reset_challenges(db, account.id, invalidated_at=now)
    await db.commit()
    await db.refresh(account)
    return True
