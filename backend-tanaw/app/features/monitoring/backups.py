"""The server copy of each enterprise's unsubmitted desktop data.

The desktop uploads its open reporting days, report drafts, reports still
waiting to upload, and camera settings about once an hour. The server keeps only
the latest copy per enterprise, so a reinstalled or reset desktop can restore
them after sign-in.

Each saved copy has a revision. An upload names the revision its desktop last
restored or saved, and is refused when the server holds a different one: the
desktop has not merged that copy yet, and replacing it could discard the only
recoverable data (from a second computer, or from before a reset).
"""

import json
from datetime import UTC, datetime

from sqlalchemy import select
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


class DesktopBackupConflictError(ValueError):
    """Raised when an upload was not based on the copy the server currently keeps."""


async def save_desktop_backup(
    db: AsyncSession, account: Account, payload: DesktopBackupUpload
) -> DesktopBackupSummary:
    profile = require_enterprise_profile(account)
    captured_at = _aware(payload.capturedAt)
    stored = payload.model_dump(mode="json", exclude={"baseRevision"})
    received_at = datetime.now(UTC)
    values: dict[str, object] = {
        "device_id": payload.deviceId,
        "captured_at": captured_at,
        "received_at": received_at,
        "schema_version": payload.schemaVersion,
        "day_count": len(payload.days),
        "draft_count": len(payload.drafts),
        "submission_count": len(payload.submissions),
        "camera_count": len(payload.cameras),
        "payload_json": json.dumps(stored, sort_keys=True),
    }
    current = await db.scalar(
        select(DesktopLocalBackup)
        .where(DesktopLocalBackup.enterprise_profile_id == profile.account_id)
        .with_for_update()
    )
    if current is None:
        # Nothing to discard. A concurrent first upload wins the insert; this one conflicts.
        revision = await db.scalar(
            insert(DesktopLocalBackup)
            .values(enterprise_profile_id=profile.account_id, revision=1, **values)
            .on_conflict_do_nothing(index_elements=[DesktopLocalBackup.enterprise_profile_id])
            .returning(DesktopLocalBackup.revision)
        )
        if revision is None:
            raise DesktopBackupConflictError(
                "Another desktop saved a backup first. Merge it before uploading."
            )
    else:
        if current.revision != payload.baseRevision:
            raise DesktopBackupConflictError(
                "The server holds a backup this desktop has not merged yet."
            )
        revision = current.revision + 1
        current.revision = revision
        for key, value in values.items():
            setattr(current, key, value)
        await db.flush()
    return DesktopBackupSummary(
        deviceId=payload.deviceId,
        revision=revision,
        capturedAt=captured_at,
        receivedAt=received_at,
        days=len(payload.days),
        drafts=len(payload.drafts),
        submissions=len(payload.submissions),
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
        {
            **json.loads(backup.payload_json),
            "enterpriseId": profile.enterprise_id,
            "revision": backup.revision,
            "receivedAt": backup.received_at,
        }
    )


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
