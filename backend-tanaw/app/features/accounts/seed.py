from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.features.accounts.defaults import (
    StartupAccountSpec,
    get_bootstrap_account_spec,
    get_development_account_specs,
)
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    SeedState,
)
from app.features.accounts.service import get_account_by_email

BOOTSTRAP_STATE_ID = "startup-bootstrap-v1"
DEVELOPMENT_STATE_ID = "startup-development-v1"
STARTUP_SEED_LOCK_ID = 8_412_026_071_100


async def seed_default_accounts(db: AsyncSession) -> None:
    """Initialize startup accounts once without synchronizing existing accounts."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:lock_id)"),
        {"lock_id": STARTUP_SEED_LOCK_ID},
    )
    settings = get_settings()
    await initialize_bootstrap_account(db, get_bootstrap_account_spec(settings))

    development_specs = get_development_account_specs(settings)
    if development_specs:
        await initialize_development_accounts(db, development_specs)
    await db.commit()


async def initialize_bootstrap_account(
    db: AsyncSession, configured_spec: StartupAccountSpec | None
) -> None:
    if await get_seed_state(db, BOOTSTRAP_STATE_ID) is not None:
        return

    account = await find_existing_it_account(db)
    if account is None:
        if configured_spec is None:
            raise RuntimeError(
                "No IT account exists. Configure BOOTSTRAP_IT_USERNAME and "
                "BOOTSTRAP_IT_PASSWORD for the one-time bootstrap."
            )
        account = await get_account_by_email(db, configured_spec.email)
        if account is None:
            account = create_startup_account(configured_spec, protected=True)
            db.add(account)
            await db.flush()

    account.is_protected_system_account = True

    db.add(build_seed_state(BOOTSTRAP_STATE_ID, [account]))


async def initialize_development_accounts(
    db: AsyncSession, specs: tuple[StartupAccountSpec, ...]
) -> None:
    if await get_seed_state(db, DEVELOPMENT_STATE_ID) is not None:
        return

    configured_emails = {spec.email for spec in specs}
    if len(configured_emails) != len(specs):
        raise RuntimeError("Development account usernames must be unique.")

    accounts: list[Account] = []
    for spec in specs:
        account = await get_account_by_email(db, spec.email)
        if account is None:
            account = create_startup_account(spec)
            db.add(account)
            await db.flush()
        accounts.append(account)

    db.add(build_seed_state(DEVELOPMENT_STATE_ID, accounts))


async def get_seed_state(db: AsyncSession, state_id: str) -> SeedState | None:
    result = await db.scalars(select(SeedState).where(SeedState.id == state_id))
    return result.first()


async def find_existing_it_account(db: AsyncSession) -> Account | None:
    result = await db.scalars(
        select(Account)
        .where(Account.role == AccountRole.IT)
        .order_by(Account.created_at.asc())
        .limit(1)
    )
    return result.first()


def create_startup_account(spec: StartupAccountSpec, *, protected: bool = False) -> Account:
    return Account(
        id=str(uuid4()),
        email=spec.email,
        password_hash=hash_password(spec.password),
        role=spec.role,
        display_name=spec.display_name,
        title=spec.title,
        first_name=spec.first_name,
        last_name=spec.last_name,
        status=AccountStatus.ACTIVE,
        is_protected_system_account=protected,
        activated_at=datetime.now(UTC),
    )


def build_seed_state(state_id: str, accounts: list[Account]) -> SeedState:
    return SeedState(
        id=state_id,
        initialized_at=datetime.now(UTC),
        account_count=len(accounts),
    )
