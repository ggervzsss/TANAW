from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import delete, exists, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.db.session import AsyncSessionLocal
from app.features.telemetry.models import (
    DeviceHealthSample,
    SiteLiveState,
    SiteTelemetryHourlyRollup,
    TelemetryMetricFact,
    TelemetryMigrationException,
    TelemetryObservation,
)

SessionFactory = async_sessionmaker[AsyncSession]
_CLASSIFICATIONS = ("official", "simulation")


@dataclass(frozen=True)
class ClassificationTelemetryObservability:
    ingestion_lag_seconds: float | None = None
    unprocessed_observations: int = 0
    oldest_unprocessed_at: datetime | None = None
    oldest_unprocessed_age_seconds: float | None = None


@dataclass(frozen=True)
class TelemetryRetentionObservability:
    official: ClassificationTelemetryObservability = ClassificationTelemetryObservability()
    simulation: ClassificationTelemetryObservability = ClassificationTelemetryObservability()


@dataclass(frozen=True)
class TelemetryRetentionCounts:
    observations_downsampled: int = 0
    metric_facts_rolled_up: int = 0
    rollup_partitions_created: int = 0
    rollup_partitions_dropped: int = 0
    metric_facts_deleted: int = 0
    device_health_samples_deleted: int = 0
    observations_deleted: int = 0
    hourly_rollups_deleted: int = 0
    observability: TelemetryRetentionObservability = TelemetryRetentionObservability()

    @property
    def deleted_records(self) -> int:
        return (
            self.metric_facts_deleted
            + self.device_health_samples_deleted
            + self.observations_deleted
            + self.hourly_rollups_deleted
        )


@dataclass(frozen=True, order=True)
class _RollupKey:
    bucket_start: datetime
    enterprise_id: str
    site_id: str
    classification: str
    definition: str
    definition_version: int
    unit: str
    provenance: str


@dataclass
class _Aggregate:
    sample_count: int = 0
    known_sample_count: int = 0
    unknown_sample_count: int = 0
    value_sum: Decimal | None = None
    value_min: Decimal | None = None
    value_max: Decimal | None = None
    first_observed_at: datetime | None = None
    last_observed_at: datetime | None = None
    last_received_at: datetime | None = None
    last_source_observation_id: str | None = None
    last_value: Decimal | None = None
    last_quality: str | None = None
    confirmed_sample_count: int = 0
    degraded_sample_count: int = 0
    estimated_sample_count: int = 0
    unknown_quality_sample_count: int = 0
    coverage_sample_count: int = 0
    monitored_seconds_sum: int = 0
    expected_seconds_sum: int = 0
    coverage_gap_count_sum: int = 0


async def run_telemetry_retention(
    settings: Settings,
    *,
    now: datetime | None = None,
    session_factory: SessionFactory = AsyncSessionLocal,
) -> TelemetryRetentionCounts:
    current = _as_utc(now or datetime.now(UTC))
    downsampled, facts_rolled_up, partitions_created = await _downsample_observations(
        session_factory,
        eligible_before=current - timedelta(seconds=settings.telemetry_downsample_settle_seconds),
        processed_at=current,
        batch_size=settings.retention_cleanup_batch_size,
    )
    facts_deleted = await _delete_metric_facts(
        session_factory,
        now=current,
        batch_size=settings.retention_cleanup_batch_size,
    )
    health_deleted = await _delete_device_health_samples(
        session_factory,
        now=current,
        batch_size=settings.retention_cleanup_batch_size,
    )
    observations_deleted = await _delete_observations(
        session_factory,
        now=current,
        batch_size=settings.retention_cleanup_batch_size,
    )
    rollups_deleted, partitions_dropped = await _delete_hourly_rollup_partitions(
        session_factory,
        cutoff=current - timedelta(days=settings.telemetry_hourly_rollup_retention_days),
        batch_size=settings.retention_cleanup_batch_size,
    )
    observability = await _telemetry_observability(session_factory, now=current)
    return TelemetryRetentionCounts(
        observations_downsampled=downsampled,
        metric_facts_rolled_up=facts_rolled_up,
        rollup_partitions_created=partitions_created,
        rollup_partitions_dropped=partitions_dropped,
        metric_facts_deleted=facts_deleted,
        device_health_samples_deleted=health_deleted,
        observations_deleted=observations_deleted,
        hourly_rollups_deleted=rollups_deleted,
        observability=observability,
    )


async def _downsample_observations(
    session_factory: SessionFactory,
    *,
    eligible_before: datetime,
    processed_at: datetime,
    batch_size: int,
) -> tuple[int, int, int]:
    async with session_factory() as db:
        observations = list(
            await db.scalars(
                select(TelemetryObservation)
                .where(
                    TelemetryObservation.downsampled_at.is_(None),
                    TelemetryObservation.received_at <= eligible_before,
                )
                .order_by(
                    TelemetryObservation.received_at.asc(),
                    TelemetryObservation.id.asc(),
                )
                .with_for_update(of=TelemetryObservation, skip_locked=True)
                .limit(batch_size)
            )
        )
        if not observations:
            await db.commit()
            return 0, 0, 0

        observation_ids = [observation.id for observation in observations]
        observation_by_id = {observation.id: observation for observation in observations}
        facts = list(
            await db.scalars(
                select(TelemetryMetricFact).where(
                    TelemetryMetricFact.telemetry_observation_id.in_(observation_ids),
                    TelemetryMetricFact.fact_status == "qualified",
                    TelemetryMetricFact.grain == "site",
                )
            )
        )
        aggregates: dict[_RollupKey, _Aggregate] = defaultdict(_Aggregate)
        for fact in facts:
            observation = observation_by_id[fact.telemetry_observation_id]
            _add_fact(aggregates, observation=observation, fact=fact)

        partitions_created = await _ensure_partitions(db, aggregates)
        for key in sorted(aggregates):
            await _lock_rollup_key(db, key)
            await _merge_rollup(db, key=key, addition=aggregates[key], updated_at=processed_at)

        for observation in observations:
            observation.downsampled_at = processed_at
        await db.commit()
        return len(observations), len(facts), partitions_created


def _add_fact(
    aggregates: dict[_RollupKey, _Aggregate],
    *,
    observation: TelemetryObservation,
    fact: TelemetryMetricFact,
) -> None:
    observed_at = _as_utc(observation.observed_at)
    received_at = _as_utc(observation.received_at)
    bucket_start = observed_at.replace(minute=0, second=0, microsecond=0)
    key = _RollupKey(
        bucket_start=bucket_start,
        enterprise_id=observation.enterprise_id,
        site_id=observation.site_id,
        classification=observation.classification,
        definition=fact.definition,
        definition_version=fact.definition_version,
        unit=fact.unit,
        provenance=fact.provenance,
    )
    aggregate = aggregates[key]
    aggregate.sample_count += 1
    if fact.value is None:
        aggregate.unknown_sample_count += 1
    else:
        value = Decimal(fact.value)
        aggregate.known_sample_count += 1
        aggregate.value_sum = value if aggregate.value_sum is None else aggregate.value_sum + value
        aggregate.value_min = (
            value if aggregate.value_min is None else min(aggregate.value_min, value)
        )
        aggregate.value_max = (
            value if aggregate.value_max is None else max(aggregate.value_max, value)
        )

    quality_field = {
        "confirmed": "confirmed_sample_count",
        "degraded": "degraded_sample_count",
        "estimated": "estimated_sample_count",
        "unknown": "unknown_quality_sample_count",
    }[fact.quality]
    setattr(aggregate, quality_field, getattr(aggregate, quality_field) + 1)

    if fact.coverage_evidence_status == "recorded":
        aggregate.coverage_sample_count += 1
        aggregate.monitored_seconds_sum += fact.monitored_seconds or 0
        aggregate.expected_seconds_sum += fact.expected_seconds or 0
        aggregate.coverage_gap_count_sum += fact.coverage_gap_count or 0

    aggregate.first_observed_at = (
        observed_at
        if aggregate.first_observed_at is None
        else min(aggregate.first_observed_at, observed_at)
    )
    aggregate.last_received_at = (
        received_at
        if aggregate.last_received_at is None
        else max(aggregate.last_received_at, received_at)
    )
    candidate_last = (observed_at, observation.id)
    if (
        aggregate.last_observed_at is None
        or aggregate.last_source_observation_id is None
        or candidate_last > (aggregate.last_observed_at, aggregate.last_source_observation_id)
    ):
        aggregate.last_observed_at = observed_at
        aggregate.last_source_observation_id = observation.id
        aggregate.last_value = Decimal(fact.value) if fact.value is not None else None
        aggregate.last_quality = fact.quality


async def _ensure_partitions(
    db: AsyncSession,
    aggregates: dict[_RollupKey, _Aggregate],
) -> int:
    if db.get_bind().dialect.name != "postgresql":
        return 0
    months = sorted({_month_start(key.bucket_start) for key in aggregates})
    created = 0
    for start in months:
        end = _next_month(start)
        name = f"site_telemetry_hourly_rollups_{start:%Y%m}"
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
            {"lock_key": f"telemetry-rollup-partition:{name}"},
        )
        present = await db.scalar(text("SELECT to_regclass(:name) IS NOT NULL"), {"name": name})
        if present:
            attached = await db.scalar(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_inherits
                        JOIN pg_class AS parent ON parent.oid = inhparent
                        JOIN pg_class AS child ON child.oid = inhrelid
                        WHERE parent.oid = 'site_telemetry_hourly_rollups'::regclass
                          AND child.relname = :name
                    )
                    """
                ),
                {"name": name},
            )
            if not attached:
                raise RuntimeError(
                    f"Telemetry rollup relation {name} exists but is not attached to its parent."
                )
        else:
            await db.execute(
                text(
                    f"CREATE TABLE {name} PARTITION OF site_telemetry_hourly_rollups "
                    f"FOR VALUES FROM ('{start.isoformat()}') TO ('{end.isoformat()}')"
                )
            )
            created += 1
        await db.execute(
            text(
                """
                INSERT INTO site_telemetry_rollup_partitions (
                    partition_name, range_start, range_end
                ) VALUES (:name, :range_start, :range_end)
                ON CONFLICT (partition_name) DO NOTHING
                """
            ),
            {"name": name, "range_start": start, "range_end": end},
        )
        recorded_start, recorded_end = (
            await db.execute(
                text(
                    """
                    SELECT range_start, range_end
                    FROM site_telemetry_rollup_partitions
                    WHERE partition_name = :name
                    """
                ),
                {"name": name},
            )
        ).one()
        if _as_utc(recorded_start) != start or _as_utc(recorded_end) != end:
            raise RuntimeError(f"Telemetry rollup partition {name} has conflicting UTC bounds.")
    return created


async def _lock_rollup_key(db: AsyncSession, key: _RollupKey) -> None:
    if db.get_bind().dialect.name != "postgresql":
        return
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {
            "lock_key": "telemetry-rollup:"
            + "|".join(
                (
                    key.bucket_start.isoformat(),
                    key.enterprise_id,
                    key.site_id,
                    key.classification,
                    key.definition,
                    str(key.definition_version),
                    key.unit,
                    key.provenance,
                )
            )
        },
    )


async def _merge_rollup(
    db: AsyncSession,
    *,
    key: _RollupKey,
    addition: _Aggregate,
    updated_at: datetime,
) -> None:
    existing = await db.scalar(
        select(SiteTelemetryHourlyRollup)
        .where(
            SiteTelemetryHourlyRollup.bucket_start == key.bucket_start,
            SiteTelemetryHourlyRollup.enterprise_id == key.enterprise_id,
            SiteTelemetryHourlyRollup.site_id == key.site_id,
            SiteTelemetryHourlyRollup.classification == key.classification,
            SiteTelemetryHourlyRollup.definition == key.definition,
            SiteTelemetryHourlyRollup.definition_version == key.definition_version,
            SiteTelemetryHourlyRollup.unit == key.unit,
            SiteTelemetryHourlyRollup.provenance == key.provenance,
        )
        .with_for_update()
    )
    if existing is None:
        assert addition.first_observed_at is not None
        assert addition.last_observed_at is not None
        assert addition.last_received_at is not None
        assert addition.last_source_observation_id is not None
        assert addition.last_quality is not None
        db.add(
            SiteTelemetryHourlyRollup(
                bucket_start=key.bucket_start,
                enterprise_id=key.enterprise_id,
                site_id=key.site_id,
                classification=key.classification,
                definition=key.definition,
                definition_version=key.definition_version,
                unit=key.unit,
                provenance=key.provenance,
                bucket_end=key.bucket_start + timedelta(hours=1),
                sample_count=addition.sample_count,
                known_sample_count=addition.known_sample_count,
                unknown_sample_count=addition.unknown_sample_count,
                value_sum=addition.value_sum,
                value_min=addition.value_min,
                value_max=addition.value_max,
                last_value=addition.last_value,
                first_observed_at=addition.first_observed_at,
                last_observed_at=addition.last_observed_at,
                last_received_at=addition.last_received_at,
                last_source_observation_id=addition.last_source_observation_id,
                last_quality=addition.last_quality,
                confirmed_sample_count=addition.confirmed_sample_count,
                degraded_sample_count=addition.degraded_sample_count,
                estimated_sample_count=addition.estimated_sample_count,
                unknown_quality_sample_count=addition.unknown_quality_sample_count,
                coverage_sample_count=addition.coverage_sample_count,
                monitored_seconds_sum=addition.monitored_seconds_sum,
                expected_seconds_sum=addition.expected_seconds_sum,
                coverage_gap_count_sum=addition.coverage_gap_count_sum,
                rollup_version=1,
                created_at=updated_at,
                updated_at=updated_at,
            )
        )
        return

    existing.sample_count += addition.sample_count
    existing.known_sample_count += addition.known_sample_count
    existing.unknown_sample_count += addition.unknown_sample_count
    existing.value_sum = _sum_optional(existing.value_sum, addition.value_sum)
    existing.value_min = _min_optional(existing.value_min, addition.value_min)
    existing.value_max = _max_optional(existing.value_max, addition.value_max)
    existing.confirmed_sample_count += addition.confirmed_sample_count
    existing.degraded_sample_count += addition.degraded_sample_count
    existing.estimated_sample_count += addition.estimated_sample_count
    existing.unknown_quality_sample_count += addition.unknown_quality_sample_count
    existing.coverage_sample_count += addition.coverage_sample_count
    existing.monitored_seconds_sum += addition.monitored_seconds_sum
    existing.expected_seconds_sum += addition.expected_seconds_sum
    existing.coverage_gap_count_sum += addition.coverage_gap_count_sum
    if addition.first_observed_at is not None:
        existing.first_observed_at = min(existing.first_observed_at, addition.first_observed_at)
    if addition.last_received_at is not None:
        existing.last_received_at = max(existing.last_received_at, addition.last_received_at)
    if (
        addition.last_observed_at is not None
        and addition.last_source_observation_id is not None
        and (addition.last_observed_at, addition.last_source_observation_id)
        > (existing.last_observed_at, existing.last_source_observation_id)
    ):
        assert addition.last_quality is not None
        existing.last_observed_at = addition.last_observed_at
        existing.last_source_observation_id = addition.last_source_observation_id
        existing.last_value = addition.last_value
        existing.last_quality = addition.last_quality
    existing.rollup_version += 1
    existing.updated_at = updated_at


async def _delete_metric_facts(
    session_factory: SessionFactory,
    *,
    now: datetime,
    batch_size: int,
) -> int:
    async with session_factory() as db:
        ids = list(
            await db.scalars(
                select(TelemetryMetricFact.id)
                .join(
                    TelemetryObservation,
                    TelemetryObservation.id == TelemetryMetricFact.telemetry_observation_id,
                )
                .where(
                    TelemetryObservation.downsampled_at.is_not(None),
                    TelemetryMetricFact.retention_expires_at.is_not(None),
                    TelemetryMetricFact.retention_expires_at <= now,
                )
                .order_by(TelemetryObservation.received_at.asc(), TelemetryMetricFact.id.asc())
                .with_for_update(of=TelemetryMetricFact, skip_locked=True)
                .limit(batch_size)
            )
        )
        if ids:
            await db.execute(delete(TelemetryMetricFact).where(TelemetryMetricFact.id.in_(ids)))
        await db.commit()
        return len(ids)


async def _delete_device_health_samples(
    session_factory: SessionFactory,
    *,
    now: datetime,
    batch_size: int,
) -> int:
    async with session_factory() as db:
        ids = list(
            await db.scalars(
                select(DeviceHealthSample.id)
                .join(
                    TelemetryObservation,
                    TelemetryObservation.id == DeviceHealthSample.telemetry_observation_id,
                )
                .where(
                    TelemetryObservation.downsampled_at.is_not(None),
                    DeviceHealthSample.retention_expires_at.is_not(None),
                    DeviceHealthSample.retention_expires_at <= now,
                )
                .order_by(DeviceHealthSample.received_at.asc(), DeviceHealthSample.id.asc())
                .with_for_update(of=DeviceHealthSample, skip_locked=True)
                .limit(batch_size)
            )
        )
        if ids:
            await db.execute(delete(DeviceHealthSample).where(DeviceHealthSample.id.in_(ids)))
        await db.commit()
        return len(ids)


async def _delete_observations(
    session_factory: SessionFactory,
    *,
    now: datetime,
    batch_size: int,
) -> int:
    async with session_factory() as db:
        ids = list(
            await db.scalars(
                select(TelemetryObservation.id)
                .where(
                    TelemetryObservation.downsampled_at.is_not(None),
                    TelemetryObservation.retention_expires_at.is_not(None),
                    TelemetryObservation.retention_expires_at <= now,
                    ~exists(
                        select(TelemetryMetricFact.id).where(
                            TelemetryMetricFact.telemetry_observation_id == TelemetryObservation.id
                        )
                    ),
                    ~exists(
                        select(DeviceHealthSample.id).where(
                            DeviceHealthSample.telemetry_observation_id == TelemetryObservation.id
                        )
                    ),
                    ~exists(
                        select(SiteLiveState.site_id).where(
                            SiteLiveState.telemetry_observation_id == TelemetryObservation.id
                        )
                    ),
                    ~exists(
                        select(TelemetryMigrationException.id).where(
                            TelemetryMigrationException.telemetry_observation_id
                            == TelemetryObservation.id
                        )
                    ),
                )
                .order_by(TelemetryObservation.received_at.asc(), TelemetryObservation.id.asc())
                .with_for_update(of=TelemetryObservation, skip_locked=True)
                .limit(batch_size)
            )
        )
        if ids:
            await db.execute(delete(TelemetryObservation).where(TelemetryObservation.id.in_(ids)))
        await db.commit()
        return len(ids)


async def _delete_hourly_rollup_partitions(
    session_factory: SessionFactory,
    *,
    cutoff: datetime,
    batch_size: int,
) -> tuple[int, int]:
    async with session_factory() as db:
        if db.get_bind().dialect.name != "postgresql":
            rows = list(
                await db.scalars(
                    select(SiteTelemetryHourlyRollup)
                    .where(SiteTelemetryHourlyRollup.bucket_end < cutoff)
                    .order_by(SiteTelemetryHourlyRollup.bucket_start.asc())
                    .with_for_update(skip_locked=True)
                    .limit(batch_size)
                )
            )
            for row in rows:
                await db.delete(row)
            await db.commit()
            return len(rows), 0
        partition = (
            await db.execute(
                text(
                    """
                    WITH candidate AS MATERIALIZED (
                        SELECT partition_name
                        FROM site_telemetry_rollup_partitions
                        WHERE range_end <= :cutoff
                        ORDER BY range_end ASC, partition_name ASC
                        LIMIT 1
                    )
                    SELECT registry.partition_name, registry.range_start, registry.range_end
                    FROM site_telemetry_rollup_partitions AS registry
                    JOIN candidate USING (partition_name)
                    WHERE pg_try_advisory_xact_lock(
                          hashtextextended(
                              'telemetry-rollup-partition:' || registry.partition_name,
                              0
                          )
                      )
                    FOR UPDATE OF registry SKIP LOCKED
                    """
                ),
                {"cutoff": cutoff},
            )
        ).first()
        if partition is None:
            await db.commit()
            return 0, 0
        partition_name = str(partition.partition_name)
        if re.fullmatch(r"site_telemetry_hourly_rollups_[0-9]{6}", partition_name) is None:
            raise RuntimeError("Telemetry rollup partition registry contains an invalid name.")
        row_count = int(await db.scalar(text(f"SELECT count(*) FROM {partition_name}")) or 0)
        await db.execute(text(f"DROP TABLE {partition_name}"))
        await db.execute(
            text(
                "DELETE FROM site_telemetry_rollup_partitions "
                "WHERE partition_name = :partition_name"
            ),
            {"partition_name": partition_name},
        )
        await db.commit()
        return row_count, 1


async def _telemetry_observability(
    session_factory: SessionFactory,
    *,
    now: datetime,
) -> TelemetryRetentionObservability:
    async with session_factory() as db:
        received_rows = (
            await db.execute(
                select(
                    TelemetryObservation.classification,
                    func.max(TelemetryObservation.received_at),
                ).group_by(TelemetryObservation.classification)
            )
        ).all()
        pending_rows = (
            await db.execute(
                select(
                    TelemetryObservation.classification,
                    func.count(TelemetryObservation.id),
                    func.min(TelemetryObservation.received_at),
                )
                .where(TelemetryObservation.downsampled_at.is_(None))
                .group_by(TelemetryObservation.classification)
            )
        ).all()

    latest = {classification: _as_utc(value) for classification, value in received_rows}
    pending = {
        classification: (int(count), _as_utc(oldest))
        for classification, count, oldest in pending_rows
    }

    def status(classification: str) -> ClassificationTelemetryObservability:
        last_received_at = latest.get(classification)
        pending_count, oldest = pending.get(classification, (0, None))
        return ClassificationTelemetryObservability(
            ingestion_lag_seconds=(
                max(0.0, (now - last_received_at).total_seconds())
                if last_received_at is not None
                else None
            ),
            unprocessed_observations=pending_count,
            oldest_unprocessed_at=oldest,
            oldest_unprocessed_age_seconds=(
                max(0.0, (now - oldest).total_seconds()) if oldest is not None else None
            ),
        )

    return TelemetryRetentionObservability(
        official=status(_CLASSIFICATIONS[0]),
        simulation=status(_CLASSIFICATIONS[1]),
    )


def _month_start(value: datetime) -> datetime:
    normalized = _as_utc(value)
    return normalized.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _next_month(value: datetime) -> datetime:
    return (
        value.replace(year=value.year + 1, month=1)
        if value.month == 12
        else value.replace(month=value.month + 1)
    )


def _sum_optional(left: Decimal | None, right: Decimal | None) -> Decimal | None:
    if left is None:
        return right
    if right is None:
        return left
    return left + right


def _min_optional(left: Decimal | None, right: Decimal | None) -> Decimal | None:
    if left is None:
        return right
    if right is None:
        return left
    return min(left, right)


def _max_optional(left: Decimal | None, right: Decimal | None) -> Decimal | None:
    if left is None:
        return right
    if right is None:
        return left
    return max(left, right)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
