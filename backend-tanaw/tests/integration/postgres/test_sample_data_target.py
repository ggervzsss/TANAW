from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.sample_data.accounts import resolve_target_enterprise
from app.features.sample_data.dataset import SAMPLE_ACCOUNT_EMAILS
from app.features.sample_data.lifecycle import (
    generate_sample_data,
    remove_sample_data,
    sample_dataset_present,
)
from tests.support.postgres import postgres_test_database_url


def enterprise(seed: str, sequence: int = 1) -> Account:
    return Account(
        id=str(uuid4()),
        email=f"sample-target-{uuid4().hex}@example.com",
        password_hash="unused-test-password-hash",
        role=AccountRole.ENTERPRISE,
        display_name="Target selector test",
        title="Enterprise Account",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        enterprise_profile=EnterpriseProfile(
            enterprise_id=f"{seed}_{sequence:03d}@tanaw.sanpedro",
            enterprise_name=f"Target selector {uuid4().hex}",
            category="business",
            manager_name="Test Manager",
            barangay="Nueva",
        ),
    )


@pytest_asyncio.fixture
async def target_db() -> AsyncIterator[tuple[AsyncSession, Account, str]]:
    engine = create_async_engine(postgres_test_database_url())
    seed = f"target_test_{uuid4().hex[:12]}"
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            sessions = async_sessionmaker(
                connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
            )
            try:
                async with sessions() as db:
                    target = enterprise(seed)
                    db.add(target)
                    await db.flush()
                    yield db, target, seed
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("selector", ["seed", "numbered", "full", "email", "account", "name"])
async def test_resolves_existing_account_selectors(
    target_db: tuple[AsyncSession, Account, str], selector: str
) -> None:
    db, target, seed = target_db
    assert target.enterprise_profile is not None
    identifiers = {
        "seed": seed,
        "numbered": f"{seed}_001",
        "full": target.enterprise_profile.enterprise_id,
        "email": target.email,
        "account": target.id,
        "name": target.enterprise_profile.enterprise_name,
    }

    resolved = await resolve_target_enterprise(db, f"  {identifiers[selector].upper()}  ")

    assert resolved.id == target.id


@pytest.mark.asyncio
async def test_seed_normalization_matches_account_creation(
    target_db: tuple[AsyncSession, Account, str],
) -> None:
    db, target, seed = target_db

    resolved = await resolve_target_enterprise(db, seed.replace("_", " ' "))

    assert resolved.id == target.id


@pytest.mark.asyncio
async def test_seed_does_not_match_similar_prefix_or_nested_seed(
    target_db: tuple[AsyncSession, Account, str],
) -> None:
    db, target, seed = target_db
    db.add_all([enterprise(f"{seed}_other"), enterprise(seed.replace("_", "x"))])
    await db.flush()

    assert (await resolve_target_enterprise(db, seed)).id == target.id
    with pytest.raises(SystemExit, match="was not found"):
        await resolve_target_enterprise(db, seed[:-1])


@pytest.mark.asyncio
async def test_ambiguous_seed_lists_ids_and_numbered_id_selects_one(
    target_db: tuple[AsyncSession, Account, str],
) -> None:
    db, target, seed = target_db
    second = enterprise(seed, 2)
    db.add(second)
    await db.flush()
    assert target.enterprise_profile is not None
    target.enterprise_profile.enterprise_name = seed

    with pytest.raises(SystemExit, match="ambiguous") as error:
        await resolve_target_enterprise(db, seed)

    assert f"{seed}_001@tanaw.sanpedro" in str(error.value)
    assert f"{seed}_002@tanaw.sanpedro" in str(error.value)
    assert (await resolve_target_enterprise(db, f"{seed}_002")).id == second.id


@pytest.mark.asyncio
async def test_duplicate_names_are_ambiguous(target_db: tuple[AsyncSession, Account, str]) -> None:
    db, target, seed = target_db
    second = enterprise(f"{seed}_other")
    assert target.enterprise_profile is not None
    assert second.enterprise_profile is not None
    second.enterprise_profile.enterprise_name = target.enterprise_profile.enterprise_name
    db.add(second)
    await db.flush()

    with pytest.raises(SystemExit, match="ambiguous"):
        await resolve_target_enterprise(db, target.enterprise_profile.enterprise_name)


@pytest.mark.asyncio
@pytest.mark.parametrize("ineligible", ["inactive", "unactivated", "staff", "no_profile", "sample"])
async def test_ineligible_accounts_are_rejected(
    target_db: tuple[AsyncSession, Account, str], ineligible: str
) -> None:
    db, target, seed = target_db
    if ineligible == "inactive":
        target.status = AccountStatus.INACTIVE
    elif ineligible == "unactivated":
        target.activated_at = None
    elif ineligible == "staff":
        target.role = AccountRole.STAFF
    elif ineligible == "no_profile":
        target.enterprise_profile = None
    else:
        target.email = SAMPLE_ACCOUNT_EMAILS[-1]
    await db.flush()

    with pytest.raises(SystemExit, match="was not found"):
        await resolve_target_enterprise(db, seed)


@pytest.mark.asyncio
async def test_seed_can_select_a_non_first_sequence(
    target_db: tuple[AsyncSession, Account, str],
) -> None:
    db, target, seed = target_db
    assert target.enterprise_profile is not None
    target.enterprise_profile.enterprise_id = f"{seed}_017@tanaw.sanpedro"
    await db.flush()

    assert (await resolve_target_enterprise(db, seed)).id == target.id


@pytest.mark.asyncio
async def test_generation_and_cleanup_preserve_user_targets(
    target_db: tuple[AsyncSession, Account, str],
) -> None:
    db, target, seed = target_db
    if await sample_dataset_present(db):
        pytest.skip("A sample dataset already exists in this test database.")
    other_seed = f"{seed}_other"
    other = enterprise(other_seed)
    db.add(other)
    await db.flush()

    first = await generate_sample_data(db, "30d", "full-workflow", "selector-test", seed)

    assert first["target"]["accountId"] == target.id
    assert first["target"]["enterpriseId"] == f"{seed}_001@tanaw.sanpedro"
    assert first["counts"]["participatingEnterprises"] == 6
    assert len(first["counts"]["targetPreparedReportCounts"]) == 4
    assert await sample_dataset_present(db)

    await remove_sample_data(db)

    assert await db.get(Account, target.id) is not None
    assert await db.get(Account, other.id) is not None
    assert not await sample_dataset_present(db)
