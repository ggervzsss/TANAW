from datetime import datetime

from pydantic import BaseModel

from app.core.operational_observability import LagSnapshot, OperationalSnapshot
from app.features.events.delivery import DeliveryQueueMetrics
from app.features.maintenance.operations import LiveFreshnessMetrics, age_seconds
from app.features.maintenance.retention import RetentionCleanupCounts
from app.features.maintenance.runtime import RetentionRuntimeSnapshot
from app.features.maintenance.telemetry_retention import (
    ClassificationTelemetryObservability,
    TelemetryRetentionCounts,
)


class ClassificationTelemetryObservabilityResponse(BaseModel):
    ingestionLagSeconds: float | None
    unprocessedObservations: int
    oldestUnprocessedAt: datetime | None
    oldestUnprocessedAgeSeconds: float | None


class TelemetryRetentionCountsResponse(BaseModel):
    observationsDownsampled: int
    metricFactsRolledUp: int
    rollupPartitionsCreated: int
    rollupPartitionsDropped: int
    metricFactsDeleted: int
    deviceHealthSamplesDeleted: int
    observationsDeleted: int
    hourlyRollupsDeleted: int
    deletedRecords: int
    official: ClassificationTelemetryObservabilityResponse
    simulation: ClassificationTelemetryObservabilityResponse


class RetentionCleanupCountsResponse(BaseModel):
    activationTokens: int
    passwordResetChallenges: int
    passwordResetRateBuckets: int
    expiredEmailChangeRequests: int
    emailChangeRequests: int
    emailOutboxRecords: int
    activityLogs: int
    domainEvents: int
    userNotifications: int
    operationalAlerts: int
    supportAttachmentsRetired: int
    assetObjectsReconciled: int
    assetMetadataDeleted: int
    orphanAssetObjectsDeleted: int
    temporaryAssetObjectsDeleted: int
    telemetry: TelemetryRetentionCountsResponse
    deletedRecords: int


class RetentionStatusResponse(BaseModel):
    workerReady: bool
    running: bool
    completedRuns: int
    failedRuns: int
    intervalSeconds: int
    batchSize: int
    lastStartedAt: datetime | None
    lastCompletedAt: datetime | None
    lastDurationSeconds: float | None
    lastError: str | None
    lastCounts: RetentionCleanupCountsResponse
    totalCounts: RetentionCleanupCountsResponse


class OperationalLagResponse(BaseModel):
    observations: int
    latestSeconds: float | None
    maximumSeconds: float | None


class DomainEventQueueResponse(BaseModel):
    pending: int
    leased: int
    retryScheduled: int
    delivered: int
    deadLetter: int
    oldestPendingAt: datetime | None
    oldestPendingAgeSeconds: float | None
    oldestReadyAt: datetime | None
    oldestLeaseExpiryAt: datetime | None


class LiveFreshnessResponse(BaseModel):
    fresh: int
    stale: int
    offline: int
    unobserved: int


class OperationalStatusResponse(BaseModel):
    observedAt: datetime
    processInstanceOnly: bool
    counters: dict[str, int]
    finalizationScopes: dict[str, int]
    telemetryObservedToReceivedLag: OperationalLagResponse
    domainEventPublishLag: OperationalLagResponse
    domainEventQueue: DomainEventQueueResponse
    officialLiveSites: LiveFreshnessResponse


def to_counts_response(counts: RetentionCleanupCounts) -> RetentionCleanupCountsResponse:
    return RetentionCleanupCountsResponse(
        activationTokens=counts.activation_tokens,
        passwordResetChallenges=counts.password_reset_challenges,
        passwordResetRateBuckets=counts.password_reset_rate_buckets,
        expiredEmailChangeRequests=counts.expired_email_change_requests,
        emailChangeRequests=counts.email_change_requests,
        emailOutboxRecords=counts.email_outbox_records,
        activityLogs=counts.activity_logs,
        domainEvents=counts.domain_events,
        userNotifications=counts.user_notifications,
        operationalAlerts=counts.operational_alerts,
        supportAttachmentsRetired=counts.assets.support_attachments_retired,
        assetObjectsReconciled=counts.assets.objects_reconciled,
        assetMetadataDeleted=counts.assets.metadata_deleted,
        orphanAssetObjectsDeleted=counts.assets.orphan_objects_deleted,
        temporaryAssetObjectsDeleted=counts.assets.temporary_objects_deleted,
        telemetry=_to_telemetry_counts_response(counts.telemetry),
        deletedRecords=counts.deleted_records,
    )


def _to_telemetry_counts_response(
    counts: TelemetryRetentionCounts,
) -> TelemetryRetentionCountsResponse:
    return TelemetryRetentionCountsResponse(
        observationsDownsampled=counts.observations_downsampled,
        metricFactsRolledUp=counts.metric_facts_rolled_up,
        rollupPartitionsCreated=counts.rollup_partitions_created,
        rollupPartitionsDropped=counts.rollup_partitions_dropped,
        metricFactsDeleted=counts.metric_facts_deleted,
        deviceHealthSamplesDeleted=counts.device_health_samples_deleted,
        observationsDeleted=counts.observations_deleted,
        hourlyRollupsDeleted=counts.hourly_rollups_deleted,
        deletedRecords=counts.deleted_records,
        official=_to_classification_observability(counts.observability.official),
        simulation=_to_classification_observability(counts.observability.simulation),
    )


def _to_classification_observability(
    status: ClassificationTelemetryObservability,
) -> ClassificationTelemetryObservabilityResponse:
    return ClassificationTelemetryObservabilityResponse(
        ingestionLagSeconds=status.ingestion_lag_seconds,
        unprocessedObservations=status.unprocessed_observations,
        oldestUnprocessedAt=status.oldest_unprocessed_at,
        oldestUnprocessedAgeSeconds=status.oldest_unprocessed_age_seconds,
    )


def to_status_response(
    snapshot: RetentionRuntimeSnapshot,
    *,
    interval_seconds: int,
    batch_size: int,
) -> RetentionStatusResponse:
    return RetentionStatusResponse(
        workerReady=snapshot.worker_ready,
        running=snapshot.running,
        completedRuns=snapshot.completed_runs,
        failedRuns=snapshot.failed_runs,
        intervalSeconds=interval_seconds,
        batchSize=batch_size,
        lastStartedAt=snapshot.last_started_at,
        lastCompletedAt=snapshot.last_completed_at,
        lastDurationSeconds=snapshot.last_duration_seconds,
        lastError=snapshot.last_error,
        lastCounts=to_counts_response(snapshot.last_counts),
        totalCounts=to_counts_response(snapshot.total_counts),
    )


def to_operational_status_response(
    snapshot: OperationalSnapshot,
    queue: DeliveryQueueMetrics,
    live: LiveFreshnessMetrics,
) -> OperationalStatusResponse:
    return OperationalStatusResponse(
        observedAt=snapshot.observed_at,
        processInstanceOnly=True,
        counters=snapshot.counters,
        finalizationScopes=snapshot.finalization_scopes,
        telemetryObservedToReceivedLag=_lag_response(snapshot.telemetry_lag),
        domainEventPublishLag=_lag_response(snapshot.domain_event_publish_lag),
        domainEventQueue=DomainEventQueueResponse(
            pending=queue.pending,
            leased=queue.leased,
            retryScheduled=queue.retry_scheduled,
            delivered=queue.delivered,
            deadLetter=queue.dead_letter,
            oldestPendingAt=queue.oldest_pending_at,
            oldestPendingAgeSeconds=age_seconds(
                queue.oldest_pending_at,
                observed_at=snapshot.observed_at,
            ),
            oldestReadyAt=queue.oldest_ready_at,
            oldestLeaseExpiryAt=queue.oldest_lease_expiry_at,
        ),
        officialLiveSites=LiveFreshnessResponse(
            fresh=live.fresh,
            stale=live.stale,
            offline=live.offline,
            unobserved=live.unobserved,
        ),
    )


def _lag_response(lag: LagSnapshot) -> OperationalLagResponse:
    return OperationalLagResponse(
        observations=lag.observations,
        latestSeconds=lag.latest_seconds,
        maximumSeconds=lag.maximum_seconds,
    )
