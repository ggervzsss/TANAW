import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import cast

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
    SystemConfiguration,
)
from app.features.notifications.models import UserNotification
from app.features.notifications.schemas import UserNotificationSummary

SYSTEM_SETTINGS_ID = "default"
NOTIFY_CAMERA_SESSION_ERROR_KEY = "notifications.cameraSessionErrorAlerts"
NOTIFY_GATEWAY_SERVICE_ERROR_KEY = "notifications.gatewayServiceErrorAlerts"
NOTIFY_SYNC_DELAY_KEY = "notifications.syncDelayAlerts"
NOTIFY_FAILED_LOGIN_LOCKOUT_KEY = "notifications.failedLoginLockoutAlerts"
STAFF_REPORT_SUBMITTED_NOTIFICATION = "Enterprise Report Submitted"
STAFF_REPORT_RESUBMITTED_NOTIFICATION = "Enterprise Report Resubmitted"
STAFF_REPORT_NOTIFICATION_TYPES = (
    STAFF_REPORT_SUBMITTED_NOTIFICATION,
    STAFF_REPORT_RESUBMITTED_NOTIFICATION,
)


def to_user_notification_summary(
    notification: UserNotification, recipient: Account | None = None
) -> UserNotificationSummary:
    profile = recipient.enterprise_profile if recipient else None
    return UserNotificationSummary(
        id=notification.id,
        recipientAccountId=notification.recipient_account_id,
        title=notification.title,
        message=notification.message,
        type=notification.notification_type,
        severity=notification.severity,  # type: ignore[arg-type]
        sourceType=notification.source_type,
        sourceId=notification.source_id,
        createdBy=notification.created_by_name,
        recipientRole=notification.recipient_role,
        recipientEnterpriseId=profile.enterprise_id if profile else None,
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
    values = values or {}
    value = values.get(key)
    if isinstance(value, bool):
        return value
    return default


async def list_user_notifications(
    db: AsyncSession, account: Account
) -> list[UserNotificationSummary]:
    statement = select(UserNotification).where(UserNotification.recipient_account_id == account.id)
    if account.role == AccountRole.STAFF:
        statement = statement.where(
            UserNotification.source_type == "enterprise.report",
            UserNotification.notification_type.in_(STAFF_REPORT_NOTIFICATION_TYPES),
        )
    result = await db.scalars(statement.order_by(UserNotification.created_at.desc()).limit(100))
    return [to_user_notification_summary(notification, account) for notification in result]


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
    notification = UserNotification(
        recipient_account_id=recipient.id,
        recipient_role=recipient.role.value,
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
    await db.flush()
    await db.refresh(notification)
    return to_user_notification_summary(notification, recipient)


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
    replace_existing_for_source: bool = False,
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
    notifications: list[UserNotification] = []

    for recipient in recipients:
        notification = None
        if replace_existing_for_source and source_type and source_id:
            notification = await db.scalar(
                select(UserNotification).where(
                    UserNotification.recipient_account_id == recipient.id,
                    UserNotification.source_type == source_type,
                    UserNotification.source_id == source_id,
                )
            )
        if notification is None:
            notification = UserNotification(
                recipient_account_id=recipient.id,
                recipient_role=recipient.role.value,
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
        else:
            notification.title = title
            notification.message = message
            notification.notification_type = notification_type
            notification.severity = severity
            notification.created_by_account_id = actor.id if actor else None
            notification.created_by_name = actor.display_name if actor else None
            notification.read_at = None
            notification.created_at = datetime.now(UTC)
        notifications.append(notification)

    if not notifications:
        return []

    await db.flush()
    for notification in notifications:
        await db.refresh(notification)
    return [
        to_user_notification_summary(notification, recipient)
        for notification, recipient in zip(notifications, recipients, strict=True)
    ]


async def mark_source_notifications_read(
    db: AsyncSession,
    *,
    source_type: str,
    source_id: str,
    recipient_role: AccountRole | None = None,
) -> list[UserNotificationSummary]:
    statement = select(UserNotification).where(
        UserNotification.source_type == source_type,
        UserNotification.source_id == source_id,
        UserNotification.read_at.is_(None),
    )
    if recipient_role is not None:
        statement = statement.where(UserNotification.recipient_role == recipient_role.value)
    notifications = list((await db.scalars(statement)).all())
    if not notifications:
        return []
    resolved_at = datetime.now(UTC)
    for notification in notifications:
        notification.read_at = resolved_at
    await db.flush()
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
    await db.flush()
    await db.refresh(notification)
    return to_user_notification_summary(notification, account)


async def get_enterprise_notification_recipient(
    db: AsyncSession, enterprise_id: str
) -> Account | None:
    return cast(
        Account | None,
        await db.scalar(
            select(Account).where(
                Account.role == AccountRole.ENTERPRISE,
                or_(
                    Account.id == enterprise_id,
                    Account.enterprise_profile.has(
                        EnterpriseProfile.enterprise_id == enterprise_id
                    ),
                ),
            )
        ),
    )
