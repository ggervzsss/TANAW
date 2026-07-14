"""Bounded retention and reconciliation for externalized user assets."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.db.session import AsyncSessionLocal
from app.features.assets.models import AccountAsset, SupportAttachment
from app.features.assets.storage import (
    AssetInventoryStorage,
    AssetStorageError,
    LocalAssetStorage,
)
from app.features.support.models import SupportTicket

SessionFactory = async_sessionmaker[AsyncSession]


@dataclass(frozen=True)
class AssetRetentionCounts:
    support_attachments_retired: int = 0
    objects_reconciled: int = 0
    metadata_deleted: int = 0
    orphan_objects_deleted: int = 0
    temporary_objects_deleted: int = 0


async def run_asset_retention(
    settings: Settings,
    *,
    now: datetime | None = None,
    session_factory: SessionFactory = AsyncSessionLocal,
    storage: AssetInventoryStorage | None = None,
) -> AssetRetentionCounts:
    current = _as_utc(now or datetime.now(UTC))
    inventory = storage or LocalAssetStorage(settings.asset_storage_root)
    retired = await _retire_expired_support_attachments(
        session_factory,
        current=current,
        batch_size=settings.retention_cleanup_batch_size,
    )
    objects_reconciled, metadata_deleted = await _reconcile_deleted_asset_records(
        session_factory,
        storage=inventory,
        metadata_cutoff=current - timedelta(days=settings.asset_deleted_metadata_retention_days),
        batch_size=settings.retention_cleanup_batch_size,
    )
    orphan_objects_deleted = await _delete_orphan_objects(
        session_factory,
        storage=inventory,
        max_objects=settings.asset_orphan_scan_max_objects,
        older_than=current - timedelta(hours=settings.asset_orphan_grace_hours),
    )
    temporary_objects_deleted = await inventory.purge_stale_temporary_objects(
        older_than=current - timedelta(hours=settings.stale_asset_temporary_retention_hours),
        max_objects=settings.retention_cleanup_batch_size,
    )
    return AssetRetentionCounts(
        support_attachments_retired=retired,
        objects_reconciled=objects_reconciled,
        metadata_deleted=metadata_deleted,
        orphan_objects_deleted=orphan_objects_deleted,
        temporary_objects_deleted=temporary_objects_deleted,
    )


async def _retire_expired_support_attachments(
    session_factory: SessionFactory,
    *,
    current: datetime,
    batch_size: int,
) -> int:
    async with session_factory() as db:
        attachments = list(
            await db.scalars(
                select(SupportAttachment)
                .join(SupportTicket, SupportTicket.id == SupportAttachment.ticket_id)
                .where(
                    SupportAttachment.status == "active",
                    SupportAttachment.retention_expires_at.is_not(None),
                    SupportAttachment.retention_expires_at <= current,
                    SupportTicket.status == "Resolved",
                )
                .order_by(
                    SupportAttachment.retention_expires_at.asc(),
                    SupportAttachment.id.asc(),
                )
                .with_for_update(skip_locked=True)
                .limit(batch_size)
            )
        )
        for attachment in attachments:
            attachment.status = "deleted"
            attachment.deleted_at = current
        await db.commit()
        return len(attachments)


async def _reconcile_deleted_asset_records(
    session_factory: SessionFactory,
    *,
    storage: AssetInventoryStorage,
    metadata_cutoff: datetime,
    batch_size: int,
) -> tuple[int, int]:
    objects_reconciled = 0
    metadata_deleted = 0
    first_error: Exception | None = None
    async with session_factory() as db:
        records: list[AccountAsset | SupportAttachment] = []
        records.extend(await _deleted_records(db, AccountAsset, batch_size=batch_size))
        records.extend(await _deleted_records(db, SupportAttachment, batch_size=batch_size))
        for record in records:
            try:
                await storage.delete(key=record.storage_key)
            except Exception as exc:
                first_error = first_error or exc
                continue
            objects_reconciled += 1
            if record.deleted_at is not None and record.deleted_at < metadata_cutoff:
                await db.delete(record)
                metadata_deleted += 1
        await db.commit()
    if first_error is not None:
        raise AssetStorageError(
            "One or more retired asset objects could not be deleted."
        ) from first_error
    return objects_reconciled, metadata_deleted


async def _deleted_records[AssetRecord: (AccountAsset, SupportAttachment)](
    db: AsyncSession,
    model: type[AssetRecord],
    *,
    batch_size: int,
) -> Sequence[AssetRecord]:
    return list(
        await db.scalars(
            select(model)
            .where(model.status == "deleted")
            .order_by(model.deleted_at.asc(), model.id.asc())
            .with_for_update(skip_locked=True)
            .limit(batch_size)
        )
    )


async def _delete_orphan_objects(
    session_factory: SessionFactory,
    *,
    storage: AssetInventoryStorage,
    max_objects: int,
    older_than: datetime,
) -> int:
    keys = await storage.list_keys(max_objects=max_objects, older_than=older_than)
    if not keys:
        return 0
    referenced: set[str] = set()
    async with session_factory() as db:
        for chunk in _chunks(keys, 1000):
            referenced.update(
                await db.scalars(
                    select(AccountAsset.storage_key).where(AccountAsset.storage_key.in_(chunk))
                )
            )
            referenced.update(
                await db.scalars(
                    select(SupportAttachment.storage_key).where(
                        SupportAttachment.storage_key.in_(chunk)
                    )
                )
            )
    orphans = [key for key in keys if key not in referenced]
    for key in orphans:
        await storage.delete(key=key)
    return len(orphans)


def _chunks(values: Sequence[str], size: int) -> list[Sequence[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Retention time must be timezone-aware.")
    return value.astimezone(UTC)
