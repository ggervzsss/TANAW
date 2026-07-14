"""Authorized persistence services for normalized settings and user assets."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Literal, cast
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account
from app.features.assets.models import (
    AccountAsset,
    AccountPreference,
    AccountProfileChangeRequest,
)
from app.features.assets.storage import (
    AssetStorage,
    ValidatedImage,
    verify_stored_image,
)

logger = logging.getLogger(__name__)
type AccountTheme = Literal["light", "dark", "system"]


async def get_account_theme(db: AsyncSession, *, account_id: str) -> AccountTheme:
    preference = await db.get(AccountPreference, account_id)
    return cast(AccountTheme, preference.theme) if preference is not None else "system"


async def set_account_theme(
    db: AsyncSession,
    *,
    account_id: str,
    theme: str,
) -> AccountPreference:
    preference = await db.get(AccountPreference, account_id)
    if preference is None:
        preference = AccountPreference(account_id=account_id, theme=theme)
        db.add(preference)
    else:
        preference.theme = theme
    await db.commit()
    await db.refresh(preference)
    return preference


async def get_active_profile_asset(
    db: AsyncSession,
    *,
    account_id: str,
    lock: bool = False,
) -> AccountAsset | None:
    statement = select(AccountAsset).where(
        AccountAsset.account_id == account_id,
        AccountAsset.asset_kind == "profile_image",
        AccountAsset.status == "active",
    )
    if lock:
        statement = statement.with_for_update()
    return cast(AccountAsset | None, await db.scalar(statement))


def profile_asset_url(asset: AccountAsset | None) -> str | None:
    return f"/auth/profile/image/{asset.id}" if asset is not None else None


async def replace_profile_asset(
    db: AsyncSession,
    *,
    storage: AssetStorage,
    account: Account,
    image: ValidatedImage,
) -> AccountAsset:
    asset_id = str(uuid4())
    storage_key = f"accounts/{account.id}/profile/{asset_id}"
    await storage.put(key=storage_key, content=image.content, max_bytes=image.size_bytes)
    previous_key: str | None = None
    try:
        previous = await get_active_profile_asset(db, account_id=account.id, lock=True)
        now = datetime.now(UTC)
        if previous is not None:
            previous.status = "deleted"
            previous.deleted_at = now
            previous_key = previous.storage_key
        asset = AccountAsset(
            id=asset_id,
            account_id=account.id,
            asset_kind="profile_image",
            storage_key=storage_key,
            file_name=image.file_name,
            mime_type=image.mime_type,
            size_bytes=image.size_bytes,
            content_hash=image.content_hash,
            status="active",
        )
        db.add(asset)
        await db.commit()
        await db.refresh(asset)
    except Exception:
        await db.rollback()
        await storage.delete(key=storage_key)
        raise
    if previous_key is not None:
        await _best_effort_delete(storage, key=previous_key)
    return asset


async def delete_profile_asset(
    db: AsyncSession,
    *,
    storage: AssetStorage,
    account_id: str,
) -> None:
    asset = await get_active_profile_asset(db, account_id=account_id, lock=True)
    if asset is None:
        return
    asset.status = "deleted"
    asset.deleted_at = datetime.now(UTC)
    await db.commit()
    await _best_effort_delete(storage, key=asset.storage_key)


async def read_profile_asset(
    db: AsyncSession,
    *,
    storage: AssetStorage,
    account_id: str,
    asset_id: str,
) -> tuple[AccountAsset, bytes] | None:
    asset = await db.scalar(
        select(AccountAsset).where(
            AccountAsset.id == asset_id,
            AccountAsset.account_id == account_id,
            AccountAsset.asset_kind == "profile_image",
            AccountAsset.status == "active",
        )
    )
    if asset is None:
        return None
    content = await storage.read(key=asset.storage_key, max_bytes=asset.size_bytes)
    verify_stored_image(
        content=content,
        size_bytes=asset.size_bytes,
        content_hash=asset.content_hash,
    )
    return asset, content


async def get_pending_contact_change(
    db: AsyncSession,
    *,
    account_id: str,
    lock: bool = False,
) -> AccountProfileChangeRequest | None:
    statement = select(AccountProfileChangeRequest).where(
        AccountProfileChangeRequest.account_id == account_id,
        AccountProfileChangeRequest.request_type == "contact_number",
        AccountProfileChangeRequest.status == "pending_review",
    )
    if lock:
        statement = statement.with_for_update()
    return cast(AccountProfileChangeRequest | None, await db.scalar(statement))


async def request_contact_change(
    db: AsyncSession,
    *,
    account_id: str,
    requested_value: str,
    requested_at: datetime,
) -> AccountProfileChangeRequest:
    current = await get_pending_contact_change(db, account_id=account_id, lock=True)
    if current is not None:
        current.status = "cancelled"
        current.resolved_at = requested_at
    request = AccountProfileChangeRequest(
        id=str(uuid4()),
        account_id=account_id,
        request_type="contact_number",
        requested_value=requested_value,
        status="pending_review",
        requested_at=requested_at,
    )
    db.add(request)
    await db.commit()
    await db.refresh(request)
    return request


async def resolve_contact_change(
    db: AsyncSession,
    *,
    account: Account,
    actor_account_id: str,
    approve: bool,
) -> AccountProfileChangeRequest | None:
    request = await get_pending_contact_change(db, account_id=account.id, lock=True)
    if request is None:
        return None
    if approve:
        account.phone = request.requested_value
    request.status = "approved" if approve else "rejected"
    request.resolved_at = datetime.now(UTC)
    request.resolved_by_account_id = actor_account_id
    await db.commit()
    await db.refresh(account)
    return request


async def _best_effort_delete(storage: AssetStorage, *, key: str) -> None:
    try:
        await storage.delete(key=key)
    except Exception:
        logger.exception("Asset cleanup failed for storage key %s", key)
