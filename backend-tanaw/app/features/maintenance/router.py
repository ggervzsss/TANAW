from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.maintenance.runtime import (
    retention_runtime_snapshot,
    run_retention_cleanup_now,
)
from app.features.maintenance.schemas import RetentionStatusResponse, to_status_response

router = APIRouter(prefix="/maintenance", tags=["maintenance"])
ITAccount = Annotated[Account, Depends(require_roles({"it"}))]


@router.get("/retention", response_model=RetentionStatusResponse)
async def get_retention_status(_: ITAccount) -> RetentionStatusResponse:
    settings = get_settings()
    return to_status_response(
        retention_runtime_snapshot(),
        interval_seconds=settings.retention_cleanup_interval_seconds,
        batch_size=settings.retention_cleanup_batch_size,
        telemetry_retention_days=settings.telemetry_raw_retention_days,
        telemetry_batch_size=settings.telemetry_retention_batch_size,
    )


@router.post("/retention/run", response_model=RetentionStatusResponse)
async def run_retention_now(
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RetentionStatusResponse:
    settings = get_settings()
    try:
        counts = await run_retention_cleanup_now(settings)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Retention maintenance could not complete.",
        ) from exc

    await create_activity_log(
        db,
        ActivityLogCreate(
            category="IT Activity",
            severity="Info",
            actor=actor.display_name,
            actorRole="IT Personnel",
            action="Run Retention Cleanup",
            target="TANAW Data Retention",
            summary=(
                f"{actor.display_name} ran retention cleanup and deleted "
                f"{counts.deleted_records} expired records."
            ),
            sourceId="retention-cleanup",
            metadata={
                "deletedRecords": counts.deleted_records,
                "telemetrySnapshots": counts.telemetry_snapshots,
                "expiredEmailChangeRequests": counts.expired_email_change_requests,
            },
        ),
    )
    return to_status_response(
        retention_runtime_snapshot(),
        interval_seconds=settings.retention_cleanup_interval_seconds,
        batch_size=settings.retention_cleanup_batch_size,
        telemetry_retention_days=settings.telemetry_raw_retention_days,
        telemetry_batch_size=settings.telemetry_retention_batch_size,
    )
