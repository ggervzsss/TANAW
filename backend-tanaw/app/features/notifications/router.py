from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.enterprise import enterprise_name
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
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
    await create_activity_log(
        db,
        ActivityLogCreate(
            category="Staff Operation",
            severity="Success",
            actor=actor.display_name,
            actorRole="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
            action="Notify Enterprise",
            target=enterprise_name(recipient),
            summary=(
                f"{actor.display_name} notified {enterprise_name(recipient)}: {payload.message}"
            ),
            sourceId=notification.id,
        ),
    )
    return notification
