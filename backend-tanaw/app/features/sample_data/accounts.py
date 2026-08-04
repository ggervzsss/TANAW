import json
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.service import generate_enterprise_id
from app.features.sample_data.definitions import (
    ENTERPRISES,
    LGU_ACCOUNTS,
    TEST_ACCOUNT_PASSWORD,
)
from app.features.sample_data.helpers import (
    sample_uuid,
)


async def create_accounts(db: AsyncSession) -> dict[str, list[Account]]:
    password_hash = hash_password(validate_password_policy(TEST_ACCOUNT_PASSWORD))
    lgu_accounts: list[Account] = []
    for email, role, display_name, title, first_name, last_name in LGU_ACCOUNTS:
        ensure_email_available(
            await db.scalar(select(Account).where(Account.email == email)), email
        )
        account = Account(
            id=sample_uuid("account", email),
            email=email,
            first_name=first_name,
            last_name=last_name,
            password_hash=password_hash,
            role=role,
            display_name=display_name,
            title=title,
            status=AccountStatus.ACTIVE,
            activated_at=datetime.now(UTC),
        )
        db.add(account)
        lgu_accounts.append(account)

    enterprise_accounts: list[Account] = []
    for index, enterprise in enumerate(ENTERPRISES, start=1):
        ensure_email_available(
            await db.scalar(select(Account).where(Account.email == enterprise.email)),
            enterprise.email,
        )
        enterprise_id = await generate_enterprise_id(db, enterprise.name)
        account = Account(
            id=sample_uuid("account", enterprise.email),
            email=enterprise.email,
            phone=enterprise.phone,
            password_hash=password_hash,
            role=AccountRole.ENTERPRISE,
            display_name=enterprise.name,
            title="Enterprise Account",
            status=AccountStatus.ACTIVE,
            activated_at=datetime.now(UTC),
            enterprise_profile=EnterpriseProfile(
                enterprise_name=enterprise.name,
                category=enterprise.category,
                manager_name=enterprise.manager,
                barangay=enterprise.barangay,
                address=enterprise.address,
                latitude=enterprise.latitude,
                longitude=enterprise.longitude,
                location_updated_at=datetime.now(UTC),
                enterprise_id=enterprise_id,
                building_capacity=180 + index * 40,
                gateway_id=f"GW-SP-{index:04d}",
                gateway_status="Connected",
            ),
        )
        if index == 3:
            account.preferences_json = json.dumps(
                {
                    "pendingContactNumberChange": {
                        "phone": "+639171119999",
                        "requestedAt": datetime.now(UTC).isoformat(),
                    }
                },
                sort_keys=True,
            )
        db.add(account)
        enterprise_accounts.append(account)

    await db.flush()
    return {"lgu": lgu_accounts, "enterprises": enterprise_accounts}


def ensure_email_available(existing: Account | None, email: str) -> None:
    if existing is not None:
        raise SystemExit(
            f"Cannot create sample account {email}; an account with that email already exists."
        )


async def resolve_target_enterprise(
    db: AsyncSession, identifier: str | None, generated_enterprises: list[Account]
) -> Account:
    if not identifier:
        if not generated_enterprises:
            raise SystemExit("No generated enterprise is available as the default target.")
        return generated_enterprises[0]

    normalized = identifier.strip().lower()
    target = await db.scalar(
        select(Account)
        .join(Account.enterprise_profile)
        .where(
            Account.role == AccountRole.ENTERPRISE,
            Account.status == AccountStatus.ACTIVE,
            Account.activated_at.is_not(None),
            or_(
                func.lower(Account.id) == normalized,
                func.lower(Account.email) == normalized,
                func.lower(EnterpriseProfile.enterprise_id) == normalized,
                func.lower(EnterpriseProfile.enterprise_name) == normalized,
            ),
        )
    )
    if target is None:
        raise SystemExit(f"Target enterprise '{identifier}' was not found or is not active.")
    return target
