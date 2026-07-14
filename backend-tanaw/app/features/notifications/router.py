from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.activity_logs.websocket import activity_log_manager
from app.features.notifications.schemas import (
    EnterpriseNotificationCreate,
    NotificationReadUpdate,
    UserNotificationSummary,
)
from app.features.notifications.service import (
    create_user_notification,
    get_enterprise_notification_recipient,
    list_user_notifications,
    set_user_notification_read,
)
from app.features.topology.account_scope import require_account_topology

router = APIRouter(prefix="/operational", tags=["notifications"])
OperationalReadAccount = Annotated[
    Account, Depends(require_roles({"admin", "it", "staff", "enterprise"}))
]
StaffWorkflowAccount = Annotated[Account, Depends(require_roles({"admin", "staff"}))]


@router.get("/notifications", response_model=list[UserNotificationSummary])
async def list_notifications(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[UserNotificationSummary]:
    return await list_user_notifications(db, account)


@router.patch("/notifications/{notification_id}", response_model=UserNotificationSummary)
async def update_notification_read_status(
    notification_id: str,
    payload: NotificationReadUpdate,
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserNotificationSummary:
    notification = await set_user_notification_read(db, account, notification_id, read=payload.read)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")
    await db.commit()
    return notification


@router.post(
    "/notifications/enterprise",
    response_model=UserNotificationSummary,
    status_code=status.HTTP_201_CREATED,
)
async def create_enterprise_notification(
    payload: EnterpriseNotificationCreate,
    actor: StaffWorkflowAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserNotificationSummary:
    recipient = await get_enterprise_notification_recipient(db, payload.enterpriseId)
    if (
        recipient is None
        or recipient.status != AccountStatus.ACTIVE
        or recipient.activated_at is None
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Active enterprise account not found."
        )

    notification = await create_user_notification(
        db,
        recipient=recipient,
        title=payload.title,
        message=payload.message,
        notification_type=payload.type,
        severity=payload.severity,
        actor=actor,
        source_type=payload.sourceType,
        source_id=payload.sourceId,
    )
    recipient_topology = await require_account_topology(db, recipient)
    log = await create_activity_log(
        db,
        ActivityLogCreate(
            category="Staff Operation",
            severity="Success",
            actor=actor.display_name,
            actorRole="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
            action="Notify Enterprise",
            target=recipient_topology.enterprise.name,
            summary=(
                f"{actor.display_name} notified "
                f"{recipient_topology.enterprise.name}: {payload.message}"
            ),
            sourceId=notification.id,
        ),
    )
    await db.commit()
    await activity_log_manager.broadcast(log)
    return notification
