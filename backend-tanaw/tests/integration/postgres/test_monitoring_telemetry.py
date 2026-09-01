from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.maintenance.retention import _delete_telemetry_snapshots
from app.features.monitoring.models import EnterpriseTelemetrySnapshot
from app.features.monitoring.schemas import DesktopTelemetryIngest
from app.features.monitoring.telemetry import ingest_telemetry, list_latest_telemetry
from app.features.realtime.models import RealtimeOutbox
from tests.support.postgres import PostgresRuntime, postgres_test_database_url

TEST_PREFIX = "tanaw-f08-pg-"
TEST_EMAIL_PATTERN = f"{TEST_PREFIX}%@example.com"


@pytest_asyncio.fixture
async def postgres_runtime() -> AsyncIterator[PostgresRuntime]:
    database_url = postgres_test_database_url()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    runtime = PostgresRuntime(
        engine=engine,
        sessions=sessions,
        settings=Settings(environment="development", database_url=database_url),
    )
    await _clean_rows(runtime)
    try:
        yield runtime
    finally:
        await _clean_rows(runtime)
        await engine.dispose()


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
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.execute(
            delete(RealtimeOutbox).where(
                RealtimeOutbox.coalesce_key.like(f"telemetry:{TEST_PREFIX}%")
            )
        )
        await db.commit()


@pytest.mark.asyncio
async def test_ingestion_latest_lookup_and_enterprise_scope(
    postgres_runtime: PostgresRuntime,
) -> None:
    now = datetime.now(UTC)
    first = _enterprise("first")
    second = _enterprise("second")

    async with postgres_runtime.sessions() as db:
        db.add_all([first, second])
        await db.flush()

        ingested = await ingest_telemetry(
            db,
            first,
            _ingest_payload(captured_at=now - timedelta(minutes=2), occupancy=3),
        )
        persisted = await db.get(EnterpriseTelemetrySnapshot, ingested.id)
        assert persisted is not None
        assert persisted.current_occupancy == 3
        assert persisted.payload_json is not None

        shared_received_at = now + timedelta(minutes=1)
        first_latest_id = "ffffffff-ffff-ffff-ffff-fffffffffff1"
        db.add_all(
            [
                _snapshot(
                    first,
                    snapshot_id="00000000-0000-0000-0000-000000000001",
                    captured_at=now,
                    received_at=shared_received_at,
                    occupancy=8,
                ),
                _snapshot(
                    first,
                    snapshot_id=first_latest_id,
                    captured_at=now,
                    received_at=shared_received_at,
                    occupancy=9,
                ),
                _snapshot(
                    second,
                    snapshot_id="ffffffff-ffff-ffff-ffff-fffffffffff2",
                    captured_at=now,
                    received_at=now,
                    occupancy=4,
                ),
            ]
        )
        await db.commit()

    async with postgres_runtime.sessions() as db:
        enterprise_latest = await list_latest_telemetry(db, first)
        all_latest = await list_latest_telemetry(db, None)

        first_profile = first.enterprise_profile
        second_profile = second.enterprise_profile
        assert first_profile is not None
        assert second_profile is not None
        assert [(item.id, item.currentOccupancy) for item in enterprise_latest] == [
            (first_latest_id, 9)
        ]
        assert {item.enterpriseId: item.currentOccupancy for item in all_latest} == {
            first_profile.enterprise_id: 9,
            second_profile.enterprise_id: 4,
        }


@pytest.mark.asyncio
async def test_retention_is_bounded_repeatable_and_preserves_recent_enterprise_data(
    postgres_runtime: PostgresRuntime,
) -> None:
    now = datetime(2026, 9, 1, 12, tzinfo=UTC)
    cutoff = now - timedelta(days=45)
    first = _enterprise("retention-first")
    second = _enterprise("retention-second")
    old_ids = [str(uuid4()) for _ in range(3)]
    recent_ids = [str(uuid4()) for _ in range(2)]

    async with postgres_runtime.sessions() as db:
        db.add_all([first, second])
        await db.flush()
        db.add_all(
            [
                _snapshot(
                    first,
                    snapshot_id=old_ids[0],
                    captured_at=now - timedelta(days=60),
                    received_at=now - timedelta(days=60),
                    occupancy=1,
                ),
                _snapshot(
                    second,
                    snapshot_id=old_ids[1],
                    captured_at=now - timedelta(days=55),
                    received_at=now - timedelta(days=55),
                    occupancy=2,
                ),
                _snapshot(
                    first,
                    snapshot_id=old_ids[2],
                    captured_at=now - timedelta(days=50),
                    received_at=now - timedelta(days=50),
                    occupancy=3,
                ),
                _snapshot(
                    first,
                    snapshot_id=recent_ids[0],
                    captured_at=cutoff,
                    received_at=cutoff,
                    occupancy=8,
                ),
                _snapshot(
                    second,
                    snapshot_id=recent_ids[1],
                    captured_at=now,
                    received_at=now,
                    occupancy=9,
                ),
            ]
        )
        await db.commit()

    first_count = await _delete_telemetry_snapshots(
        postgres_runtime.sessions, cutoff=cutoff, batch_size=2
    )
    second_count = await _delete_telemetry_snapshots(
        postgres_runtime.sessions, cutoff=cutoff, batch_size=2
    )
    third_count = await _delete_telemetry_snapshots(
        postgres_runtime.sessions, cutoff=cutoff, batch_size=2
    )

    assert (first_count, second_count, third_count) == (2, 1, 0)
    async with postgres_runtime.sessions() as db:
        assert not list(
            await db.scalars(
                select(EnterpriseTelemetrySnapshot.id).where(
                    EnterpriseTelemetrySnapshot.id.in_(old_ids)
                )
            )
        )
        assert set(
            await db.scalars(
                select(EnterpriseTelemetrySnapshot.id).where(
                    EnterpriseTelemetrySnapshot.id.in_(recent_ids)
                )
            )
        ) == set(recent_ids)


@pytest.mark.asyncio
async def test_postgresql_has_latest_telemetry_composite_index(
    postgres_runtime: PostgresRuntime,
) -> None:
    async with postgres_runtime.sessions() as db:
        index_definition = await db.scalar(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE schemaname = current_schema() "
                "AND tablename = 'enterprise_telemetry_snapshots' "
                "AND indexname = 'ix_enterprise_telemetry_snapshots_enterprise_received'"
            )
        )

    assert index_definition is not None
    normalized = " ".join(index_definition.lower().split())
    assert "(enterprise_profile_id, received_at desc, id desc)" in normalized


def _enterprise(label: str) -> Account:
    suffix = uuid4().hex[:20]
    account_id = f"{TEST_PREFIX}{suffix}"[:36]
    return Account(
        id=account_id,
        email=f"{TEST_PREFIX}{label}-{suffix}@example.com",
        password_hash="integration-test-password-hash",
        role=AccountRole.ENTERPRISE,
        display_name=f"F08 {label}",
        title="Enterprise Representative",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        enterprise_profile=EnterpriseProfile(
            account_id=account_id,
            enterprise_id=f"F08-{label}-{suffix}",
            enterprise_name=f"F08 {label}",
            category="Accommodation",
            manager_name="F08 Manager",
            barangay="Nueva",
            building_capacity=100,
        ),
    )


def _snapshot(
    account: Account,
    *,
    snapshot_id: str,
    captured_at: datetime,
    received_at: datetime,
    occupancy: int,
) -> EnterpriseTelemetrySnapshot:
    profile = account.enterprise_profile
    assert profile is not None
    return EnterpriseTelemetrySnapshot(
        id=snapshot_id,
        enterprise_profile_id=profile.account_id,
        enterprise_name=profile.enterprise_name,
        captured_at=captured_at,
        received_at=received_at,
        entries=occupancy,
        exits=0,
        current_occupancy=occupancy,
        peak_occupancy=occupancy,
        unique_count=occupancy,
        confirmed_unique_count=occupancy,
        degraded_unique_count=0,
        total_events=occupancy,
        unsubmitted_events=0,
        unsynced_events=0,
        running=True,
        status="running",
    )


def _ingest_payload(*, captured_at: datetime, occupancy: int) -> DesktopTelemetryIngest:
    return DesktopTelemetryIngest.model_validate(
        {
            "deviceId": "f08-device",
            "capturedAt": captured_at,
            "metrics": {
                "entries": occupancy,
                "exits": 0,
                "peakOccupancy": occupancy,
                "currentOccupancy": occupancy,
                "uniqueCount": occupancy,
                "confirmedUniqueCount": occupancy,
                "degradedUniqueCount": 0,
                "totalEvents": occupancy,
                "unsubmittedEvents": 0,
                "unsyncedEvents": 0,
            },
            "session": {"running": True, "status": "running"},
            "health": {"modelReady": True},
            "monitoring": {"status": "running"},
        }
    )
