from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.keyset_pagination import ReadCursorError
from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.alerts.models import OperationalAlert
from app.features.alerts.schemas import (
    OperationalAlertPage,
    OperationalAlertStatusUpdate,
    OperationalAlertSummary,
)
from app.features.alerts.service import list_operational_alerts, to_operational_alert_summary
from app.features.events.operational_resources import enqueue_operational_resource_event

router = APIRouter(prefix="/operational", tags=["alerts"])
ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
AlertReadAccount = Annotated[Account, Depends(require_roles({"admin", "it"}))]


@router.get("/alerts", response_model=OperationalAlertPage)
async def list_alerts(
    account: AlertReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
) -> OperationalAlertPage:
    try:
        return await list_operational_alerts(db, account, limit=limit, cursor=cursor)
    except ReadCursorError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.patch("/alerts/{alert_code}/status", response_model=OperationalAlertSummary)
async def update_alert_status(
    alert_code: str,
    payload: OperationalAlertStatusUpdate,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperationalAlertSummary:
    alert = await db.scalar(
        select(OperationalAlert).where(OperationalAlert.alert_code == alert_code)
    )
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found.")
    if payload.status == "Resolved" and alert.resolution_mode == "Automatic Health Recovery":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This alert resolves only from authoritative sync-health recovery.",
        )
    previous_status = alert.status
    alert.status = payload.status
    await db.flush([alert])
    await enqueue_operational_resource_event(
        db,
        event_type=(
            "operational_alert.resolved.v2"
            if payload.status == "Resolved"
            else "operational_alert.updated.v2"
        ),
        aggregate_type="operational_alert",
        aggregate_id=alert.id,
        aggregate_version=3 if payload.status == "Resolved" else 2,
        payload={"operationalAlertId": alert.id},
        actor_account_id=actor.id,
    )
    await db.refresh(alert)
    summary = to_operational_alert_summary(alert)
    await create_activity_log(
        db,
        ActivityLogCreate(
            category="IT Activity",
            severity="Success" if payload.status == "Resolved" else "Info",
            actor=actor.display_name,
            actorRole="IT Personnel",
            action=f"Alert {payload.status}",
            target=alert.enterprise or alert.requester,
            summary=f"{actor.display_name} marked {alert.alert_code} as {payload.status}.",
            sourceId=alert.id,
            metadata={"previousStatus": previous_status, "newStatus": payload.status},
        ),
        actor_account_id=actor.id,
    )
    await db.commit()
    return summary
