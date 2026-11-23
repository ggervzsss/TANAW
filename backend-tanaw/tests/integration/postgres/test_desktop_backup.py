from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.monitoring.backups import (
    StaleDesktopBackupError,
    get_desktop_backup,
    save_desktop_backup,
)
from app.features.monitoring.models import DesktopLocalBackup
from app.features.monitoring.schemas import DesktopBackupUpload
from tests.support.postgres import PostgresRuntime, open_postgres_runtime

TEST_PREFIX = "tanaw-backup-pg-"
TEST_EMAIL_PATTERN = f"{TEST_PREFIX}%@example.com"


@pytest_asyncio.fixture
async def postgres_runtime() -> AsyncIterator[PostgresRuntime]:
    async with open_postgres_runtime(_clean_rows) as runtime:
        yield runtime


async def _clean_rows(runtime: PostgresRuntime) -> None:
    async with runtime.sessions() as db:
        account_ids = list(
            await db.scalars(select(Account.id).where(Account.email.like(TEST_EMAIL_PATTERN)))
        )
        if account_ids:
            await db.execute(
                delete(DesktopLocalBackup).where(
                    DesktopLocalBackup.enterprise_profile_id.in_(account_ids)
                )
            )
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


@pytest.mark.asyncio
async def test_latest_backup_replaces_the_previous_copy_per_enterprise(
    postgres_runtime: PostgresRuntime,
) -> None:
    now = datetime.now(UTC)
    first = _enterprise("first")
    second = _enterprise("second")
    async with postgres_runtime.sessions() as db:
        db.add_all([first, second])
        await db.flush()

        assert await get_desktop_backup(db, first) is None
        saved = await save_desktop_backup(db, first, _upload(now - timedelta(hours=1), entries=5))
        assert (saved.days, saved.drafts, saved.cameras) == (1, 1, 1)
        await save_desktop_backup(db, first, _upload(now, entries=9))
        await save_desktop_backup(db, second, _upload(now, entries=2))
        await db.commit()

    async with postgres_runtime.sessions() as db:
        backup = await get_desktop_backup(db, first)
        assert backup is not None
        assert backup.capturedAt == now
        assert backup.days[0].metrics["entries"] == 9
        assert backup.drafts[0].draftKey == "period:November 2026"
        rows = await db.scalar(
            select(DesktopLocalBackup).where(DesktopLocalBackup.enterprise_profile_id == first.id)
        )
        assert rows is not None
        assert rows.day_count == 1
        other = await get_desktop_backup(db, second)
        assert other is not None
        assert other.days[0].metrics["entries"] == 2


@pytest.mark.asyncio
async def test_a_delayed_older_upload_keeps_the_newer_copy(
    postgres_runtime: PostgresRuntime,
) -> None:
    now = datetime.now(UTC)
    enterprise = _enterprise("stale")
    async with postgres_runtime.sessions() as db:
        db.add(enterprise)
        await db.flush()
        await save_desktop_backup(db, enterprise, _upload(now, entries=9))

        with pytest.raises(StaleDesktopBackupError):
            await save_desktop_backup(db, enterprise, _upload(now - timedelta(hours=1), entries=1))

        backup = await get_desktop_backup(db, enterprise)
        assert backup is not None
        assert backup.days[0].metrics["entries"] == 9


def _upload(captured_at: datetime, *, entries: int) -> DesktopBackupUpload:
    values: dict[str, Any] = {
        "schemaVersion": 1,
        "deviceId": "desktop-1",
        "capturedAt": captured_at,
        "days": [
            {
                "businessDate": "2026-11-16",
                "finalized": False,
                "metrics": {"business_date": "2026-11-16", "entries": entries},
            }
        ],
        "drafts": [
            {
                "draftKey": "period:November 2026",
                "period": "November 2026",
                "payload": {"origins": {}},
                "updatedAt": captured_at,
            }
        ],
        "cameras": [{"id": 1, "name": "Main entrance", "rtsp": "rtsp://192.168.1.21/stream2"}],
    }
    return DesktopBackupUpload.model_validate(values)


def _enterprise(label: str) -> Account:
    suffix = uuid4().hex[:20]
    account_id = f"{TEST_PREFIX}{suffix}"[:36]
    return Account(
        id=account_id,
        email=f"{TEST_PREFIX}{label}-{suffix}@example.com",
        password_hash="integration-test-password-hash",
        role=AccountRole.ENTERPRISE,
        display_name=f"Backup {label}",
        title="Enterprise Representative",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        enterprise_profile=EnterpriseProfile(
            account_id=account_id,
            enterprise_id=f"BACKUP-{label}-{suffix}",
            enterprise_name=f"Backup {label}",
            attraction_code="413",
            manager_name="Backup Manager",
            barangay="Nueva",
            building_capacity=100,
        ),
    )
