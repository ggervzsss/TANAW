"""Enterprise health reads every enterprise account and today's check-ins from PostgreSQL."""

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.opening_hours import WEEKDAYS, DayHours, OpeningHours
from app.features.auth.models import AccountActivationToken
from app.features.monitoring.health import (
    find_enterprise,
    get_enterprise_health,
    get_enterprise_health_today,
    list_enterprise_health,
)
from app.features.monitoring.models import EnterpriseTelemetrySnapshot
from tests.support.postgres import PostgresRuntime, open_postgres_runtime

TEST_PREFIX = "tanaw-health-pg-"
TEST_EMAIL_PATTERN = f"{TEST_PREFIX}%@example.com"
OPEN_ALL_DAY = OpeningHours(days=[DayHours(day=day, mode="open24h") for day in WEEKDAYS])


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
                delete(EnterpriseTelemetrySnapshot).where(
                    EnterpriseTelemetrySnapshot.enterprise_profile_id.in_(account_ids)
                )
            )
            await db.execute(
                delete(AccountActivationToken).where(
                    AccountActivationToken.account_id.in_(account_ids)
                )
            )
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


@pytest.mark.asyncio
async def test_health_lists_every_enterprise_account_with_its_app_and_cameras(
    postgres_runtime: PostgresRuntime,
) -> None:
    now = datetime.now(UTC)
    active = _enterprise("active")
    invited = _enterprise("invited", activated=False)
    expired = _enterprise("expired", activated=False)
    deactivated = _enterprise("deactivated", status=AccountStatus.INACTIVE)

    async with postgres_runtime.sessions() as db:
        db.add_all([active, invited, expired, deactivated])
        await db.flush()
        db.add_all(
            [
                _token(invited, expires_at=now + timedelta(hours=10)),
                _token(expired, expires_at=now - timedelta(hours=1)),
                _snapshot(active, now - timedelta(minutes=30), camera_counting=True),
                _snapshot(active, now - timedelta(seconds=20), camera_counting=False),
            ]
        )
        await db.flush()

        listed = {
            item.accountId: item
            for item in await list_enterprise_health(db, now)
            if item.accountId.startswith(TEST_PREFIX)
        }
        assert {key: item.accountState for key, item in listed.items()} == {
            active.id: "active",
            invited.id: "invited",
            expired.id: "expired",
            deactivated.id: "deactivated",
        }
        summary = listed[active.id]
        assert summary.app.status == "online"
        assert (summary.app.version, summary.app.computerName) == ("0.1.3", "FRONT-DESK-PC")
        assert (summary.cameras.total, summary.cameras.counting) == (2, 1)
        assert listed[invited.id].app.status == "not_set_up"

        profile = active.enterprise_profile
        assert profile is not None
        found_by_enterprise = await find_enterprise(db, profile.enterprise_id)
        found_by_account = await find_enterprise(db, active.id)
        assert found_by_enterprise is not None and found_by_account is not None
        assert found_by_enterprise.id == found_by_account.id == active.id

        one = await get_enterprise_health(db, active, now)
        deck = next(camera for camera in one.cameras.list if camera.id == "2")
        assert deck.status == "not_counting"
        assert deck.since is not None

        today = await get_enterprise_health_today(db, active, now)
        assert today.hours == list(range(24))
        assert [camera.id for camera in today.cameras] == ["1", "2"]
        assert today.cameras[1].mode == "open_space"
        # Just after midnight the counting stretch may have ended yesterday.
        assert today.cameras[1].note.startswith(("Not counting since", "No counts today"))
        await db.rollback()


def _enterprise(
    label: str, *, activated: bool = True, status: AccountStatus = AccountStatus.ACTIVE
) -> Account:
    suffix = uuid4().hex[:16]
    account_id = f"{TEST_PREFIX}{suffix}"[:36]
    return Account(
        id=account_id,
        email=f"{TEST_PREFIX}{label}-{suffix}@example.com",
        password_hash="integration-test-password-hash",
        role=AccountRole.ENTERPRISE,
        display_name=f"Health {label}",
        title="Enterprise Account",
        status=status,
        activated_at=datetime.now(UTC) - timedelta(days=3) if activated else None,
        enterprise_profile=EnterpriseProfile(
            account_id=account_id,
            enterprise_id=f"HEALTH-{label}-{suffix}",
            enterprise_name=f"Health {label}",
            attraction_code="413",
            manager_name="Health Manager",
            barangay="Nueva",
            building_capacity=100,
            opening_hours_json=OPEN_ALL_DAY.model_dump_json(),
        ),
    )


def _token(account: Account, *, expires_at: datetime) -> AccountActivationToken:
    return AccountActivationToken(
        id=uuid4().hex,
        account_id=account.id,
        token_hash=uuid4().hex,
        expires_at=expires_at,
    )


def _snapshot(
    account: Account, at: datetime, *, camera_counting: bool
) -> EnterpriseTelemetrySnapshot:
    profile = account.enterprise_profile
    assert profile is not None
    return EnterpriseTelemetrySnapshot(
        id=str(uuid4()),
        enterprise_profile_id=account.id,
        enterprise_name=profile.enterprise_name,
        captured_at=at,
        received_at=at,
        running=True,
        status="running",
        payload_json=json.dumps(
            {
                "app": {"version": "0.1.3", "computerName": "FRONT-DESK-PC"},
                "monitoring": {
                    "status": "running" if camera_counting else "partial",
                    "cameras": [
                        {"cameraId": 1, "cameraName": "Gate", "status": "running"},
                        {
                            "cameraId": 2,
                            "cameraName": "Deck",
                            "status": "running" if camera_counting else "error",
                            "error": None if camera_counting else "Lost the picture.",
                            "mode": "open_space",
                            "brand": "dahua",
                        },
                    ],
                },
            }
        ),
    )
