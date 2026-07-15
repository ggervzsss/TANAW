import asyncio
import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings
from app.features.maintenance.telemetry_retention import run_telemetry_retention
from app.features.simulation.models import SimulationRun
from app.features.telemetry.models import (
    DeviceHealthSample,
    DeviceTelemetryEpoch,
    SiteLiveState,
    SiteTelemetryHourlyRollup,
    TelemetryMetricFact,
    TelemetryObservation,
)
from app.features.topology.models import (
    EdgeDevice,
    Enterprise,
    EnterpriseSite,
    SiteLocationVersion,
)

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
TEST_PREFIX = "tanaw-telemetry-retention-"
_HASH = f"sha256:{'a' * 64}"


@dataclass
class PostgresRuntime:
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    settings: Settings
    enterprise_ids: list[str] = field(default_factory=list)
    simulation_run_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Scope:
    enterprise_id: str
    site_id: str
    device_id: str
    epoch_id: str
    classification: str


@dataclass(frozen=True)
class ObservationIds:
    observation_id: str
    fact_id: str
    health_id: str


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
async def postgres_runtime() -> AsyncIterator[PostgresRuntime]:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")
    database_url = _postgres_async_url(raw_url)
    engine = create_async_engine(database_url, pool_pre_ping=True)
    runtime = PostgresRuntime(
        engine=engine,
        sessions=async_sessionmaker(engine, expire_on_commit=False),
        settings=Settings(
            environment="development",
            database_url=database_url,
            retention_cleanup_batch_size=10,
            telemetry_downsample_settle_seconds=60,
            telemetry_raw_observation_retention_days=14,
            telemetry_metric_fact_retention_days=7,
            telemetry_device_health_retention_days=7,
            telemetry_hourly_rollup_retention_days=730,
        ),
    )
    try:
        yield runtime
    finally:
        await _clean_runtime(runtime)
        await engine.dispose()


@pytest.mark.asyncio
async def test_downsampling_is_idempotent_concurrent_late_safe_and_classification_isolated(
    postgres_runtime: PostgresRuntime,
) -> None:
    now = datetime(2026, 7, 13, 12, tzinfo=UTC)
    bucket = now.replace(hour=9)
    official = await _seed_scope(postgres_runtime, classification="official")
    simulation = await _seed_scope(postgres_runtime, classification="simulation")

    for sequence in range(12):
        await _add_observation(
            postgres_runtime,
            scope=official,
            sequence=sequence,
            observed_at=bucket + timedelta(minutes=sequence),
            received_at=now - timedelta(hours=2) + timedelta(seconds=sequence),
            value=None if sequence == 11 else Decimal(sequence + 1),
            quality="unknown" if sequence == 11 else "confirmed",
        )
    for sequence in range(8):
        await _add_observation(
            postgres_runtime,
            scope=simulation,
            sequence=sequence,
            observed_at=bucket + timedelta(minutes=sequence),
            received_at=now - timedelta(hours=2) + timedelta(seconds=sequence),
            value=Decimal(100 + sequence),
            quality="estimated",
        )

    worker_results = await asyncio.gather(
        run_telemetry_retention(
            postgres_runtime.settings,
            now=now,
            session_factory=postgres_runtime.sessions,
        ),
        run_telemetry_retention(
            postgres_runtime.settings,
            now=now,
            session_factory=postgres_runtime.sessions,
        ),
    )
    assert sum(result.observations_downsampled for result in worker_results) == 20
    assert sum(result.metric_facts_rolled_up for result in worker_results) == 20

    official_rollup = await _rollup(postgres_runtime, official)
    simulation_rollup = await _rollup(postgres_runtime, simulation)
    assert official_rollup.sample_count == 12
    assert official_rollup.known_sample_count == 11
    assert official_rollup.unknown_sample_count == 1
    assert official_rollup.value_sum == Decimal("66.000000")
    assert official_rollup.last_quality == "unknown"
    assert official_rollup.last_value is None
    assert simulation_rollup.sample_count == 8
    assert simulation_rollup.known_sample_count == 8
    assert simulation_rollup.value_sum == Decimal("828.000000")

    replay = await run_telemetry_retention(
        postgres_runtime.settings,
        now=now,
        session_factory=postgres_runtime.sessions,
    )
    assert replay.observations_downsampled == 0
    assert replay.metric_facts_rolled_up == 0

    await _add_observation(
        postgres_runtime,
        scope=official,
        sequence=100,
        observed_at=bucket + timedelta(minutes=5, seconds=30),
        received_at=now - timedelta(minutes=2),
        value=Decimal(100),
        quality="confirmed",
    )
    late = await run_telemetry_retention(
        postgres_runtime.settings,
        now=now,
        session_factory=postgres_runtime.sessions,
    )
    assert late.observations_downsampled == 1
    assert late.metric_facts_rolled_up == 1
    assert late.observability.official.unprocessed_observations == 0
    assert late.observability.official.ingestion_lag_seconds == 120

    merged = await _rollup(postgres_runtime, official)
    assert merged.sample_count == 13
    assert merged.value_sum == Decimal("166.000000")
    assert merged.last_quality == "unknown"
    assert merged.last_value is None


@pytest.mark.asyncio
async def test_retention_preserves_live_observation_and_requires_detail_expiry_first(
    postgres_runtime: PostgresRuntime,
) -> None:
    now = datetime(2026, 7, 13, 12, tzinfo=UTC)
    scope = await _seed_scope(postgres_runtime, classification="official")
    base = now - timedelta(days=20)
    observations = [
        await _add_observation(
            postgres_runtime,
            scope=scope,
            sequence=sequence,
            observed_at=base + timedelta(minutes=sequence),
            received_at=base + timedelta(minutes=sequence, seconds=5),
            value=Decimal(sequence + 1),
            quality="confirmed",
            became_current=sequence == 2,
        )
        for sequence in range(3)
    ]
    null_expiry = await _add_observation(
        postgres_runtime,
        scope=scope,
        sequence=3,
        observed_at=base + timedelta(minutes=3),
        received_at=base + timedelta(minutes=3, seconds=5),
        value=Decimal(4),
        quality="confirmed",
        null_retention=True,
    )
    await _add_offline_live_state(
        postgres_runtime,
        scope=scope,
        observation_id=observations[-1].observation_id,
        sequence=2,
        observed_at=base + timedelta(minutes=2),
        received_at=base + timedelta(minutes=2, seconds=5),
    )

    counts = await run_telemetry_retention(
        postgres_runtime.settings,
        now=now,
        session_factory=postgres_runtime.sessions,
    )
    assert counts.observations_downsampled == 4
    assert counts.metric_facts_deleted == 3
    assert counts.device_health_samples_deleted == 3
    assert counts.observations_deleted == 2

    async with postgres_runtime.sessions() as db:
        assert await db.get(TelemetryObservation, observations[0].observation_id) is None
        assert await db.get(TelemetryObservation, observations[1].observation_id) is None
        assert await db.get(TelemetryObservation, observations[2].observation_id) is not None
        assert await db.get(TelemetryObservation, null_expiry.observation_id) is not None
        assert await db.get(TelemetryMetricFact, null_expiry.fact_id) is not None
        assert await db.get(DeviceHealthSample, null_expiry.health_id) is not None
        live = await db.get(SiteLiveState, scope.site_id)
        assert live is not None
        assert live.telemetry_observation_id == observations[2].observation_id

    cascade_source = await _add_observation(
        postgres_runtime,
        scope=scope,
        sequence=20,
        observed_at=now - timedelta(minutes=10),
        received_at=now - timedelta(minutes=9),
        value=Decimal(9),
        quality="degraded",
    )
    async with postgres_runtime.sessions() as db:
        with pytest.raises(DBAPIError, match="must be downsampled before deletion"):
            await db.execute(
                delete(TelemetryObservation).where(
                    TelemetryObservation.id == cascade_source.observation_id
                )
            )
            await db.commit()
        await db.rollback()

    await run_telemetry_retention(
        postgres_runtime.settings,
        now=now,
        session_factory=postgres_runtime.sessions,
    )
    async with postgres_runtime.sessions() as db:
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(
                text(
                    "UPDATE telemetry_observations "
                    "SET downsampled_at = downsampled_at + INTERVAL '1 second' "
                    "WHERE id = :observation_id"
                ),
                {"observation_id": cascade_source.observation_id},
            )
            await db.commit()
        await db.rollback()
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(
                text(
                    "UPDATE telemetry_observations SET downsampled_at = NULL "
                    "WHERE id = :observation_id"
                ),
                {"observation_id": cascade_source.observation_id},
            )
            await db.commit()
        await db.rollback()
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(
                text(
                    "UPDATE telemetry_observations "
                    "SET observed_at = observed_at - INTERVAL '1 second' "
                    "WHERE id = :observation_id"
                ),
                {"observation_id": cascade_source.observation_id},
            )
            await db.commit()
        await db.rollback()
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(
                text("UPDATE telemetry_metric_facts SET value = value + 1 WHERE id = :fact_id"),
                {"fact_id": cascade_source.fact_id},
            )
            await db.commit()
        await db.rollback()
        with pytest.raises(DBAPIError, match="detail must expire before deletion"):
            await db.execute(
                delete(TelemetryObservation).where(
                    TelemetryObservation.id == cascade_source.observation_id
                )
            )
            await db.commit()
        await db.rollback()
        assert await db.get(TelemetryMetricFact, cascade_source.fact_id) is not None
        assert await db.get(DeviceHealthSample, cascade_source.health_id) is not None
        await db.execute(
            delete(TelemetryMetricFact).where(TelemetryMetricFact.id == cascade_source.fact_id)
        )
        await db.execute(
            delete(DeviceHealthSample).where(DeviceHealthSample.id == cascade_source.health_id)
        )
        await db.execute(
            delete(TelemetryObservation).where(
                TelemetryObservation.id == cascade_source.observation_id
            )
        )
        await db.commit()
    async with postgres_runtime.sessions() as db:
        assert await db.get(TelemetryMetricFact, cascade_source.fact_id) is None
        assert await db.get(DeviceHealthSample, cascade_source.health_id) is None


@pytest.mark.asyncio
async def test_dynamic_utc_partitions_prune_queries_and_expire_only_as_whole_months(
    postgres_runtime: PostgresRuntime,
) -> None:
    scope = await _seed_scope(postgres_runtime, classification="official")
    january = datetime(2024, 1, 10, 8, 15, tzinfo=UTC)
    february = datetime(2024, 2, 10, 8, 15, tzinfo=UTC)
    await _add_observation(
        postgres_runtime,
        scope=scope,
        sequence=1,
        observed_at=january,
        received_at=january + timedelta(minutes=1),
        value=Decimal(5),
        quality="confirmed",
    )
    await _add_observation(
        postgres_runtime,
        scope=scope,
        sequence=2,
        observed_at=february,
        received_at=february + timedelta(minutes=1),
        value=Decimal(7),
        quality="confirmed",
    )
    initial_settings = postgres_runtime.settings.model_copy(
        update={"telemetry_hourly_rollup_retention_days": 400}
    )
    await run_telemetry_retention(
        initial_settings,
        now=datetime(2024, 2, 11, tzinfo=UTC),
        session_factory=postgres_runtime.sessions,
    )

    async with postgres_runtime.sessions() as db:
        parent_kind = await db.scalar(
            text(
                "SELECT relkind::text FROM pg_class "
                "WHERE oid = 'site_telemetry_hourly_rollups'::regclass"
            )
        )
        assert parent_kind == "p"
        cascade_rows = (
            await db.execute(
                text(
                    """
                    SELECT conname, confdeltype::text
                    FROM pg_constraint
                    WHERE conname IN (
                        'fk_telemetry_metric_facts_observation_scope',
                        'fk_device_health_samples_observation_scope'
                    )
                    """
                )
            )
        ).all()
        cascade_constraints: dict[str, str] = {
            str(row.conname): str(row.confdeltype) for row in cascade_rows
        }
        assert cascade_constraints == {
            "fk_device_health_samples_observation_scope": "c",
            "fk_telemetry_metric_facts_observation_scope": "c",
        }
        partitions = set(
            await db.scalars(
                text(
                    """
                    SELECT child.relname
                    FROM pg_inherits
                    JOIN pg_class AS parent ON parent.oid = inhparent
                    JOIN pg_class AS child ON child.oid = inhrelid
                    WHERE parent.relname = 'site_telemetry_hourly_rollups'
                    """
                )
            )
        )
        assert "site_telemetry_hourly_rollups_202401" in partitions
        assert "site_telemetry_hourly_rollups_202402" in partitions
        registry = (
            await db.execute(
                text(
                    """
                    SELECT partition_name, range_start, range_end
                    FROM site_telemetry_rollup_partitions
                    WHERE partition_name IN (
                        'site_telemetry_hourly_rollups_202401',
                        'site_telemetry_hourly_rollups_202402'
                    )
                    ORDER BY partition_name
                    """
                )
            )
        ).all()
        assert [(row.range_start.tzinfo, row.range_end.tzinfo) for row in registry]
        assert all(row.range_start.utcoffset() == timedelta(0) for row in registry)
        assert all(row.range_end.utcoffset() == timedelta(0) for row in registry)

        await db.execute(text("SET LOCAL TIME ZONE 'America/New_York'"))
        utc_bounds = (
            await db.execute(
                text(
                    """
                    SELECT
                        partition_name,
                        to_char(range_start AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
                        to_char(range_end AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
                    FROM site_telemetry_rollup_partitions
                    WHERE partition_name IN (
                        'site_telemetry_hourly_rollups_202401',
                        'site_telemetry_hourly_rollups_202402'
                    )
                    ORDER BY partition_name
                    """
                )
            )
        ).all()
        assert utc_bounds == [
            (
                "site_telemetry_hourly_rollups_202401",
                "2024-01-01 00:00:00",
                "2024-02-01 00:00:00",
            ),
            (
                "site_telemetry_hourly_rollups_202402",
                "2024-02-01 00:00:00",
                "2024-03-01 00:00:00",
            ),
        ]

        await db.execute(text("SET LOCAL enable_seqscan = off"))
        plan = await db.scalar(
            text(
                """
                EXPLAIN (FORMAT JSON)
                SELECT definition, sample_count
                FROM site_telemetry_hourly_rollups
                WHERE site_id = :site_id
                  AND classification = 'official'
                  AND bucket_start >= '2024-02-01T00:00:00+00:00'::timestamptz
                  AND bucket_start < '2024-03-01T00:00:00+00:00'::timestamptz
                ORDER BY bucket_start DESC
                LIMIT 50
                """
            ),
            {"site_id": scope.site_id},
        )
        rendered_plan = json.dumps(plan)
        assert "site_telemetry_hourly_rollups_202402" in rendered_plan
        assert "site_telemetry_hourly_rollups_202401" not in rendered_plan
        assert "Index Scan" in rendered_plan
        await db.rollback()

    expiry_settings = postgres_runtime.settings.model_copy(
        update={"telemetry_hourly_rollup_retention_days": 30}
    )
    expired = await run_telemetry_retention(
        expiry_settings,
        now=datetime(2024, 3, 15, tzinfo=UTC),
        session_factory=postgres_runtime.sessions,
    )
    assert expired.rollup_partitions_dropped == 1
    assert expired.hourly_rollups_deleted >= 1
    async with postgres_runtime.sessions() as db:
        assert (
            await db.scalar(text("SELECT to_regclass('site_telemetry_hourly_rollups_202401')"))
            is None
        )
        assert (
            await db.scalar(text("SELECT to_regclass('site_telemetry_hourly_rollups_202402')"))
            is not None
        )
        february_count = await db.scalar(
            select(SiteTelemetryHourlyRollup).where(
                SiteTelemetryHourlyRollup.site_id == scope.site_id,
                SiteTelemetryHourlyRollup.bucket_start >= datetime(2024, 2, 1, tzinfo=UTC),
                SiteTelemetryHourlyRollup.bucket_start < datetime(2024, 3, 1, tzinfo=UTC),
            )
        )
        assert february_count is not None


async def _seed_scope(runtime: PostgresRuntime, *, classification: str) -> Scope:
    async with runtime.sessions() as db:
        simulation_run = (
            SimulationRun(
                id=str(uuid4()),
                scenario="telemetry-retention-scope-test",
                seed=uuid4().hex,
                range_start=datetime(2020, 1, 1, tzinfo=UTC),
                range_end=datetime(2030, 1, 1, tzinfo=UTC),
                status="active",
            )
            if classification == "simulation"
            else None
        )
        if simulation_run is not None:
            db.add(simulation_run)
            await db.flush()
            runtime.simulation_run_ids.append(simulation_run.id)
        enterprise = Enterprise(
            official_code=f"{TEST_PREFIX}{uuid4().hex[:12]}",
            name="Telemetry retention test",
            classification=classification,
            simulation_run_id=simulation_run.id if simulation_run is not None else None,
            lifecycle_state="active",
        )
        db.add(enterprise)
        await db.flush()
        site = EnterpriseSite(
            id=str(uuid4()),
            enterprise_id=enterprise.id,
            classification=classification,
            site_code=f"site-{uuid4().hex[:8]}",
            name="Retention test site",
            registered_at=datetime(2020, 1, 1, tzinfo=UTC),
        )
        location = SiteLocationVersion(
            site_id=site.id,
            classification=classification,
            version=1,
            timezone_name="Asia/Manila",
            building_capacity=100,
            effective_from=datetime(2020, 1, 1, tzinfo=UTC),
            change_reason="test_fixture",
        )
        db.add_all([site, location])
        await db.flush()
        device = EdgeDevice(
            site_id=site.id,
            classification=classification,
            device_key=f"device-{uuid4().hex[:12]}",
            display_name="Retention test device",
        )
        db.add(device)
        await db.flush()
        registered_at = datetime(2020, 1, 1, tzinfo=UTC)
        epoch = DeviceTelemetryEpoch(
            edge_device_id=device.id,
            site_id=site.id,
            classification=classification,
            counter_epoch=str(uuid4()),
            generation=1,
            command_id=str(uuid4()),
            idempotency_key=f"epoch:{device.id}",
            payload_hash=_HASH,
            status="active",
            registered_at=registered_at,
        )
        db.add(epoch)
        await db.commit()
        runtime.enterprise_ids.append(enterprise.id)
        return Scope(
            enterprise_id=enterprise.id,
            site_id=site.id,
            device_id=device.id,
            epoch_id=epoch.id,
            classification=classification,
        )


async def _add_observation(
    runtime: PostgresRuntime,
    *,
    scope: Scope,
    sequence: int,
    observed_at: datetime,
    received_at: datetime,
    value: Decimal | None,
    quality: str,
    null_retention: bool = False,
    became_current: bool = False,
) -> ObservationIds:
    async with runtime.sessions() as db:
        observation = TelemetryObservation(
            enterprise_id=scope.enterprise_id,
            site_id=scope.site_id,
            edge_device_id=scope.device_id,
            classification=scope.classification,
            telemetry_epoch_id=scope.epoch_id,
            epoch_generation=1,
            sequence=sequence,
            command_id=str(uuid4()),
            idempotency_key=f"telemetry:{scope.device_id}:{sequence}",
            payload_hash=_HASH,
            observed_at=observed_at,
            received_at=received_at,
            became_current=became_current,
            retention_expires_at=(None if null_retention else received_at + timedelta(days=14)),
        )
        db.add(observation)
        await db.flush()
        fact = TelemetryMetricFact(
            telemetry_observation_id=observation.id,
            enterprise_id=scope.enterprise_id,
            site_id=scope.site_id,
            classification=scope.classification,
            fact_status="qualified",
            definition="entries_window",
            definition_version=1,
            value=value,
            unit="people",
            grain="site",
            metric_window_start=observed_at - timedelta(minutes=1),
            metric_window_end=observed_at,
            timezone_name="Asia/Manila",
            provenance="camera_derived",
            quality=quality,
            coverage_evidence_status="recorded",
            monitored_seconds=55,
            expected_seconds=60,
            coverage_gap_count=1,
            retention_expires_at=(None if null_retention else received_at + timedelta(days=7)),
        )
        health = DeviceHealthSample(
            telemetry_observation_id=observation.id,
            edge_device_id=scope.device_id,
            site_id=scope.site_id,
            classification=scope.classification,
            observed_at=observed_at,
            received_at=received_at,
            service_state="healthy",
            camera_count=0,
            streaming_camera_count=0,
            error_camera_count=0,
            sync_evidence_status="recorded",
            pending_count=0,
            retention_expires_at=(None if null_retention else received_at + timedelta(days=7)),
        )
        db.add_all([fact, health])
        await db.commit()
        return ObservationIds(
            observation_id=observation.id,
            fact_id=fact.id,
            health_id=health.id,
        )


async def _add_offline_live_state(
    runtime: PostgresRuntime,
    *,
    scope: Scope,
    observation_id: str,
    sequence: int,
    observed_at: datetime,
    received_at: datetime,
) -> None:
    async with runtime.sessions() as db:
        observation = await db.get(TelemetryObservation, observation_id)
        assert observation is not None
        db.add(
            SiteLiveState(
                site_id=scope.site_id,
                enterprise_id=scope.enterprise_id,
                edge_device_id=scope.device_id,
                classification=scope.classification,
                telemetry_epoch_id=scope.epoch_id,
                telemetry_observation_id=observation_id,
                epoch_generation=1,
                sequence=sequence,
                live_state_version=1,
                observed_at=observed_at,
                received_at=received_at,
                freshness_expires_at=observed_at + timedelta(seconds=90),
                offline_after_at=observed_at + timedelta(minutes=5),
                last_freshness_evaluated_at=received_at,
                freshness_state="fresh",
                metric_quality="unknown",
                metric_provenance="camera_derived",
                coverage_evidence_status="not_recorded",
                service_state="healthy",
                pending_count=0,
            )
        )
        await db.commit()


async def _rollup(runtime: PostgresRuntime, scope: Scope) -> SiteTelemetryHourlyRollup:
    async with runtime.sessions() as db:
        rollup = await db.scalar(
            select(SiteTelemetryHourlyRollup).where(
                SiteTelemetryHourlyRollup.site_id == scope.site_id,
                SiteTelemetryHourlyRollup.classification == scope.classification,
                SiteTelemetryHourlyRollup.definition == "entries_window",
            )
        )
        assert rollup is not None
        return rollup


async def _clean_runtime(runtime: PostgresRuntime) -> None:
    if not runtime.enterprise_ids:
        return
    trigger_tables = (
        "site_live_state",
        "telemetry_metric_facts",
        "device_health_samples",
        "telemetry_observations",
        "device_telemetry_epochs",
        "edge_devices",
        "site_location_versions",
        "enterprise_sites",
        "enterprises",
    )
    async with runtime.sessions() as db, db.begin():
        for table_name in trigger_tables:
            await db.execute(text(f"ALTER TABLE {table_name} DISABLE TRIGGER USER"))

        site_ids = select(EnterpriseSite.id).where(
            EnterpriseSite.enterprise_id.in_(runtime.enterprise_ids)
        )
        device_ids = select(EdgeDevice.id).where(EdgeDevice.site_id.in_(site_ids))
        await db.execute(
            delete(SiteLiveState).where(SiteLiveState.enterprise_id.in_(runtime.enterprise_ids))
        )
        await db.execute(
            delete(SiteTelemetryHourlyRollup).where(
                SiteTelemetryHourlyRollup.enterprise_id.in_(runtime.enterprise_ids)
            )
        )
        await db.execute(
            delete(TelemetryMetricFact).where(
                TelemetryMetricFact.enterprise_id.in_(runtime.enterprise_ids)
            )
        )
        await db.execute(delete(DeviceHealthSample).where(DeviceHealthSample.site_id.in_(site_ids)))
        await db.execute(
            delete(TelemetryObservation).where(
                TelemetryObservation.enterprise_id.in_(runtime.enterprise_ids)
            )
        )
        await db.execute(
            delete(DeviceTelemetryEpoch).where(DeviceTelemetryEpoch.edge_device_id.in_(device_ids))
        )
        await db.execute(delete(EdgeDevice).where(EdgeDevice.id.in_(device_ids)))
        await db.execute(
            delete(SiteLocationVersion).where(SiteLocationVersion.site_id.in_(site_ids))
        )
        await db.execute(delete(EnterpriseSite).where(EnterpriseSite.id.in_(site_ids)))
        await db.execute(delete(Enterprise).where(Enterprise.id.in_(runtime.enterprise_ids)))
        if runtime.simulation_run_ids:
            await db.execute(
                delete(SimulationRun).where(SimulationRun.id.in_(runtime.simulation_run_ids))
            )

        for table_name in reversed(trigger_tables):
            await db.execute(text(f"ALTER TABLE {table_name} ENABLE TRIGGER USER"))
