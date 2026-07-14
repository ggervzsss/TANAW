import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole, AccountStatus, SystemConfiguration
from app.features.events.operational_resources import enqueue_operational_resource_event
from app.features.notifications.models import UserNotification
from app.features.notifications.schemas import UserNotificationSummary
from app.features.topology.account_scope import (
    get_enterprise_account_by_identifier,
    load_account_topology,
)

SYSTEM_SETTINGS_ID = "default"
NOTIFY_FAILED_LOGIN_LOCKOUT_KEY = "notifications.failedLoginLockoutAlerts"


def to_user_notification_summary(notification: UserNotification) -> UserNotificationSummary:
    return UserNotificationSummary(
        id=notification.id,
        recipientAccountId=notification.recipient_account_id,
        title=notification.title,
        message=notification.message,
        type=notification.notification_type,
        severity=notification.severity,  # type: ignore[arg-type]
        sourceType=notification.source_type,
        sourceId=notification.source_id,
        targetPath=(
            notification.source_id
            if notification.source_id and notification.source_id.startswith("/")
            else None
        ),
        createdBy=notification.created_by_name,
        recipientRole=notification.recipient_role,
        recipientEnterpriseId=notification.recipient_enterprise_id,
        createdAt=notification.created_at.isoformat(),
        readAt=notification.read_at.isoformat() if notification.read_at else None,
    )


async def system_setting_enabled(db: AsyncSession, key: str, *, default: bool = True) -> bool:
    record = await db.scalar(
        select(SystemConfiguration).where(SystemConfiguration.id == SYSTEM_SETTINGS_ID)
    )
    if record is None:
        return default
    try:
        values = json.loads(record.values_json)
    except json.JSONDecodeError:
        return default
    return resolve_system_setting_enabled(
        values if isinstance(values, dict) else None, key, default=default
    )


def resolve_system_setting_enabled(
    values: Mapping[str, object] | None, key: str, *, default: bool = True
) -> bool:
    value = (values or {}).get(key)
    return value if isinstance(value, bool) else default


async def list_user_notifications(
    db: AsyncSession, account: Account
) -> list[UserNotificationSummary]:
    result = await db.scalars(
        select(UserNotification)
        .where(UserNotification.recipient_account_id == account.id)
        .order_by(UserNotification.created_at.desc())
        .limit(100)
    )
    return [to_user_notification_summary(notification) for notification in result]


async def create_user_notification(
    db: AsyncSession,
    *,
    recipient: Account,
    title: str,
    message: str,
    notification_type: str,
    severity: str,
    actor: Account | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
) -> UserNotificationSummary:
    recipient_topology = await load_account_topology(db, recipient)
    notification = UserNotification(
        recipient_account_id=recipient.id,
        recipient_role=recipient.role.value,
        recipient_enterprise_id=(
            recipient_topology.enterprise.id if recipient_topology is not None else None
        ),
        title=title,
        message=message,
        notification_type=notification_type,
        severity=severity,
        source_type=source_type,
        source_id=source_id,
        created_by_account_id=actor.id if actor else None,
        created_by_name=actor.display_name if actor else None,
    )
    db.add(notification)
    await db.flush([notification])
    await _enqueue_notification_event(db, notification, "user_notification.created.v2", 1, actor)
    await db.refresh(notification)
    return to_user_notification_summary(notification)


async def create_role_notifications(
    db: AsyncSession,
    *,
    recipient_roles: Sequence[AccountRole],
    title: str,
    message: str,
    notification_type: str,
    severity: str,
    actor: Account | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
) -> list[UserNotificationSummary]:
    recipients = (
        await db.scalars(
            select(Account)
            .where(
                Account.role.in_(recipient_roles),
                Account.status == AccountStatus.ACTIVE,
                Account.activated_at.is_not(None),
            )
            .order_by(Account.role.asc(), Account.display_name.asc())
        )
    ).all()
    notifications = [
        UserNotification(
            recipient_account_id=recipient.id,
            recipient_role=recipient.role.value,
            recipient_enterprise_id=None,
            title=title,
            message=message,
            notification_type=notification_type,
            severity=severity,
            source_type=source_type,
            source_id=source_id,
            created_by_account_id=actor.id if actor else None,
            created_by_name=actor.display_name if actor else None,
        )
        for recipient in recipients
    ]
    if not notifications:
        return []
    db.add_all(notifications)
    await db.flush(notifications)
    for notification in notifications:
        await _enqueue_notification_event(
            db, notification, "user_notification.created.v2", 1, actor
        )
    for notification in notifications:
        await db.refresh(notification)
    return [to_user_notification_summary(notification) for notification in notifications]


async def get_user_notification(
    db: AsyncSession, account: Account, notification_id: str
) -> UserNotification | None:
    return cast(
        UserNotification | None,
        await db.scalar(
            select(UserNotification).where(
                UserNotification.id == notification_id,
                UserNotification.recipient_account_id == account.id,
            )
        ),
    )


async def set_user_notification_read(
    db: AsyncSession, account: Account, notification_id: str, *, read: bool
) -> UserNotificationSummary | None:
    notification = await get_user_notification(db, account, notification_id)
    if notification is None:
        return None
    notification.read_at = datetime.now(UTC) if read else None
    await db.flush([notification])
    await _enqueue_notification_event(db, notification, "user_notification.updated.v2", 2, account)
    await db.refresh(notification)
    return to_user_notification_summary(notification)


async def get_enterprise_notification_recipient(
    db: AsyncSession, enterprise_id: str
) -> Account | None:
    return await get_enterprise_account_by_identifier(db, enterprise_id)


async def _enqueue_notification_event(
    db: AsyncSession,
    notification: UserNotification,
    event_type: str,
    aggregate_version: int,
    actor: Account | None,
) -> None:
    await enqueue_operational_resource_event(
        db,
        event_type=event_type,
        aggregate_type="user_notification",
        aggregate_id=notification.id,
        aggregate_version=aggregate_version,
        payload={
            "notificationId": notification.id,
            "recipientAccountId": notification.recipient_account_id,
            "recipientRole": notification.recipient_role,
        },
        actor_account_id=actor.id if actor else None,
        enterprise_id=notification.recipient_enterprise_id,
    )
