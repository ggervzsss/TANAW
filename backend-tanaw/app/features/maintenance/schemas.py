from datetime import datetime

from pydantic import BaseModel

from app.features.maintenance.retention import RetentionCleanupCounts
from app.features.maintenance.runtime import RetentionRuntimeSnapshot


class RetentionCleanupCountsResponse(BaseModel):
    activationTokens: int
    passwordResetChallenges: int
    passwordResetRateBuckets: int
    expiredEmailChangeRequests: int
    emailChangeRequests: int
    developmentDeliveries: int
    emailOutboxRecords: int
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


def to_counts_response(counts: RetentionCleanupCounts) -> RetentionCleanupCountsResponse:
    return RetentionCleanupCountsResponse(
        activationTokens=counts.activation_tokens,
        passwordResetChallenges=counts.password_reset_challenges,
        passwordResetRateBuckets=counts.password_reset_rate_buckets,
        expiredEmailChangeRequests=counts.expired_email_change_requests,
        emailChangeRequests=counts.email_change_requests,
        developmentDeliveries=counts.development_deliveries,
        emailOutboxRecords=counts.email_outbox_records,
        deletedRecords=counts.deleted_records,
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
