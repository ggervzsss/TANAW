import hashlib
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.assets.models import AccountAsset, SupportAttachment
from app.features.assets.storage import LocalAssetStorage
from app.features.maintenance.asset_retention import run_asset_retention
from app.features.operational.models import SupportTicket

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
TEST_EMAIL_PATTERN = "tanaw-asset-retention-%@example.com"
TEST_TICKET_PATTERN = "TCK-ASSET-RETENTION-%"
PNG_BYTES = b"\x89PNG\r\n\x1a\nasset-retention-postgres"


@dataclass(frozen=True)
class AssetRetentionRuntime:
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    settings: Settings
    storage: LocalAssetStorage


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
async def asset_retention_runtime(tmp_path: Path) -> AsyncIterator[AssetRetentionRuntime]:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")
    database_url = _postgres_async_url(raw_url)
    engine = create_async_engine(database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        environment="development",
        database_url=database_url,
        asset_storage_root=tmp_path,
        retention_cleanup_batch_size=20,
        asset_deleted_metadata_retention_days=30,
        stale_asset_temporary_retention_hours=24,
        asset_orphan_scan_max_objects=1000,
    )
    runtime = AssetRetentionRuntime(
        engine=engine,
        sessions=sessions,
        settings=settings,
        storage=LocalAssetStorage(tmp_path),
    )
    await _clean(runtime)
    try:
        yield runtime
    finally:
        await _clean(runtime)
        await engine.dispose()


async def _clean(runtime: AssetRetentionRuntime) -> None:
    async with runtime.sessions() as db:
        ticket_ids = list(
            await db.scalars(
                select(SupportTicket.id).where(SupportTicket.ticket_code.like(TEST_TICKET_PATTERN))
            )
        )
        if ticket_ids:
            await db.execute(
                delete(SupportAttachment).where(SupportAttachment.ticket_id.in_(ticket_ids))
            )
            await db.execute(delete(SupportTicket).where(SupportTicket.id.in_(ticket_ids)))
        account_ids = list(
            await db.scalars(select(Account.id).where(Account.email.like(TEST_EMAIL_PATTERN)))
        )
        if account_ids:
            await db.execute(delete(AccountAsset).where(AccountAsset.account_id.in_(account_ids)))
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


@pytest.mark.asyncio
async def test_asset_retention_retires_expired_content_and_removes_orphans(
    asset_retention_runtime: AssetRetentionRuntime,
) -> None:
    runtime = asset_retention_runtime
    now = datetime.now(UTC)
    old = now - timedelta(days=400)
    account_id = str(uuid4())
    deleted_asset_id = str(uuid4())
    active_asset_id = str(uuid4())
    ticket_id = str(uuid4())
    attachment_id = str(uuid4())
    deleted_key = f"accounts/{account_id}/profile/{deleted_asset_id}"
    active_key = f"accounts/{account_id}/profile/{active_asset_id}"
    attachment_key = f"tickets/{ticket_id}/{attachment_id}"
    orphan_key = f"tickets/orphan-{uuid4()}/{uuid4()}"
    fresh_orphan_key = f"tickets/in-flight-{uuid4()}/{uuid4()}"

    async with runtime.sessions() as db:
        db.add(
            Account(
                id=account_id,
                email=f"tanaw-asset-retention-{uuid4()}@example.com",
                password_hash="hash",
                role=AccountRole.IT,
                display_name="Asset Retention Test",
                title="IT Personnel",
                status=AccountStatus.ACTIVE,
                activated_at=now,
            )
        )
        db.add(
            SupportTicket(
                id=ticket_id,
                ticket_code=f"TCK-ASSET-RETENTION-{uuid4().hex[:12]}",
                enterprise_account_id=account_id,
                enterprise_id="asset-retention-enterprise",
                enterprise_name="Asset Retention Enterprise",
                category="Camera Issue",
                priority="High",
                subject="Retained camera evidence",
                description="Attachment retention integration test.",
                status="Resolved",
                created_at=old,
                updated_at=old,
            )
        )
        await db.flush()
        db.add_all(
            [
                AccountAsset(
                    id=deleted_asset_id,
                    account_id=account_id,
                    asset_kind="profile_image",
                    storage_key=deleted_key,
                    file_name="deleted.png",
                    mime_type="image/png",
                    size_bytes=len(PNG_BYTES),
                    content_hash=_hash(PNG_BYTES),
                    status="deleted",
                    created_at=old,
                    deleted_at=old,
                ),
                AccountAsset(
                    id=active_asset_id,
                    account_id=account_id,
                    asset_kind="profile_image",
                    storage_key=active_key,
                    file_name="active.png",
                    mime_type="image/png",
                    size_bytes=len(PNG_BYTES),
                    content_hash=_hash(PNG_BYTES),
                    status="active",
                    created_at=now,
                ),
                SupportAttachment(
                    id=attachment_id,
                    ticket_id=ticket_id,
                    ordinal=0,
                    storage_key=attachment_key,
                    file_name="evidence.png",
                    mime_type="image/png",
                    size_bytes=len(PNG_BYTES),
                    content_hash=_hash(PNG_BYTES),
                    status="active",
                    retention_expires_at=now - timedelta(days=1),
                    created_at=old,
                ),
            ]
        )
        await db.commit()

    for key in (deleted_key, active_key, attachment_key, orphan_key, fresh_orphan_key):
        await runtime.storage.put(key=key, content=PNG_BYTES, max_bytes=1024)
    orphan_path = runtime.storage.root.joinpath(*orphan_key.split("/"))
    old_timestamp = (now - timedelta(days=2)).timestamp()
    os.utime(orphan_path, (old_timestamp, old_timestamp))
    temporary = runtime.storage.root / "tickets" / ".interrupted.deadbeef.tmp"
    temporary.parent.mkdir(parents=True, exist_ok=True)
    temporary.write_bytes(b"partial")
    os.utime(temporary, (old_timestamp, old_timestamp))

    counts = await run_asset_retention(
        runtime.settings,
        now=now,
        session_factory=runtime.sessions,
        storage=runtime.storage,
    )

    assert counts.support_attachments_retired == 1
    assert counts.objects_reconciled == 2
    assert counts.metadata_deleted == 1
    assert counts.orphan_objects_deleted == 1
    assert counts.temporary_objects_deleted == 1
    assert await runtime.storage.list_keys(max_objects=10) == (
        active_key,
        fresh_orphan_key,
    )
    async with runtime.sessions() as db:
        assert await db.get(AccountAsset, deleted_asset_id) is None
        assert await db.get(AccountAsset, active_asset_id) is not None
        attachment = await db.get(SupportAttachment, attachment_id)
        assert attachment is not None
        assert attachment.status == "deleted"
        assert attachment.deleted_at == now


@pytest.mark.asyncio
async def test_ticket_reopen_lock_prevents_concurrent_attachment_retirement(
    asset_retention_runtime: AssetRetentionRuntime,
) -> None:
    runtime = asset_retention_runtime
    now = datetime.now(UTC)
    account_id = str(uuid4())
    ticket_id = str(uuid4())
    attachment_id = str(uuid4())

    async with runtime.sessions() as db:
        db.add(
            Account(
                id=account_id,
                email=f"tanaw-asset-retention-{uuid4()}@example.com",
                password_hash="hash",
                role=AccountRole.IT,
                display_name="Concurrent Reopen Test",
                title="IT Personnel",
                status=AccountStatus.ACTIVE,
                activated_at=now,
            )
        )
        db.add(
            SupportTicket(
                id=ticket_id,
                ticket_code=f"TCK-ASSET-RETENTION-{uuid4().hex[:12]}",
                enterprise_account_id=account_id,
                enterprise_id="asset-retention-enterprise",
                enterprise_name="Asset Retention Enterprise",
                category="Camera Issue",
                priority="High",
                subject="Concurrent ticket reopen",
                description="The reopen transaction must win over retention.",
                status="Resolved",
                created_at=now - timedelta(days=400),
                updated_at=now - timedelta(days=400),
            )
        )
        await db.flush()
        db.add(
            SupportAttachment(
                id=attachment_id,
                ticket_id=ticket_id,
                ordinal=0,
                storage_key=f"tickets/{ticket_id}/{attachment_id}",
                file_name="evidence.png",
                mime_type="image/png",
                size_bytes=len(PNG_BYTES),
                content_hash=_hash(PNG_BYTES),
                status="active",
                retention_expires_at=now - timedelta(days=1),
                created_at=now - timedelta(days=400),
            )
        )
        await db.commit()

    async with runtime.sessions() as reopening:
        ticket = await reopening.scalar(
            select(SupportTicket).where(SupportTicket.id == ticket_id).with_for_update()
        )
        attachment = await reopening.get(SupportAttachment, attachment_id)
        assert ticket is not None
        assert attachment is not None
        ticket.status = "Open"
        attachment.retention_expires_at = None
        await reopening.flush()

        counts = await run_asset_retention(
            runtime.settings,
            now=now,
            session_factory=runtime.sessions,
            storage=runtime.storage,
        )
        assert counts.support_attachments_retired == 0
        await reopening.commit()

    async with runtime.sessions() as db:
        attachment = await db.get(SupportAttachment, attachment_id)
        assert attachment is not None
        assert attachment.status == "active"
        assert attachment.retention_expires_at is None


def _hash(content: bytes) -> str:
    return f"sha256:{hashlib.sha256(content).hexdigest()}"
