"""The server copy of each enterprise's unsubmitted desktop data.

The desktop uploads its open reporting days, report drafts, and camera settings
about once an hour. The server keeps only the latest copy per enterprise, so a
reinstalled or reset desktop can restore them after sign-in.
"""

import json
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.enterprise import require_enterprise_profile
from app.features.accounts.models import Account
from app.features.monitoring.models import DesktopLocalBackup
from app.features.monitoring.schemas import (
    DesktopBackup,
    DesktopBackupSummary,
    DesktopBackupUpload,
)


class StaleDesktopBackupError(ValueError):
    """Raised when an upload is older than the copy the server already keeps."""


async def save_desktop_backup(
    db: AsyncSession, account: Account, payload: DesktopBackupUpload
) -> DesktopBackupSummary:
    profile = require_enterprise_profile(account)
    captured_at = _aware(payload.capturedAt)
    values = {
        "enterprise_profile_id": profile.account_id,
        "device_id": payload.deviceId,
        "captured_at": captured_at,
        "schema_version": payload.schemaVersion,
        "day_count": len(payload.days),
        "draft_count": len(payload.drafts),
        "camera_count": len(payload.cameras),
        "payload_json": json.dumps(payload.model_dump(mode="json"), sort_keys=True),
    }
    insert_statement = insert(DesktopLocalBackup).values(**values)
    excluded = insert_statement.excluded
    statement = insert_statement.on_conflict_do_update(
        index_elements=[DesktopLocalBackup.enterprise_profile_id],
        set_={
            **{key: excluded[key] for key in values if key != "enterprise_profile_id"},
            "received_at": func.now(),
        },
        # A delayed upload from before the last saved copy must not replace it.
        where=DesktopLocalBackup.captured_at <= excluded.captured_at,
    ).returning(DesktopLocalBackup.received_at)
    received_at = await db.scalar(statement)
    if received_at is None:
        raise StaleDesktopBackupError("A newer desktop backup is already saved.")
    return DesktopBackupSummary(
        deviceId=payload.deviceId,
        capturedAt=captured_at,
        receivedAt=received_at,
        days=len(payload.days),
        drafts=len(payload.drafts),
        cameras=len(payload.cameras),
    )


async def get_desktop_backup(db: AsyncSession, account: Account) -> DesktopBackup | None:
    profile = require_enterprise_profile(account)
    backup = await db.scalar(
        select(DesktopLocalBackup).where(
            DesktopLocalBackup.enterprise_profile_id == profile.account_id
        )
    )
    if backup is None:
        return None
    return DesktopBackup.model_validate(
        {**json.loads(backup.payload_json), "receivedAt": backup.received_at}
    )


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
