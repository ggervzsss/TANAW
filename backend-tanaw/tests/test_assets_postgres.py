import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.assets.models import AccountAsset, AccountProfileChangeRequest
from app.features.assets.service import (
    get_account_theme,
    read_profile_asset,
    replace_profile_asset,
    request_contact_change,
    resolve_contact_change,
    set_account_theme,
)
from app.features.assets.storage import LocalAssetStorage, validate_image
from app.features.operational import service as operational_service
from app.features.operational.schemas import (
    SupportTicketCreate,
    SupportTicketMessageCreate,
    SupportTicketStatusUpdate,
)
from app.features.operational.service import (
    create_support_ticket,
    create_support_ticket_message,
    get_support_attachment_for_account,
    get_support_ticket_detail,
    update_support_ticket_status,
)
from app.features.support.models import SupportTicket
from app.features.topology.account_scope import AccountTopology
from app.features.topology.models import Enterprise, EnterpriseMembership, EnterpriseSite

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
PNG_BYTES = b"\x89PNG\r\n\x1a\npostgres-normalized-asset"


def _postgres_async_url(raw_url: str) -> str:
    normalized = raw_url.strip()
    if normalized.startswith("postgres://"):
        normalized = f"postgresql://{normalized.removeprefix('postgres://')}"
    if normalized.startswith("postgresql://"):
        normalized = normalized.replace("postgresql://", "postgresql+asyncpg://", 1)
    if not normalized.startswith("postgresql+asyncpg://"):
        raise pytest.UsageError(f"{TEST_DATABASE_ENV} must point to PostgreSQL via asyncpg.")
    return normalized


@pytest_asyncio.fixture
async def asset_session() -> AsyncIterator[AsyncSession]:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")
    engine = create_async_engine(_postgres_async_url(raw_url), pool_pre_ping=True)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        session = AsyncSession(bind=connection, expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()
    await engine.dispose()


@pytest.mark.asyncio
async def test_normalized_preferences_profile_contact_and_ticket_assets(
    asset_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = asset_session
    now = datetime.now(UTC)
    enterprise_account = _account(role=AccountRole.ENTERPRISE, activated_at=now)
    it_account = _account(role=AccountRole.IT, activated_at=now)
    db.add_all([enterprise_account, it_account])
    await db.flush()
    topology = _topology(enterprise_account, now=now)
    db.add_all([topology.enterprise, topology.membership, topology.site])
    await db.commit()

    assert await get_account_theme(db, account_id=enterprise_account.id) == "system"
    await set_account_theme(db, account_id=enterprise_account.id, theme="dark")
    assert await get_account_theme(db, account_id=enterprise_account.id) == "dark"

    storage = LocalAssetStorage(tmp_path)
    first_image = validate_image(
        file_name="first.png",
        declared_mime_type="image/png",
        content=PNG_BYTES,
        max_bytes=1024,
    )
    first_asset = await replace_profile_asset(
        db,
        storage=storage,
        account=enterprise_account,
        image=first_image,
    )
    assert await read_profile_asset(
        db,
        storage=storage,
        account_id=enterprise_account.id,
        asset_id=first_asset.id,
    ) == (first_asset, PNG_BYTES)
    assert (
        await read_profile_asset(
            db,
            storage=storage,
            account_id=it_account.id,
            asset_id=first_asset.id,
        )
        is None
    )

    second_image = validate_image(
        file_name="second.png",
        declared_mime_type="image/png",
        content=PNG_BYTES + b"-replacement",
        max_bytes=1024,
    )
    second_asset = await replace_profile_asset(
        db,
        storage=storage,
        account=enterprise_account,
        image=second_image,
    )
    await db.refresh(first_asset)
    assert first_asset.status == "deleted" and first_asset.deleted_at is not None
    assert not (tmp_path / first_asset.storage_key).exists()
    active_assets = list(
        await db.scalars(
            select(AccountAsset).where(
                AccountAsset.account_id == enterprise_account.id,
                AccountAsset.status == "active",
            )
        )
    )
    assert [asset.id for asset in active_assets] == [second_asset.id]

    first_request = await request_contact_change(
        db,
        account_id=enterprise_account.id,
        requested_value="+639171111111",
        requested_at=now,
    )
    second_request = await request_contact_change(
        db,
        account_id=enterprise_account.id,
        requested_value="+639172222222",
        requested_at=now + timedelta(seconds=1),
    )
    await db.refresh(first_request)
    assert first_request.status == "cancelled"
    resolved_request = await resolve_contact_change(
        db,
        account=enterprise_account,
        actor_account_id=it_account.id,
        approve=True,
    )
    assert resolved_request is not None and resolved_request.id == second_request.id
    assert enterprise_account.phone == "+639172222222"
    requests = list(
        await db.scalars(
            select(AccountProfileChangeRequest).where(
                AccountProfileChangeRequest.account_id == enterprise_account.id
            )
        )
    )
    assert {request.status for request in requests} == {"cancelled", "approved"}

    async def require_seeded_topology(_db: AsyncSession, account: Account) -> AccountTopology:
        assert account.id == enterprise_account.id
        return topology

    monkeypatch.setattr(operational_service, "require_account_topology", require_seeded_topology)
    ticket = await create_support_ticket(
        db,
        enterprise_account,
        SupportTicketCreate(
            category="Camera Issue",
            priority="High",
            subject="Camera feed unavailable",
            description="The camera feed has been unavailable for several minutes.",
        ),
        storage=storage,
        images=[first_image, second_image],
    )
    assert [attachment.fileName for attachment in ticket.attachments] == [
        "first.png",
        "second.png",
    ]
    assert all("data:" not in attachment.url for attachment in ticket.attachments)

    attachment = await get_support_attachment_for_account(
        db,
        it_account,
        ticket_id=ticket.id,
        attachment_id=ticket.attachments[0].id,
    )
    assert attachment is not None
    assert (
        await storage.read(key=attachment.storage_key, max_bytes=attachment.size_bytes) == PNG_BYTES
    )
    detail = await get_support_ticket_detail(db, it_account, ticket.id)
    assert detail is not None and len(detail.attachments) == 2
    ticket_record = await db.get(SupportTicket, ticket.id)
    assert ticket_record is not None
    resolved_ticket = await update_support_ticket_status(
        db,
        ticket_record,
        it_account,
        SupportTicketStatusUpdate(status="Resolved"),
    )
    assert resolved_ticket.status == "Resolved"
    await db.refresh(attachment)
    assert attachment.retention_expires_at is not None

    reopened = await create_support_ticket_message(
        db,
        ticket_record,
        enterprise_account,
        SupportTicketMessageCreate(message="The camera issue happened again."),
    )
    assert reopened.status == "Open"
    await db.refresh(attachment)
    assert attachment.retention_expires_at is None


def _account(*, role: AccountRole, activated_at: datetime) -> Account:
    identifier = str(uuid4())
    return Account(
        id=identifier,
        email=f"asset-{identifier}@example.com",
        password_hash="hash",
        role=role,
        display_name=f"Asset {role.value.title()}",
        title=role.value.title(),
        status=AccountStatus.ACTIVE,
        activated_at=activated_at,
    )


def _topology(account: Account, *, now: datetime) -> AccountTopology:
    enterprise = Enterprise(
        id=str(uuid4()),
        official_code=f"asset-{uuid4()}",
        name="Normalized Asset Enterprise",
        category="business",
        classification="official",
        lifecycle_state="active",
    )
    membership = EnterpriseMembership(
        id=str(uuid4()),
        enterprise_id=enterprise.id,
        account_id=account.id,
        classification="official",
        membership_role="manager",
        started_at=now,
    )
    site = EnterpriseSite(
        id=str(uuid4()),
        enterprise_id=enterprise.id,
        classification="official",
        site_code="primary",
        name="Normalized Asset Enterprise Primary Site",
        barangay="Poblacion",
        address="San Pedro, Laguna",
        building_capacity=100,
        effective_from=now,
    )
    return AccountTopology(
        account=account,
        membership=membership,
        enterprise=enterprise,
        site=site,
        active_devices=(),
        live_state=None,
        evaluated_at=now,
    )
