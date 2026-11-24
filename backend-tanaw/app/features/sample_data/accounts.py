import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import PHILIPPINE_TIME_ZONE
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseClosure,
    EnterpriseProfile,
)
from app.features.accounts.opening_hours import WEEKDAYS, DayHours, OpeningHours, OpeningPeriod
from app.features.accounts.service import generate_enterprise_id, normalize_enterprise_id_seed
from app.features.sample_data.dataset import SAMPLE_ACCOUNT_EMAILS
from app.features.sample_data.definitions import ENTERPRISES, LGU_ACCOUNTS
from app.features.sample_data.helpers import (
    sample_uuid,
)


async def create_accounts(
    db: AsyncSession, password: str, registered_before: datetime | None = None
) -> dict[str, list[Account]]:
    """Create the LGU and enterprise sample accounts.

    Accounts are dated before `registered_before` (the start of the sample range), staggered by
    enterprise, so screens that show registration dates or skip months before registration have
    the whole sample history to work with.
    """
    password_hash = hash_password(validate_password_policy(password))
    registered_before = registered_before or datetime.now(UTC)
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
            activated_at=registered_before - timedelta(days=90),
            created_at=registered_before - timedelta(days=92),
        )
        db.add(account)
        lgu_accounts.append(account)

    enterprise_accounts: list[Account] = []
    closures: list[EnterpriseClosure] = []
    for index, enterprise in enumerate(ENTERPRISES, start=1):
        ensure_email_available(
            await db.scalar(select(Account).where(Account.email == enterprise.email)),
            enterprise.email,
        )
        enterprise_id = await generate_enterprise_id(db, enterprise.name)
        registered_at = registered_before - timedelta(days=20 + index * 17)
        account = Account(
            id=sample_uuid("account", enterprise.email),
            email=enterprise.email,
            phone=enterprise.phone,
            password_hash=password_hash,
            role=AccountRole.ENTERPRISE,
            display_name=enterprise.name,
            title="Enterprise Account",
            status=AccountStatus.ACTIVE,
            activated_at=registered_at + timedelta(days=1),
            created_at=registered_at,
            enterprise_profile=EnterpriseProfile(
                enterprise_name=enterprise.name,
                attraction_code=enterprise.attraction_code,
                attraction_description=enterprise.attraction_description,
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
                opening_hours_json=sample_opening_hours(index).model_dump_json(),
                # One place's desktop app has been silent for two hours, so it shows as offline.
                last_check_in_at=datetime.now(UTC)
                - (timedelta(hours=2) if index == SAMPLE_OFFLINE_INDEX else timedelta(seconds=20)),
            ),
        )
        if index == SAMPLE_CLOSED_INDEX:
            today = datetime.now(UTC).astimezone(PHILIPPINE_TIME_ZONE).date()
            closures.append(
                EnterpriseClosure(
                    id=sample_uuid("closure", enterprise.email),
                    enterprise_profile_id=account.id,
                    start_date=today,
                    end_date=today + timedelta(days=3),
                    reason="Closed for renovation",
                    created_by_name=enterprise.manager,
                )
            )
        db.add(account)
        enterprise_accounts.append(account)

    await db.flush()
    db.add_all(closures)
    await db.flush()
    return {"lgu": lgu_accounts, "enterprises": enterprise_accounts}


SAMPLE_OFFLINE_INDEX = 6
SAMPLE_CLOSED_INDEX = 5


def sample_opening_hours(index: int) -> OpeningHours:
    """Varied hours: regular days, a midday break with Sundays closed, and open 24 hours."""
    style = index % 4
    if style == 2:
        return OpeningHours(days=[DayHours(day=day, mode="open24h") for day in WEEKDAYS])
    if style == 1:
        return OpeningHours(
            days=[
                DayHours(day=day, mode="closed")
                if day == "sunday"
                else DayHours(
                    day=day,
                    mode="hours",
                    periods=[
                        OpeningPeriod(open="09:00", close="12:00"),
                        OpeningPeriod(open="13:00", close="18:00"),
                    ],
                )
                for day in WEEKDAYS
            ]
        )
    opens, closes = ("07:00", "20:00") if style == 3 else ("08:00", "17:00")
    return OpeningHours(
        days=[
            DayHours(day=day, mode="hours", periods=[OpeningPeriod(open=opens, close=closes)])
            for day in WEEKDAYS
        ]
    )


def ensure_email_available(existing: Account | None, email: str) -> None:
    if existing is not None:
        raise SystemExit(
            f"Cannot create sample account {email}; an account with that email already exists."
        )


async def resolve_target_enterprise(db: AsyncSession, identifier: str | None) -> Account:
    if not identifier or not identifier.strip():
        raise SystemExit("Choose a target enterprise using its account seed or enterprise ID.")

    normalized = identifier.strip().lower()
    query = (
        select(Account)
        .join(Account.enterprise_profile)
        .where(
            Account.role == AccountRole.ENTERPRISE,
            Account.status == AccountStatus.ACTIVE,
            Account.activated_at.is_not(None),
            Account.email.not_in(SAMPLE_ACCOUNT_EMAILS),
        )
        .order_by(EnterpriseProfile.enterprise_id)
    )
    # Explicit identifiers take precedence over seed and name matches.
    targets = list(
        await db.scalars(
            query.where(
                or_(
                    func.lower(Account.id) == normalized,
                    func.lower(Account.email) == normalized,
                    func.lower(EnterpriseProfile.enterprise_id) == normalized,
                    func.lower(EnterpriseProfile.enterprise_id) == f"{normalized}@tanaw.sanpedro",
                )
            )
        )
    )
    if not targets:
        conditions = [func.lower(EnterpriseProfile.enterprise_name) == normalized]
        if "@" not in normalized:
            seed = normalize_enterprise_id_seed(normalized)
            conditions.append(
                func.lower(EnterpriseProfile.enterprise_id).regexp_match(
                    rf"^{re.escape(seed)}_[0-9]{{3,}}@tanaw\.sanpedro$"
                )
            )
        targets = list(await db.scalars(query.where(or_(*conditions))))

    if not targets:
        raise SystemExit(
            f"Target enterprise '{identifier}' was not found. "
            "Choose an existing active, activated enterprise account."
        )
    if len(targets) > 1:
        enterprise_ids = ", ".join(
            target.enterprise_profile.enterprise_id
            for target in targets
            if target.enterprise_profile is not None
        )
        raise SystemExit(
            f"Target enterprise '{identifier}' is ambiguous. "
            f"Use a numbered or full enterprise ID: {enterprise_ids}"
        )
    return targets[0]
