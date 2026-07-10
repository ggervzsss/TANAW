import json
import re
import secrets
import string
from datetime import UTC, datetime, timedelta
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password, verify_password
from app.features.accounts.defaults import get_startup_account_specs
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    DevDelivery,
)
from app.features.accounts.options import format_enterprise_category
from app.features.accounts.schemas import (
    AccountProfileChangeRequest,
    AccountSummary,
    AuthUser,
    DeliverySummary,
    ProfileChangeRequestType,
)
from app.features.mail.service import deliver_email, email_idempotency_key
from app.features.mail.templates import onboarding_email

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
    return AuthUser(
        id=account.id,
        email=account.email,
        displayName=account.display_name,
        role=account.role.value,
        title=account.title,
        mustChangePassword=account.must_change_password,
        phone=account.phone,
        firstName=account.first_name,
        lastName=account.last_name,
        enterpriseId=account.enterprise_id,
        enterpriseName=account.enterprise_name,
        category=format_enterprise_category(account.category),
        managerName=account.manager_name,
        barangay=account.barangay,
        address=account.address,
        buildingCapacity=account.building_capacity,
        displayImageDataUrl=display_image_data_url
        if isinstance(display_image_data_url, str)
        else None,
    )


def to_account_summary(account: Account) -> AccountSummary:
    return AccountSummary(
        id=account.id,
        email=account.email,
        phone=account.phone,
        firstName=account.first_name,
        lastName=account.last_name,
        enterpriseName=account.enterprise_name,
        category=format_enterprise_category(account.category),
        managerName=account.manager_name,
        barangay=account.barangay,
        address=account.address,
        latitude=account.latitude,
        longitude=account.longitude,
        locationSource=account.location_source,
        locationConfidence=account.location_confidence,
        geocodedAddress=account.geocoded_address,
        locationUpdatedAt=account.location_updated_at,
        enterpriseId=account.enterprise_id,
        gatewayStatus=account.gateway_status,
        buildingCapacity=account.building_capacity,
        displayName=account.display_name,
        role=account.role.value,
        title=account.title,
        status=account.status.value,
        mustChangePassword=account.must_change_password,
        isProtectedDefault=is_protected_startup_account(account),
        profileChangeRequests=get_profile_change_requests(account),
        createdAt=account.created_at,
        lastLoginAt=account.last_login_at,
    )


def get_profile_change_requests(account: Account) -> list[AccountProfileChangeRequest]:
    if account.role != AccountRole.ENTERPRISE:
        return []

    requests: list[AccountProfileChangeRequest] = []
    for request_type, (_, label, value_key) in PROFILE_CHANGE_REQUEST_CONFIG.items():
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
            )
        )
    return requests


def to_delivery_summary(delivery: DevDelivery) -> DeliverySummary:
    return DeliverySummary(
        id=delivery.id,
        accountId=delivery.account_id,
        recipient=delivery.recipient,
        subject=delivery.subject,
        body=delivery.body,
        status=delivery.status.value,
        createdAt=delivery.created_at,
    )


def is_temporary_password_expired(account: Account) -> bool:
    if not account.must_change_password or account.temporary_password_expires_at is None:
        return False

    expires_at = account.temporary_password_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= datetime.now(UTC)


def is_protected_startup_account(account: Account) -> bool:
    settings = get_settings()
    return any(
        account.role == spec.role and account.email.lower() == spec.email
        for spec in get_startup_account_specs(settings)
    )


async def get_account_by_email(db: AsyncSession, email: str) -> Account | None:
    result = await db.scalars(select(Account).where(Account.email == email.lower()))
    return result.first()


async def get_account_by_login_identifier(db: AsyncSession, identifier: str) -> Account | None:
    normalized = identifier.strip().lower()
    result = await db.scalars(
        select(Account).where((Account.email == normalized) | (Account.enterprise_id == normalized))
    )
    return result.first()


async def get_account_by_id(db: AsyncSession, account_id: str) -> Account | None:
    result = await db.scalars(select(Account).where(Account.id == account_id))
    return result.first()


async def record_login(db: AsyncSession, account: Account) -> None:
    account.last_login_at = datetime.now(UTC)
    await db.commit()


async def invalidate_account_tokens(db: AsyncSession, account: Account) -> None:
    account.token_invalid_before = datetime.now(UTC)
    await db.commit()


def generate_temporary_password(length: int = 14) -> str:
    required = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice("!@#$%^&*"),
    ]
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    required.extend(secrets.choice(alphabet) for _ in range(max(0, length - len(required))))
    secrets.SystemRandom().shuffle(required)
    return validate_password_policy("".join(required))


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
        select(Account.enterprise_id).where(
            Account.enterprise_id.like(f"{base}\\_%{suffix}", escape="\\")
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


async def create_account_with_temporary_password(
    db: AsyncSession,
    *,
    email: str,
    phone: str | None,
    role: AccountRole,
    display_name: str,
    title: str,
    first_name: str | None = None,
    last_name: str | None = None,
    enterprise_name: str | None = None,
    category: str | None = None,
    manager_name: str | None = None,
    barangay: str | None = None,
    address: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    location_source: str | None = None,
    location_confidence: float | None = None,
    geocoded_address: str | None = None,
    location_updated_at: datetime | None = None,
    enterprise_id: str | None = None,
    gateway_id: str | None = None,
    gateway_status: str | None = None,
    building_capacity: int = 100,
) -> Account:
    temporary_password = generate_temporary_password()
    now = datetime.now(UTC)
    account = Account(
        email=email.lower(),
        phone=phone,
        first_name=first_name,
        last_name=last_name,
        enterprise_name=enterprise_name,
        category=category,
        manager_name=manager_name,
        barangay=barangay,
        address=address,
        latitude=latitude,
        longitude=longitude,
        location_source=location_source,
        location_confidence=location_confidence,
        geocoded_address=geocoded_address,
        location_updated_at=location_updated_at,
        enterprise_id=enterprise_id,
        gateway_id=gateway_id,
        gateway_status=gateway_status,
        building_capacity=building_capacity,
        password_hash=hash_password(temporary_password),
        role=role,
        display_name=display_name,
        title=title,
        status=AccountStatus.ACTIVE,
        must_change_password=True,
        temporary_password_created_at=now,
        temporary_password_expires_at=now + timedelta(days=7),
    )
    db.add(account)
    await db.flush()
    await deliver_email(
        db,
        account_id=account.id,
        recipient=account.email,
        content=onboarding_email(account, temporary_password),
        idempotency_key=email_idempotency_key("account-onboarding", account.id),
        tags={"category": "account_onboarding"},
    )
    await db.commit()
    await db.refresh(account)
    return account


async def reset_account_password(db: AsyncSession, account: Account) -> Account:
    temporary_password = generate_temporary_password()
    now = datetime.now(UTC)
    account.password_hash = hash_password(temporary_password)
    account.must_change_password = True
    account.temporary_password_created_at = now
    account.temporary_password_expires_at = now + timedelta(days=7)
    account.token_invalid_before = now
    account.failed_login_attempts = 0
    account.locked_until = None
    await deliver_email(
        db,
        account_id=account.id,
        recipient=account.email,
        content=onboarding_email(account, temporary_password),
        idempotency_key=email_idempotency_key(
            "account-password-reset", f"{account.id}-{int(now.timestamp())}"
        ),
        tags={"category": "account_password_reset"},
    )
    await db.commit()
    await db.refresh(account)
    return account


async def change_account_password(
    db: AsyncSession, account: Account, current_password: str, new_password: str
) -> bool:
    if not verify_password(current_password, account.password_hash):
        return False
    if is_temporary_password_expired(account):
        return False

    validate_password_policy(new_password)
    account.password_hash = hash_password(new_password)
    account.must_change_password = False
    account.temporary_password_created_at = None
    account.temporary_password_expires_at = None
    account.password_changed_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(account)
    return True


async def list_dev_deliveries(db: AsyncSession) -> list[DevDelivery]:
    result = await db.scalars(select(DevDelivery).order_by(DevDelivery.created_at.desc()))
    return list(result)


async def get_dev_delivery_by_id(db: AsyncSession, delivery_id: str) -> DevDelivery | None:
    result = await db.scalars(select(DevDelivery).where(DevDelivery.id == delivery_id))
    return result.first()
