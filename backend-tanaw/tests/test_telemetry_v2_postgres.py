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
from app.features.alerts.models import SiteSyncAlertState
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.operational.models import MockDataRun, OperationalAlert
from app.features.operational.service import to_operational_alert_summary
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
    list_enterprise_sites,
    list_official_live_sites,
    list_official_sites,
    register_epoch_command,
)
from app.features.telemetry.simulation import (
    FleetSimulationCommand,
    ingest_simulation_tick,
    list_simulation_enterprises,
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


@pytest.mark.asyncio
async def test_fleet_simulation_uses_sequenced_target_tables_and_is_idempotent(
    telemetry_session: AsyncSession,
) -> None:
    scope = await _seed_scope(telemetry_session, classification="simulation")
    enterprise = await telemetry_session.get(Enterprise, scope["enterprise"])
    site = await telemetry_session.get(EnterpriseSite, scope["site"])
    assert enterprise is not None
    assert site is not None
    site.site_code = "primary"
    await telemetry_session.flush()
    observed_at = datetime.now(UTC)
    command = FleetSimulationCommand.model_validate(
        {
            "contractVersion": 2,
            "runId": "fleet-target-contract",
            "startedAt": observed_at.isoformat(),
            "elapsedSeconds": 0,
            "targets": [
                {
                    "enterpriseId": enterprise.official_code,
                    "lane": "warning",
                    "capacity": 100,
                    "thresholdPercent": 90,
                }
            ],
        }
    )

    first = await ingest_simulation_tick(telemetry_session, command=command)
    replay = await ingest_simulation_tick(telemetry_session, command=command)

    assert first.contractVersion == 2
    assert len(first.observations) == 1
    assert first.observations[0].disposition == "created"
    assert replay.observations[0].disposition == "replayed"
    observation = await telemetry_session.get(
        TelemetryObservation,
        str(first.observations[0].resource.observationId),
    )
    assert observation is not None
    assert observation.classification == "simulation"
    assert observation.ordering_status == "sequenced"
    assert await telemetry_session.scalar(select(func.count()).select_from(OperationalAlert)) == 0
    assert [item.enterpriseId for item in await list_simulation_enterprises(telemetry_session)] == [
        enterprise.official_code
    ]


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
async def test_durable_sync_health_opens_one_alert_and_auto_resolves(
    telemetry_session: AsyncSession,
) -> None:
    scope = await _seed_scope(telemetry_session, classification="official")
    epoch = await register_epoch_command(
        telemetry_session,
        account=scope["account"],
        command=EpochStartCommand.model_validate(_epoch_command(scope["device"], 0)),
        acknowledged_at=BASE_TIME - timedelta(seconds=5),
    )

    healthy_payload = _telemetry_command(
        scope,
        counter_epoch=str(epoch.resource.counterEpoch),
        generation=epoch.resource.epochGeneration,
        sequence=1,
        site_entries=1,
    )
    healthy_payload["payload"]["syncHealth"] = {
        "evidenceStatus": "recorded",
        "pendingCount": 1,
        "oldestPendingAt": (BASE_TIME - timedelta(seconds=10)).isoformat(),
        "lastAcknowledgedAt": (BASE_TIME - timedelta(seconds=3)).isoformat(),
        "lastFailureAt": None,
        "lastFailureClass": None,
    }
    await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=TelemetryCommand.model_validate(healthy_payload),
        acknowledged_at=BASE_TIME + timedelta(seconds=1),
    )
    assert await telemetry_session.scalar(select(func.count(SiteSyncAlertState.id))) == 0

    delayed_payload = _telemetry_command(
        scope,
        counter_epoch=str(epoch.resource.counterEpoch),
        generation=epoch.resource.epochGeneration,
        sequence=2,
        site_entries=2,
    )
    delayed_payload["payload"]["syncHealth"] = {
        "evidenceStatus": "recorded",
        "pendingCount": 10,
        "oldestPendingAt": (BASE_TIME - timedelta(seconds=301)).isoformat(),
        "lastAcknowledgedAt": (BASE_TIME - timedelta(seconds=3)).isoformat(),
        "lastFailureAt": BASE_TIME.isoformat(),
        "lastFailureClass": "network_unavailable",
    }
    await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=TelemetryCommand.model_validate(delayed_payload),
        acknowledged_at=BASE_TIME + timedelta(seconds=2),
    )
    state = await telemetry_session.scalar(select(SiteSyncAlertState))
    assert state is not None
    assert state.status == "active"
    alert = await telemetry_session.get(OperationalAlert, state.operational_alert_id)
    assert alert is not None
    assert alert.status == "New"
    alert_summary = to_operational_alert_summary(alert)
    assert alert_summary.type == "Sync Delay"
    assert alert_summary.resolutionMode == "Automatic Health Recovery"

    repeated_payload = _telemetry_command(
        scope,
        counter_epoch=str(epoch.resource.counterEpoch),
        generation=epoch.resource.epochGeneration,
        sequence=3,
        site_entries=3,
    )
    repeated_payload["payload"]["syncHealth"] = delayed_payload["payload"]["syncHealth"]
    await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=TelemetryCommand.model_validate(repeated_payload),
        acknowledged_at=BASE_TIME + timedelta(seconds=3),
    )
    assert await telemetry_session.scalar(select(func.count(SiteSyncAlertState.id))) == 1
    assert (
        await telemetry_session.scalar(
            select(func.count(OperationalAlert.id)).where(
                OperationalAlert.source_id == f"sync-health:{scope['site']}"
            )
        )
        == 1
    )

    recovered_payload = _telemetry_command(
        scope,
        counter_epoch=str(epoch.resource.counterEpoch),
        generation=epoch.resource.epochGeneration,
        sequence=4,
        site_entries=4,
    )
    await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=TelemetryCommand.model_validate(recovered_payload),
        acknowledged_at=BASE_TIME + timedelta(seconds=4),
    )
    await telemetry_session.refresh(state)
    await telemetry_session.refresh(alert)
    assert state.status == "resolved"
    assert state.resolved_at == BASE_TIME + timedelta(seconds=4)
    assert alert.status == "Resolved"
    transitions = list(
        await telemetry_session.scalars(
            select(DomainEvent.event_type)
            .where(DomainEvent.aggregate_type == "site_sync_health")
            .order_by(DomainEvent.aggregate_version)
        )
    )
    assert transitions == [
        "sync_health.alert_opened",
        "sync_health.alert_resolved",
    ]

    stale_payload = _telemetry_command(
        scope,
        counter_epoch=str(epoch.resource.counterEpoch),
        generation=epoch.resource.epochGeneration,
        sequence=5,
        site_entries=5,
    )
    stale_payload["payload"]["observedAt"] = (BASE_TIME - timedelta(minutes=10)).isoformat()
    stale_payload["payload"]["metrics"] = []
    stale_payload["payload"]["syncHealth"] = delayed_payload["payload"]["syncHealth"]
    acknowledgement = await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=TelemetryCommand.model_validate(stale_payload),
        acknowledged_at=BASE_TIME + timedelta(seconds=5),
    )
    await telemetry_session.refresh(state)
    assert acknowledgement.resource.becameCurrent is False
    assert state.status == "resolved"


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


@pytest.mark.asyncio
async def test_site_registry_keeps_unlinked_sites_and_nests_freshness_safe_live_state(
    telemetry_session: AsyncSession,
) -> None:
    scope = await _seed_scope(telemetry_session, classification="official")
    unlinked_site_id = str(uuid4())
    telemetry_session.add(
        EnterpriseSite(
            id=unlinked_site_id,
            enterprise_id=scope["enterprise"],
            classification="official",
            site_code=f"UNLINKED-{uuid4().hex}",
            name="Unlinked Site",
            barangay="Test Barangay",
            address="No device yet",
            timezone_name="Asia/Manila",
            building_capacity=50,
            latitude=14.6,
            longitude=120.99,
            location_version=1,
            effective_from=BASE_TIME - timedelta(days=1),
        )
    )
    await telemetry_session.flush()

    before = await list_official_sites(
        telemetry_session,
        limit=10,
        after_site_id=None,
        evaluated_at=BASE_TIME,
    )
    linked_before = next(item for item in before.items if str(item.siteId) == scope["site"])
    unlinked = next(item for item in before.items if str(item.siteId) == unlinked_site_id)
    assert linked_before.topologyStatus == "ready"
    assert len(linked_before.devices) == 1
    assert [str(camera.cameraId) for camera in linked_before.devices[0].cameras] == [
        scope["camera"]
    ]
    assert linked_before.liveState is None
    assert unlinked.topologyStatus == "unlinked"
    assert unlinked.devices == []
    assert unlinked.liveState is None

    epoch = await register_epoch_command(
        telemetry_session,
        account=scope["account"],
        command=EpochStartCommand.model_validate(_epoch_command(scope["device"], 0)),
        acknowledged_at=BASE_TIME - timedelta(seconds=5),
    )
    await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=TelemetryCommand.model_validate(
            _telemetry_command(
                scope,
                counter_epoch=str(epoch.resource.counterEpoch),
                generation=epoch.resource.epochGeneration,
                sequence=1,
                site_entries=8,
            )
        ),
        acknowledged_at=BASE_TIME + timedelta(seconds=1),
    )

    fresh = await list_official_sites(
        telemetry_session,
        limit=10,
        after_site_id=None,
        evaluated_at=BASE_TIME + timedelta(seconds=2),
    )
    fresh_linked = next(item for item in fresh.items if str(item.siteId) == scope["site"])
    assert fresh_linked.liveState is not None
    assert fresh_linked.liveState.freshnessState == "fresh"
    assert fresh_linked.liveState.entriesWindow == 8

    offline = await list_official_sites(
        telemetry_session,
        limit=10,
        after_site_id=None,
        evaluated_at=BASE_TIME + timedelta(minutes=6),
    )
    offline_linked = next(item for item in offline.items if str(item.siteId) == scope["site"])
    assert offline_linked.liveState is not None
    assert offline_linked.liveState.freshnessState == "offline"
    assert offline_linked.liveState.entriesWindow is None
    assert offline_linked.liveState.syncHealth.pendingCount is None


@pytest.mark.asyncio
async def test_future_membership_cannot_discover_register_or_submit_telemetry(
    telemetry_session: AsyncSession,
) -> None:
    scope = await _seed_scope(telemetry_session, classification="official")
    membership = await telemetry_session.scalar(
        select(EnterpriseMembership).where(EnterpriseMembership.account_id == scope["account"].id)
    )
    assert membership is not None

    epoch = await register_epoch_command(
        telemetry_session,
        account=scope["account"],
        command=EpochStartCommand.model_validate(_epoch_command(scope["device"], 0)),
        acknowledged_at=BASE_TIME - timedelta(minutes=1),
    )
    membership.started_at = BASE_TIME + timedelta(minutes=1)
    await telemetry_session.flush([membership])

    with pytest.raises(TelemetryIntakeError, match="effective at the server evaluation time"):
        await list_enterprise_sites(
            telemetry_session,
            account=scope["account"],
            limit=10,
            after_site_id=None,
            evaluated_at=BASE_TIME,
        )
    with pytest.raises(TelemetryIntakeError, match="effective at the server evaluation time"):
        await register_epoch_command(
            telemetry_session,
            account=scope["account"],
            command=EpochStartCommand.model_validate(
                _epoch_command(
                    scope["device"],
                    expected_version=1,
                    expected_previous=str(epoch.resource.counterEpoch),
                )
            ),
            acknowledged_at=BASE_TIME,
        )
    with pytest.raises(TelemetryIntakeError, match="effective at the server evaluation time"):
        await ingest_telemetry_command(
            telemetry_session,
            account=scope["account"],
            command=TelemetryCommand.model_validate(
                _telemetry_command(
                    scope,
                    counter_epoch=str(epoch.resource.counterEpoch),
                    generation=epoch.resource.epochGeneration,
                    sequence=1,
                    site_entries=1,
                )
            ),
            acknowledged_at=BASE_TIME,
        )


@pytest.mark.asyncio
async def test_bounded_effective_membership_can_discover_register_and_submit_telemetry(
    telemetry_session: AsyncSession,
) -> None:
    scope = await _seed_scope(telemetry_session, classification="official")
    membership = await telemetry_session.scalar(
        select(EnterpriseMembership).where(EnterpriseMembership.account_id == scope["account"].id)
    )
    assert membership is not None
    membership.ended_at = BASE_TIME + timedelta(minutes=1)
    await telemetry_session.flush([membership])

    sites = await list_enterprise_sites(
        telemetry_session,
        account=scope["account"],
        limit=10,
        after_site_id=None,
        evaluated_at=BASE_TIME,
    )
    assert [str(item.siteId) for item in sites.items] == [scope["site"]]

    epoch = await register_epoch_command(
        telemetry_session,
        account=scope["account"],
        command=EpochStartCommand.model_validate(_epoch_command(scope["device"], 0)),
        acknowledged_at=BASE_TIME,
    )
    acknowledgement = await ingest_telemetry_command(
        telemetry_session,
        account=scope["account"],
        command=TelemetryCommand.model_validate(
            _telemetry_command(
                scope,
                counter_epoch=str(epoch.resource.counterEpoch),
                generation=epoch.resource.epochGeneration,
                sequence=1,
                site_entries=2,
            )
        ),
        acknowledged_at=BASE_TIME + timedelta(seconds=1),
    )
    live = await list_enterprise_live_sites(
        telemetry_session,
        account=scope["account"],
        limit=10,
        after_site_id=None,
        evaluated_at=BASE_TIME + timedelta(seconds=2),
    )

    assert acknowledgement.disposition == "created"
    assert acknowledgement.resource.becameCurrent is True
    assert [(str(item.siteId), item.entriesWindow) for item in live.items] == [(scope["site"], 2)]


@pytest.mark.asyncio
async def test_ended_membership_and_inactive_enterprise_fail_closed(
    telemetry_session: AsyncSession,
) -> None:
    ended_scope = await _seed_scope(telemetry_session, classification="official")
    ended_membership = await telemetry_session.scalar(
        select(EnterpriseMembership).where(
            EnterpriseMembership.account_id == ended_scope["account"].id
        )
    )
    assert ended_membership is not None
    ended_membership.ended_at = BASE_TIME

    inactive_scope = await _seed_scope(telemetry_session, classification="official")
    inactive_enterprise = await telemetry_session.get(Enterprise, inactive_scope["enterprise"])
    assert inactive_enterprise is not None
    inactive_enterprise.lifecycle_state = "inactive"
    await telemetry_session.flush([ended_membership, inactive_enterprise])

    with pytest.raises(TelemetryIntakeError, match="effective at the server evaluation time"):
        await list_enterprise_live_sites(
            telemetry_session,
            account=ended_scope["account"],
            limit=10,
            after_site_id=None,
            evaluated_at=BASE_TIME,
        )
    with pytest.raises(TelemetryIntakeError, match="classification-matching active enterprise"):
        await list_enterprise_sites(
            telemetry_session,
            account=inactive_scope["account"],
            limit=10,
            after_site_id=None,
            evaluated_at=BASE_TIME,
        )
    with pytest.raises(TelemetryIntakeError, match="classification-matching active enterprise"):
        await register_epoch_command(
            telemetry_session,
            account=inactive_scope["account"],
            command=EpochStartCommand.model_validate(_epoch_command(inactive_scope["device"], 0)),
            acknowledged_at=BASE_TIME,
        )


@pytest.mark.asyncio
async def test_ambiguous_membership_and_invalid_site_device_scope_fail_closed(
    telemetry_session: AsyncSession,
) -> None:
    ambiguous = await _seed_scope(telemetry_session, classification="official")
    first_membership = await telemetry_session.scalar(
        select(EnterpriseMembership).where(
            EnterpriseMembership.account_id == ambiguous["account"].id
        )
    )
    assert first_membership is not None
    first_membership.ended_at = BASE_TIME + timedelta(days=1)
    second_enterprise_id = str(uuid4())
    telemetry_session.add(
        Enterprise(
            id=second_enterprise_id,
            official_code=f"AMB-{uuid4().hex}",
            name="Second effective enterprise",
            classification="official",
            lifecycle_state="active",
        )
    )
    await telemetry_session.flush()
    telemetry_session.add(
        EnterpriseMembership(
            id=str(uuid4()),
            enterprise_id=second_enterprise_id,
            account_id=ambiguous["account"].id,
            classification="official",
            membership_role="manager",
            started_at=BASE_TIME - timedelta(days=1),
            ended_at=BASE_TIME + timedelta(days=2),
        )
    )

    future_site = await _seed_scope(telemetry_session, classification="official")
    future_site_epoch = await register_epoch_command(
        telemetry_session,
        account=future_site["account"],
        command=EpochStartCommand.model_validate(_epoch_command(future_site["device"], 0)),
        acknowledged_at=BASE_TIME - timedelta(seconds=2),
    )
    await ingest_telemetry_command(
        telemetry_session,
        account=future_site["account"],
        command=TelemetryCommand.model_validate(
            _telemetry_command(
                future_site,
                counter_epoch=str(future_site_epoch.resource.counterEpoch),
                generation=future_site_epoch.resource.epochGeneration,
                sequence=1,
                site_entries=3,
            )
        ),
        acknowledged_at=BASE_TIME - timedelta(seconds=1),
    )
    future_site_row = await telemetry_session.get(EnterpriseSite, future_site["site"])
    assert future_site_row is not None
    future_site_row.effective_from = BASE_TIME + timedelta(seconds=1)

    retired_device = await _seed_scope(telemetry_session, classification="official")
    retired_epoch = await register_epoch_command(
        telemetry_session,
        account=retired_device["account"],
        command=EpochStartCommand.model_validate(_epoch_command(retired_device["device"], 0)),
        acknowledged_at=BASE_TIME - timedelta(seconds=2),
    )
    await ingest_telemetry_command(
        telemetry_session,
        account=retired_device["account"],
        command=TelemetryCommand.model_validate(
            _telemetry_command(
                retired_device,
                counter_epoch=str(retired_epoch.resource.counterEpoch),
                generation=retired_epoch.resource.epochGeneration,
                sequence=1,
                site_entries=4,
            )
        ),
        acknowledged_at=BASE_TIME - timedelta(seconds=1),
    )
    retired_device_row = await telemetry_session.get(EdgeDevice, retired_device["device"])
    assert retired_device_row is not None
    retired_device_row.lifecycle_state = "retired"
    await telemetry_session.flush()

    with pytest.raises(TelemetryIntakeError, match="exactly one enterprise membership"):
        await list_enterprise_sites(
            telemetry_session,
            account=ambiguous["account"],
            limit=10,
            after_site_id=None,
            evaluated_at=BASE_TIME,
        )
    for scope in (future_site, retired_device):
        with pytest.raises(TelemetryIntakeError, match="not active topology owned"):
            await register_epoch_command(
                telemetry_session,
                account=scope["account"],
                command=EpochStartCommand.model_validate(_epoch_command(scope["device"], 0)),
                acknowledged_at=BASE_TIME,
            )

    future_sites = await list_enterprise_sites(
        telemetry_session,
        account=future_site["account"],
        limit=10,
        after_site_id=None,
        evaluated_at=BASE_TIME,
    )
    retired_sites = await list_enterprise_sites(
        telemetry_session,
        account=retired_device["account"],
        limit=10,
        after_site_id=None,
        evaluated_at=BASE_TIME,
    )
    assert future_sites.items == []
    assert len(retired_sites.items) == 1
    assert retired_sites.items[0].topologyStatus == "unlinked"
    assert retired_sites.items[0].liveState is None
    future_live = await list_enterprise_live_sites(
        telemetry_session,
        account=future_site["account"],
        limit=10,
        after_site_id=None,
        evaluated_at=BASE_TIME,
    )
    retired_live = await list_enterprise_live_sites(
        telemetry_session,
        account=retired_device["account"],
        limit=10,
        after_site_id=None,
        evaluated_at=BASE_TIME,
    )
    assert future_live.items == []
    assert retired_live.items == []


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
    simulation_run = (
        MockDataRun(
            id=str(uuid4()),
            scenario="telemetry-scope-test",
            seed=suffix,
            range_start=BASE_TIME - timedelta(days=1),
            range_end=BASE_TIME,
            status="active",
        )
        if classification == "simulation"
        else None
    )
    db.add_all(
        [
            account,
            *([simulation_run] if simulation_run is not None else []),
            Enterprise(
                id=enterprise_id,
                official_code=f"TEL-{suffix}",
                name=f"Telemetry Enterprise {suffix[:8]}",
                category="Test",
                classification=classification,
                simulation_run_id=(simulation_run.id if simulation_run is not None else None),
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
