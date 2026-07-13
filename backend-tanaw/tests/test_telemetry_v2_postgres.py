import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any, TypedDict
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.telemetry.envelopes import EpochStartCommand, TelemetryCommand
from app.features.telemetry.models import (
    DeviceHealthSample,
    DeviceTelemetryEpoch,
    SiteLiveState,
    TelemetryMetricFact,
    TelemetryObservation,
)
from app.features.telemetry.service import (
    TelemetryIntakeConflict,
    TelemetryIntakeError,
    ingest_telemetry_command,
    list_enterprise_live_sites,
    list_official_live_sites,
    register_epoch_command,
)
from app.features.topology.models import (
    Camera,
    EdgeDevice,
    Enterprise,
    EnterpriseMembership,
    EnterpriseSite,
)

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
BASE_TIME = datetime(2026, 7, 13, 8, 15, 3, tzinfo=UTC)


class Scope(TypedDict):
    account: Account
    enterprise: str
    site: str
    device: str
    camera: str
    classification: str


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
async def telemetry_session() -> AsyncIterator[AsyncSession]:
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
async def test_epoch_and_observation_are_exactly_idempotent_and_auditable(
    telemetry_session: AsyncSession,
) -> None:
    scope = await _seed_scope(telemetry_session, classification="official")
    epoch_command = EpochStartCommand.model_validate(
        _epoch_command(scope["device"], expected_version=0)
    )
    epoch = await register_epoch_command(
        telemetry_session,
        account=scope["account"],
        command=epoch_command,
        acknowledged_at=BASE_TIME - timedelta(seconds=5),
    )
    replayed_epoch = await register_epoch_command(
        telemetry_session,
        account=scope["account"],
        command=epoch_command,
        acknowledged_at=BASE_TIME,
    )

    assert epoch.disposition == "created"
    assert replayed_epoch.disposition == "replayed"
    assert replayed_epoch.acknowledgedAt == epoch.acknowledgedAt
    telemetry_command = TelemetryCommand.model_validate(
        _telemetry_command(
            scope,
            counter_epoch=str(epoch.resource.counterEpoch),
            generation=epoch.resource.epochGeneration,
            sequence=10,
            site_entries=3,
            camera_entries=999,
        )
    )
    created = await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=telemetry_command,
        acknowledged_at=BASE_TIME + timedelta(seconds=1),
    )
    replayed = created
    for replay_number in range(100):
        replayed = await ingest_telemetry_command(
            telemetry_session,
            account=scope["account"],
            command=telemetry_command,
            acknowledged_at=BASE_TIME + timedelta(seconds=2 + replay_number),
        )

    assert created.disposition == "created"
    assert replayed.disposition == "replayed"
    assert replayed.resource == created.resource
    assert replayed.acknowledgedAt == created.acknowledgedAt
    assert (
        await telemetry_session.scalar(select(func.count()).select_from(DeviceTelemetryEpoch)) == 1
    )
    assert (
        await telemetry_session.scalar(select(func.count()).select_from(TelemetryObservation)) == 1
    )
    assert (
        await telemetry_session.scalar(select(func.count()).select_from(TelemetryMetricFact)) == 2
    )
    assert await telemetry_session.scalar(select(func.count()).select_from(DeviceHealthSample)) == 1
    assert await telemetry_session.scalar(select(func.count()).select_from(DomainEvent)) == 2
    assert (
        await telemetry_session.scalar(select(func.count()).select_from(DomainEventDelivery)) == 4
    )

    live = await telemetry_session.get(SiteLiveState, scope["site"])
    assert live is not None
    assert live.entries_window == 3
    assert live.entries_window != 999
    health = await telemetry_session.scalar(select(DeviceHealthSample))
    assert health is not None
    assert health.camera_count == 1
    assert health.streaming_camera_count == 1

    hash_conflict_payload = _telemetry_command(
        scope,
        counter_epoch=str(epoch.resource.counterEpoch),
        generation=epoch.resource.epochGeneration,
        sequence=10,
        site_entries=4,
        camera_entries=999,
    )
    hash_conflict_payload["commandId"] = str(telemetry_command.commandId)
    hash_conflict_payload["idempotencyKey"] = telemetry_command.idempotencyKey
    with pytest.raises(TelemetryIntakeConflict, match="different payload hash"):
        await ingest_telemetry_command(
            telemetry_session,
            account=scope["account"],
            command=TelemetryCommand.model_validate(hash_conflict_payload),
            acknowledged_at=BASE_TIME + timedelta(minutes=1),
        )


@pytest.mark.asyncio
async def test_reordered_and_retired_epoch_evidence_never_rolls_current_state_back(
    telemetry_session: AsyncSession,
) -> None:
    scope = await _seed_scope(telemetry_session, classification="official")
    epoch_one = await register_epoch_command(
        telemetry_session,
        account=scope["account"],
        command=EpochStartCommand.model_validate(_epoch_command(scope["device"], 0)),
        acknowledged_at=BASE_TIME - timedelta(seconds=10),
    )
    sequence_ten = TelemetryCommand.model_validate(
        _telemetry_command(
            scope,
            counter_epoch=str(epoch_one.resource.counterEpoch),
            generation=1,
            sequence=10,
            site_entries=10,
        )
    )
    current = await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=sequence_ten,
        acknowledged_at=BASE_TIME,
    )
    sequence_nine = TelemetryCommand.model_validate(
        _telemetry_command(
            scope,
            counter_epoch=str(epoch_one.resource.counterEpoch),
            generation=1,
            sequence=9,
            site_entries=9,
        )
    )
    reordered = await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=sequence_nine,
        acknowledged_at=BASE_TIME + timedelta(seconds=1),
    )
    assert current.resource.becameCurrent is True
    assert reordered.resource.becameCurrent is False

    epoch_two_command = _epoch_command(
        scope["device"],
        expected_version=1,
        expected_previous=str(epoch_one.resource.counterEpoch),
    )
    epoch_two = await register_epoch_command(
        telemetry_session,
        account=scope["account"],
        command=EpochStartCommand.model_validate(epoch_two_command),
        acknowledged_at=BASE_TIME + timedelta(seconds=2),
    )
    restarted = await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=TelemetryCommand.model_validate(
            _telemetry_command(
                scope,
                counter_epoch=str(epoch_two.resource.counterEpoch),
                generation=2,
                sequence=0,
                site_entries=20,
            )
        ),
        acknowledged_at=BASE_TIME + timedelta(seconds=3),
    )
    delayed_old_epoch = await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=TelemetryCommand.model_validate(
            _telemetry_command(
                scope,
                counter_epoch=str(epoch_one.resource.counterEpoch),
                generation=1,
                sequence=11,
                site_entries=11,
            )
        ),
        acknowledged_at=BASE_TIME + timedelta(seconds=4),
    )

    assert restarted.resource.becameCurrent is True
    assert restarted.resource.liveStateVersion == 2
    assert delayed_old_epoch.resource.becameCurrent is False
    live = await telemetry_session.get(SiteLiveState, scope["site"])
    assert live is not None
    assert (live.epoch_generation, live.sequence, live.entries_window) == (2, 0, 20)
    assert (
        await telemetry_session.scalar(select(func.count()).select_from(TelemetryObservation)) == 4
    )


@pytest.mark.asyncio
async def test_retired_epoch_is_history_even_when_no_live_projection_exists(
    telemetry_session: AsyncSession,
) -> None:
    scope = await _seed_scope(telemetry_session, classification="official")
    epoch_one = await register_epoch_command(
        telemetry_session,
        account=scope["account"],
        command=EpochStartCommand.model_validate(_epoch_command(scope["device"], 0)),
        acknowledged_at=BASE_TIME - timedelta(seconds=10),
    )
    await register_epoch_command(
        telemetry_session,
        account=scope["account"],
        command=EpochStartCommand.model_validate(
            _epoch_command(
                scope["device"],
                expected_version=1,
                expected_previous=str(epoch_one.resource.counterEpoch),
            )
        ),
        acknowledged_at=BASE_TIME - timedelta(seconds=5),
    )

    delayed = await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=TelemetryCommand.model_validate(
            _telemetry_command(
                scope,
                counter_epoch=str(epoch_one.resource.counterEpoch),
                generation=1,
                sequence=1,
                site_entries=1,
            )
        ),
        acknowledged_at=BASE_TIME,
    )

    assert delayed.resource.becameCurrent is False
    assert await telemetry_session.get(SiteLiveState, scope["site"]) is None
    observation = await telemetry_session.get(
        TelemetryObservation, str(delayed.resource.observationId)
    )
    assert observation is not None
    assert observation.became_current is False


@pytest.mark.asyncio
async def test_scope_and_camera_lineage_tampering_rejects_the_whole_command(
    telemetry_session: AsyncSession,
) -> None:
    official = await _seed_scope(telemetry_session, classification="official")
    other = await _seed_scope(telemetry_session, classification="official")
    simulation = await _seed_scope(telemetry_session, classification="simulation")
    epoch = await register_epoch_command(
        telemetry_session,
        account=official["account"],
        command=EpochStartCommand.model_validate(_epoch_command(official["device"], 0)),
        acknowledged_at=BASE_TIME - timedelta(seconds=1),
    )

    wrong_camera = _telemetry_command(
        official,
        counter_epoch=str(epoch.resource.counterEpoch),
        generation=1,
        sequence=1,
        site_entries=1,
    )
    wrong_camera["payload"]["metrics"].append(
        _metric(
            definition="visitor_exits",
            value=1,
            grain="camera",
            camera_id=other["camera"],
        )
    )
    with pytest.raises(TelemetryIntakeError, match="outside the authenticated device"):
        await ingest_telemetry_command(
            telemetry_session,
            account=official["account"],
            command=TelemetryCommand.model_validate(wrong_camera),
            acknowledged_at=BASE_TIME,
        )

    with pytest.raises(TelemetryIntakeError, match="not active topology owned"):
        await register_epoch_command(
            telemetry_session,
            account=official["account"],
            command=EpochStartCommand.model_validate(
                _epoch_command(simulation["device"], expected_version=0)
            ),
            acknowledged_at=BASE_TIME,
        )
    assert (
        await telemetry_session.scalar(select(func.count()).select_from(TelemetryObservation)) == 0
    )


@pytest.mark.asyncio
async def test_official_and_simulation_reads_are_isolated_and_expired_values_are_masked(
    telemetry_session: AsyncSession,
) -> None:
    official = await _seed_scope(telemetry_session, classification="official")
    simulation = await _seed_scope(telemetry_session, classification="simulation")
    for scope, value in ((official, 7), (simulation, 70)):
        epoch = await register_epoch_command(
            telemetry_session,
            account=scope["account"],
            command=EpochStartCommand.model_validate(_epoch_command(scope["device"], 0)),
            acknowledged_at=BASE_TIME - timedelta(seconds=1),
        )
        await ingest_telemetry_command(
            telemetry_session,
            account=scope["account"],
            command=TelemetryCommand.model_validate(
                _telemetry_command(
                    scope,
                    counter_epoch=str(epoch.resource.counterEpoch),
                    generation=1,
                    sequence=1,
                    site_entries=value,
                )
            ),
            acknowledged_at=BASE_TIME,
        )

    official_page = await list_official_live_sites(
        telemetry_session,
        limit=100,
        after_site_id=None,
        evaluated_at=BASE_TIME + timedelta(seconds=10),
    )
    simulation_page = await list_enterprise_live_sites(
        telemetry_session,
        account=simulation["account"],
        limit=10,
        after_site_id=None,
        evaluated_at=BASE_TIME + timedelta(seconds=10),
    )
    stale_page = await list_official_live_sites(
        telemetry_session,
        limit=100,
        after_site_id=None,
        evaluated_at=BASE_TIME + timedelta(minutes=2),
    )
    offline_page = await list_official_live_sites(
        telemetry_session,
        limit=100,
        after_site_id=None,
        evaluated_at=BASE_TIME + timedelta(minutes=6),
    )

    assert [(item.classification, item.entriesWindow) for item in official_page.items] == [
        ("official", 7)
    ]
    assert [(item.classification, item.entriesWindow) for item in simulation_page.items] == [
        ("simulation", 70)
    ]
    assert stale_page.items[0].freshnessState == "stale"
    assert stale_page.items[0].entriesWindow is None
    assert stale_page.items[0].metricQuality == "unknown"
    assert offline_page.items[0].freshnessState == "offline"
    assert offline_page.items[0].serviceState == "unavailable"


async def _seed_scope(db: AsyncSession, *, classification: str) -> Scope:
    suffix = uuid4().hex
    account = Account(
        id=str(uuid4()),
        email=f"telemetry-{suffix}@example.test",
        password_hash="not-used-by-telemetry-test",
        role=AccountRole.ENTERPRISE,
        display_name=f"Telemetry {suffix[:8]}",
        title="Enterprise Operator",
        status=AccountStatus.ACTIVE,
        activated_at=BASE_TIME - timedelta(days=1),
    )
    enterprise_id = str(uuid4())
    site_id = str(uuid4())
    device_id = str(uuid4())
    camera_id = str(uuid4())
    db.add_all(
        [
            account,
            Enterprise(
                id=enterprise_id,
                official_code=f"TEL-{suffix}",
                name=f"Telemetry Enterprise {suffix[:8]}",
                category="Test",
                classification=classification,
                lifecycle_state="active",
            ),
        ]
    )
    await db.flush()
    db.add(
        EnterpriseMembership(
            id=str(uuid4()),
            enterprise_id=enterprise_id,
            account_id=account.id,
            classification=classification,
            membership_role="owner",
            started_at=BASE_TIME - timedelta(days=1),
        )
    )
    db.add(
        EnterpriseSite(
            id=site_id,
            enterprise_id=enterprise_id,
            classification=classification,
            site_code=f"SITE-{suffix}",
            name=f"Site {suffix[:8]}",
            barangay="Test Barangay",
            address="Test Address",
            timezone_name="Asia/Manila",
            building_capacity=100,
            latitude=14.5995,
            longitude=120.9842,
            location_version=1,
            effective_from=BASE_TIME - timedelta(days=1),
        )
    )
    await db.flush()
    db.add(
        EdgeDevice(
            id=device_id,
            site_id=site_id,
            classification=classification,
            device_key=f"device-{suffix}",
            display_name=f"Device {suffix[:8]}",
            lifecycle_state="active",
            counter_epoch=str(uuid4()),
            credential_version=1,
        )
    )
    await db.flush()
    db.add(
        Camera(
            id=camera_id,
            site_id=site_id,
            edge_device_id=device_id,
            classification=classification,
            camera_key=f"camera-{suffix}",
            display_name=f"Camera {suffix[:8]}",
            lifecycle_state="active",
        )
    )
    await db.flush()
    return {
        "account": account,
        "enterprise": enterprise_id,
        "site": site_id,
        "device": device_id,
        "camera": camera_id,
        "classification": classification,
    }


def _epoch_command(
    device_id: str,
    expected_version: int,
    expected_previous: str | None = None,
) -> dict[str, Any]:
    counter_epoch = str(uuid4())
    return {
        "contractVersion": 2,
        "commandId": str(uuid4()),
        "idempotencyKey": f"telemetry-epoch:{device_id}:{counter_epoch}",
        "occurredAt": (BASE_TIME - timedelta(seconds=5)).isoformat(),
        "expectedVersion": expected_version,
        "payload": {
            "deviceId": device_id,
            "counterEpoch": counter_epoch,
            "expectedPreviousEpoch": expected_previous,
        },
    }


def _telemetry_command(
    scope: Scope,
    *,
    counter_epoch: str,
    generation: int,
    sequence: int,
    site_entries: int,
    camera_entries: int | None = None,
) -> dict[str, Any]:
    device_id = scope["device"]
    camera_id = scope["camera"]
    metrics = [_metric("visitor_entries", site_entries, "site")]
    if camera_entries is not None:
        metrics.append(_metric("visitor_entries", camera_entries, "camera", camera_id=camera_id))
    return {
        "contractVersion": 2,
        "commandId": str(uuid4()),
        "idempotencyKey": f"telemetry:{device_id}:{counter_epoch}:{sequence}",
        "occurredAt": BASE_TIME.isoformat(),
        "expectedVersion": generation,
        "payload": {
            "deviceId": device_id,
            "counterEpoch": counter_epoch,
            "epochGeneration": generation,
            "sequence": sequence,
            "observedAt": BASE_TIME.isoformat(),
            "metrics": metrics,
            "deviceHealth": {
                "service": "healthy",
                "cameraStates": [{"cameraId": camera_id, "state": "streaming"}],
                "analyticsFps": 12.5,
            },
            "syncHealth": {
                "evidenceStatus": "recorded",
                "pendingCount": 0,
                "oldestPendingAt": None,
                "lastAcknowledgedAt": (BASE_TIME - timedelta(seconds=3)).isoformat(),
                "lastFailureAt": None,
                "lastFailureClass": None,
            },
        },
    }


def _metric(
    definition: str,
    value: int,
    grain: str,
    camera_id: str | None = None,
) -> dict[str, Any]:
    unit = "crossings"
    return {
        "definition": definition,
        "definitionVersion": 1,
        "value": value,
        "unit": unit,
        "grain": grain,
        "cameraId": camera_id,
        "windowStart": (BASE_TIME - timedelta(seconds=60)).isoformat(),
        "windowEnd": BASE_TIME.isoformat(),
        "timezone": "Asia/Manila",
        "provenance": "camera_derived",
        "quality": "confirmed",
        "coverage": {
            "evidenceStatus": "recorded",
            "monitoredSeconds": 60,
            "expectedSeconds": 60,
            "gapCount": 0,
        },
    }
