import asyncio
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from time import monotonic

from app.core.config import Settings
from app.features.maintenance.asset_retention import AssetRetentionCounts
from app.features.maintenance.retention import RetentionCleanupCounts, run_retention_cleanup
from app.features.maintenance.telemetry_retention import TelemetryRetentionCounts

logger = logging.getLogger("uvicorn.error")
_worker_task: asyncio.Task[None] | None = None
_worker_stop_event: asyncio.Event | None = None
_cleanup_lock: asyncio.Lock | None = None


@dataclass
class RetentionRuntimeMetrics:
    running: bool = False
    completed_runs: int = 0
    failed_runs: int = 0
    last_started_at: datetime | None = None
    last_completed_at: datetime | None = None
    last_duration_seconds: float | None = None
    last_error: str | None = None
    last_counts: RetentionCleanupCounts = field(default_factory=RetentionCleanupCounts)
    total_counts: RetentionCleanupCounts = field(default_factory=RetentionCleanupCounts)


@dataclass(frozen=True)
class RetentionRuntimeSnapshot:
    worker_ready: bool
    running: bool
    completed_runs: int
    failed_runs: int
    last_started_at: datetime | None
    last_completed_at: datetime | None
    last_duration_seconds: float | None
    last_error: str | None
    last_counts: RetentionCleanupCounts
    total_counts: RetentionCleanupCounts


_metrics = RetentionRuntimeMetrics()


async def start_retention_cleanup_worker(settings: Settings) -> None:
    global _cleanup_lock, _worker_stop_event, _worker_task
    await stop_retention_cleanup_worker()
    _cleanup_lock = asyncio.Lock()
    _worker_stop_event = asyncio.Event()
    _worker_task = asyncio.create_task(
        _worker_loop(settings, _worker_stop_event),
        name="tanaw-retention-cleanup",
    )


async def stop_retention_cleanup_worker() -> None:
    global _cleanup_lock, _worker_stop_event, _worker_task
    stop_event = _worker_stop_event
    task = _worker_task
    _worker_stop_event = None
    _worker_task = None
    if stop_event is not None:
        stop_event.set()
    if task is not None:
        await task
    _cleanup_lock = None


def retention_cleanup_worker_ready() -> bool:
    return _worker_task is not None and not _worker_task.done()


def retention_runtime_snapshot() -> RetentionRuntimeSnapshot:
    return RetentionRuntimeSnapshot(
        worker_ready=retention_cleanup_worker_ready(),
        running=_metrics.running,
        completed_runs=_metrics.completed_runs,
        failed_runs=_metrics.failed_runs,
        last_started_at=_metrics.last_started_at,
        last_completed_at=_metrics.last_completed_at,
        last_duration_seconds=_metrics.last_duration_seconds,
        last_error=_metrics.last_error,
        last_counts=_metrics.last_counts,
        total_counts=_metrics.total_counts,
    )


async def run_retention_cleanup_now(settings: Settings) -> RetentionCleanupCounts:
    global _cleanup_lock
    lock = _cleanup_lock
    if lock is None:
        lock = asyncio.Lock()
        _cleanup_lock = lock
    async with lock:
        started_at = datetime.now(UTC)
        started_clock = monotonic()
        _metrics.running = True
        _metrics.last_started_at = started_at
        _metrics.last_error = None
        try:
            counts = await run_retention_cleanup(settings, now=started_at)
        except Exception as exc:
            _metrics.failed_runs += 1
            _metrics.last_error = type(exc).__name__
            _metrics.last_duration_seconds = monotonic() - started_clock
            logger.exception("Retention cleanup batch failed.")
            raise
        else:
            _metrics.completed_runs += 1
            _metrics.last_counts = counts
            _metrics.total_counts = _add_counts(_metrics.total_counts, counts)
            _metrics.last_completed_at = datetime.now(UTC)
            _metrics.last_duration_seconds = monotonic() - started_clock
            logger.info(
                "Retention cleanup completed deleted=%d expired_email_changes=%d "
                "telemetry_downsampled=%d telemetry_facts_rolled_up=%d "
                "asset_orphans_deleted=%d",
                counts.deleted_records,
                counts.expired_email_change_requests,
                counts.telemetry.observations_downsampled,
                counts.telemetry.metric_facts_rolled_up,
                counts.assets.orphan_objects_deleted,
            )
            return counts
        finally:
            _metrics.running = False


async def _worker_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_retention_cleanup_now(settings)
        except Exception:
            pass
        try:
            await asyncio.wait_for(
                stop_event.wait(),
                timeout=settings.retention_cleanup_interval_seconds,
            )
        except TimeoutError:
            pass


def _add_counts(
    current: RetentionCleanupCounts,
    addition: RetentionCleanupCounts,
) -> RetentionCleanupCounts:
    return RetentionCleanupCounts(
        activation_tokens=current.activation_tokens + addition.activation_tokens,
        password_reset_challenges=(
            current.password_reset_challenges + addition.password_reset_challenges
        ),
        password_reset_rate_buckets=(
            current.password_reset_rate_buckets + addition.password_reset_rate_buckets
        ),
        expired_email_change_requests=(
            current.expired_email_change_requests + addition.expired_email_change_requests
        ),
        email_change_requests=current.email_change_requests + addition.email_change_requests,
        email_outbox_records=current.email_outbox_records + addition.email_outbox_records,
        activity_logs=current.activity_logs + addition.activity_logs,
        domain_events=current.domain_events + addition.domain_events,
        user_notifications=current.user_notifications + addition.user_notifications,
        operational_alerts=current.operational_alerts + addition.operational_alerts,
        assets=_add_asset_counts(current.assets, addition.assets),
        telemetry=_add_telemetry_counts(current.telemetry, addition.telemetry),
    )


def _add_asset_counts(
    current: AssetRetentionCounts,
    addition: AssetRetentionCounts,
) -> AssetRetentionCounts:
    return AssetRetentionCounts(
        support_attachments_retired=(
            current.support_attachments_retired + addition.support_attachments_retired
        ),
        objects_reconciled=current.objects_reconciled + addition.objects_reconciled,
        metadata_deleted=current.metadata_deleted + addition.metadata_deleted,
        orphan_objects_deleted=(current.orphan_objects_deleted + addition.orphan_objects_deleted),
        temporary_objects_deleted=(
            current.temporary_objects_deleted + addition.temporary_objects_deleted
        ),
    )


def _add_telemetry_counts(
    current: TelemetryRetentionCounts,
    addition: TelemetryRetentionCounts,
) -> TelemetryRetentionCounts:
    return TelemetryRetentionCounts(
        observations_downsampled=(
            current.observations_downsampled + addition.observations_downsampled
        ),
        metric_facts_rolled_up=(current.metric_facts_rolled_up + addition.metric_facts_rolled_up),
        rollup_partitions_created=(
            current.rollup_partitions_created + addition.rollup_partitions_created
        ),
        rollup_partitions_dropped=(
            current.rollup_partitions_dropped + addition.rollup_partitions_dropped
        ),
        metric_facts_deleted=current.metric_facts_deleted + addition.metric_facts_deleted,
        device_health_samples_deleted=(
            current.device_health_samples_deleted + addition.device_health_samples_deleted
        ),
        observations_deleted=current.observations_deleted + addition.observations_deleted,
        hourly_rollups_deleted=current.hourly_rollups_deleted + addition.hourly_rollups_deleted,
        observability=addition.observability,
    )
