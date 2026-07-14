import json
from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.features.accounts.models import Account, AccountRole, AccountStatus, SystemConfiguration
from app.features.alerts.models import OperationalAlert
from app.features.alerts.schemas import OperationalAlertSummary
from app.features.assets.models import SupportAttachment
from app.features.assets.storage import AssetStorage, ValidatedImage
from app.features.events.operational_resources import enqueue_operational_resource_event
from app.features.notifications.models import UserNotification
from app.features.notifications.schemas import UserNotificationSummary
from app.features.support.models import SupportTicket, SupportTicketMessage
from app.features.support.schemas import (
    SupportTicketAttachment,
    SupportTicketCreate,
    SupportTicketDetail,
    SupportTicketMessageCreate,
    SupportTicketMessageSummary,
    SupportTicketStatusUpdate,
    SupportTicketSummary,
)
from app.features.topology.account_scope import (
    AccountTopology,
    get_enterprise_account_by_identifier,
    load_account_topology,
    require_account_topology,
)

SYSTEM_SETTINGS_ID = "default"
NOTIFY_FAILED_LOGIN_LOCKOUT_KEY = "notifications.failedLoginLockoutAlerts"


def to_operational_alert_summary(alert: OperationalAlert) -> OperationalAlertSummary:
    return OperationalAlertSummary(
        id=alert.alert_code,
        type=alert.alert_type,  # type: ignore[arg-type]
        severity=alert.severity,  # type: ignore[arg-type]
        enterprise=alert.enterprise,
        requester=alert.requester,
        summary=alert.summary,
        requiredAction=alert.required_action,
        resolutionMode=alert.resolution_mode,  # type: ignore[arg-type]
        status=alert.status,  # type: ignore[arg-type]
        owner=alert.owner,  # type: ignore[arg-type]
        time=alert.created_at.isoformat(),
    )


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
    values = values or {}
    value = values.get(key)
    if isinstance(value, bool):
        return value
    return default


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
    await enqueue_operational_resource_event(
        db,
        event_type="user_notification.created.v2",
        aggregate_type="user_notification",
        aggregate_id=notification.id,
        aggregate_version=1,
        payload={
            "notificationId": notification.id,
            "recipientAccountId": notification.recipient_account_id,
            "recipientRole": notification.recipient_role,
        },
        actor_account_id=actor.id if actor else None,
        enterprise_id=notification.recipient_enterprise_id,
    )
    await db.commit()
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
    notifications: list[UserNotification] = []

    for recipient in recipients:
        notification = UserNotification(
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
        db.add(notification)
        notifications.append(notification)

    if not notifications:
        return []

    await db.flush(notifications)
    for notification in notifications:
        await enqueue_operational_resource_event(
            db,
            event_type="user_notification.created.v2",
            aggregate_type="user_notification",
            aggregate_id=notification.id,
            aggregate_version=1,
            payload={
                "notificationId": notification.id,
                "recipientAccountId": notification.recipient_account_id,
                "recipientRole": notification.recipient_role,
            },
            actor_account_id=actor.id if actor else None,
            enterprise_id=notification.recipient_enterprise_id,
        )
    await db.commit()
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
    await enqueue_operational_resource_event(
        db,
        event_type="user_notification.updated.v2",
        aggregate_type="user_notification",
        aggregate_id=notification.id,
        aggregate_version=2,
        payload={
            "notificationId": notification.id,
            "recipientAccountId": notification.recipient_account_id,
            "recipientRole": notification.recipient_role,
        },
        actor_account_id=account.id,
        enterprise_id=notification.recipient_enterprise_id,
    )
    await db.commit()
    await db.refresh(notification)
    return to_user_notification_summary(notification)


def to_support_ticket_summary(
    ticket: SupportTicket,
    attachments: Sequence[SupportAttachment] = (),
) -> SupportTicketSummary:
    return SupportTicketSummary(
        id=ticket.id,
        code=ticket.ticket_code,
        enterpriseId=ticket.enterprise_id,
        enterpriseName=ticket.enterprise_name,
        submittedBy=ticket.enterprise_name,
        category=ticket.category,
        priority=ticket.priority,
        subject=ticket.subject,
        description=ticket.description,
        affectedArea=ticket.affected_area,
        cameraNode=ticket.camera_node,
        attachments=[ticket_attachment_summary(attachment) for attachment in attachments],
        status=ticket.status,  # type: ignore[arg-type]
        createdAt=ticket.created_at,
        updatedAt=ticket.updated_at,
    )


def ticket_attachment_summary(attachment: SupportAttachment) -> SupportTicketAttachment:
    return SupportTicketAttachment(
        id=attachment.id,
        fileName=attachment.file_name,
        mediaType=attachment.mime_type,  # type: ignore[arg-type]
        sizeBytes=attachment.size_bytes,
        url=f"/operational/tickets/{attachment.ticket_id}/attachments/{attachment.id}",
    )


def to_support_ticket_message_summary(message: SupportTicketMessage) -> SupportTicketMessageSummary:
    return SupportTicketMessageSummary(
        id=message.id,
        ticketId=message.ticket_id,
        authorId=message.author_account_id,
        authorName=message.author_name,
        authorRole=message.author_role,
        message=message.message,
        createdAt=message.created_at,
    )


async def list_support_tickets(
    db: AsyncSession, account: Account, limit: int = 100
) -> list[SupportTicketSummary]:
    statement = select(SupportTicket).order_by(SupportTicket.created_at.desc()).limit(limit)
    if account.role == AccountRole.ENTERPRISE:
        topology = await require_account_topology(db, account)
        statement = statement.where(SupportTicket.enterprise_id == enterprise_identifier(topology))
    tickets = (await db.scalars(statement)).all()
    attachments_by_ticket = await _support_attachments_by_ticket(
        db,
        ticket_ids=[ticket.id for ticket in tickets],
    )
    return [
        to_support_ticket_summary(ticket, attachments_by_ticket.get(ticket.id, ()))
        for ticket in tickets
    ]


async def get_support_ticket_for_account(
    db: AsyncSession, account: Account, ticket_id: str
) -> SupportTicket | None:
    ticket = cast(
        SupportTicket | None,
        await db.scalar(select(SupportTicket).where(SupportTicket.id == ticket_id)),
    )
    if ticket is None:
        return None
    if account.role == AccountRole.ENTERPRISE:
        topology = await require_account_topology(db, account)
        if ticket.enterprise_id != enterprise_identifier(topology):
            return None
    return ticket


async def get_support_ticket_detail(
    db: AsyncSession, account: Account, ticket_id: str
) -> SupportTicketDetail | None:
    ticket = await get_support_ticket_for_account(db, account, ticket_id)
    if ticket is None:
        return None
    message_rows = (
        await db.scalars(
            select(SupportTicketMessage)
            .where(SupportTicketMessage.ticket_id == ticket.id)
            .order_by(SupportTicketMessage.created_at.asc())
        )
    ).all()
    attachments = await _support_attachments_by_ticket(db, ticket_ids=[ticket.id])
    summary = to_support_ticket_summary(ticket, attachments.get(ticket.id, ()))
    return SupportTicketDetail(
        **summary.model_dump(),
        messages=[to_support_ticket_message_summary(message) for message in message_rows],
    )


async def create_support_ticket(
    db: AsyncSession,
    account: Account,
    payload: SupportTicketCreate,
    *,
    storage: AssetStorage,
    images: Sequence[ValidatedImage] = (),
) -> SupportTicketSummary:
    topology = await require_account_topology(db, account)
    ticket_sequence = await db.scalar(text("SELECT nextval('support_ticket_code_seq')"))
    if not isinstance(ticket_sequence, int):
        raise RuntimeError("The support ticket code sequence returned an invalid value.")
    ticket = SupportTicket(
        id=str(uuid4()),
        ticket_code=f"TCK-{ticket_sequence:06d}",
        enterprise_account_id=account.id,
        enterprise_id=enterprise_identifier(topology),
        enterprise_name=enterprise_name(topology),
        category=payload.category,
        priority=payload.priority,
        subject=payload.subject,
        description=payload.description,
        affected_area=payload.affectedArea,
        camera_node=payload.cameraNode,
    )
    db.add(ticket)
    stored_keys: list[str] = []
    attachments: list[SupportAttachment] = []
    try:
        await db.flush([ticket])
        for ordinal, image in enumerate(images):
            attachment_id = str(uuid4())
            storage_key = f"tickets/{ticket.id}/{attachment_id}"
            await storage.put(
                key=storage_key,
                content=image.content,
                max_bytes=image.size_bytes,
            )
            stored_keys.append(storage_key)
            attachment = SupportAttachment(
                id=attachment_id,
                ticket_id=ticket.id,
                ordinal=ordinal,
                storage_key=storage_key,
                file_name=image.file_name,
                mime_type=image.mime_type,
                size_bytes=image.size_bytes,
                content_hash=image.content_hash,
                status="active",
            )
            attachments.append(attachment)
            db.add(attachment)
        await db.commit()
    except Exception:
        await db.rollback()
        for storage_key in stored_keys:
            try:
                await storage.delete(key=storage_key)
            except Exception:
                pass
        raise
    await db.refresh(ticket)
    return to_support_ticket_summary(ticket, attachments)


async def get_support_attachment_for_account(
    db: AsyncSession,
    account: Account,
    *,
    ticket_id: str,
    attachment_id: str,
) -> SupportAttachment | None:
    ticket = await get_support_ticket_for_account(db, account, ticket_id)
    if ticket is None:
        return None
    return cast(
        SupportAttachment | None,
        await db.scalar(
            select(SupportAttachment).where(
                SupportAttachment.id == attachment_id,
                SupportAttachment.ticket_id == ticket.id,
                SupportAttachment.status == "active",
            )
        ),
    )


async def _support_attachments_by_ticket(
    db: AsyncSession,
    *,
    ticket_ids: Sequence[str],
) -> dict[str, tuple[SupportAttachment, ...]]:
    if not ticket_ids:
        return {}
    rows = list(
        await db.scalars(
            select(SupportAttachment)
            .where(
                SupportAttachment.ticket_id.in_(ticket_ids),
                SupportAttachment.status == "active",
            )
            .order_by(SupportAttachment.ticket_id, SupportAttachment.ordinal)
        )
    )
    grouped: dict[str, list[SupportAttachment]] = defaultdict(list)
    for attachment in rows:
        grouped[attachment.ticket_id].append(attachment)
    return {ticket_id: tuple(items) for ticket_id, items in grouped.items()}


async def create_support_ticket_message(
    db: AsyncSession,
    ticket: SupportTicket,
    author: Account,
    payload: SupportTicketMessageCreate,
    *,
    commit: bool = True,
) -> SupportTicketDetail:
    detail, _ = await create_support_ticket_message_with_record(
        db,
        ticket,
        author,
        payload,
        commit=commit,
    )
    return detail


async def create_support_ticket_message_with_record(
    db: AsyncSession,
    ticket: SupportTicket,
    author: Account,
    payload: SupportTicketMessageCreate,
    *,
    commit: bool = True,
) -> tuple[SupportTicketDetail, SupportTicketMessage]:
    ticket = await _lock_support_ticket(db, ticket.id)
    message = SupportTicketMessage(
        ticket_id=ticket.id,
        author_account_id=author.id,
        author_name=author.display_name,
        author_role=author.role.value,
        message=payload.message,
    )
    db.add(message)
    reopened = author.role == AccountRole.ENTERPRISE and ticket.status == "Resolved"
    if reopened:
        ticket.status = "Open"
    elif author.role == AccountRole.IT and ticket.status == "Open":
        ticket.status = "In Review"
    if reopened:
        await _set_support_attachment_retention(db, ticket_id=ticket.id, expires_at=None)
    if commit:
        await db.commit()
    else:
        await db.flush()
    await db.refresh(ticket)
    await db.refresh(message)
    detail = await get_support_ticket_detail(db, author, ticket.id)
    if detail is None:
        raise RuntimeError("Support ticket detail disappeared after reply creation.")
    return detail, message


async def update_support_ticket_status(
    db: AsyncSession,
    ticket: SupportTicket,
    actor: Account,
    payload: SupportTicketStatusUpdate,
) -> SupportTicketDetail:
    ticket = await _lock_support_ticket(db, ticket.id)
    ticket.status = payload.status
    expires_at = (
        datetime.now(UTC) + timedelta(days=get_settings().support_attachment_retention_days)
        if payload.status == "Resolved"
        else None
    )
    await _set_support_attachment_retention(
        db,
        ticket_id=ticket.id,
        expires_at=expires_at,
    )
    await db.commit()
    await db.refresh(ticket)
    detail = await get_support_ticket_detail(db, actor, ticket.id)
    if detail is None:
        raise RuntimeError("Support ticket detail disappeared after status update.")
    return detail


async def _set_support_attachment_retention(
    db: AsyncSession,
    *,
    ticket_id: str,
    expires_at: datetime | None,
) -> None:
    await db.execute(
        update(SupportAttachment)
        .where(
            SupportAttachment.ticket_id == ticket_id,
            SupportAttachment.status == "active",
        )
        .values(retention_expires_at=expires_at)
    )


async def _lock_support_ticket(db: AsyncSession, ticket_id: str) -> SupportTicket:
    ticket = await db.scalar(
        select(SupportTicket)
        .where(SupportTicket.id == ticket_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if ticket is None:
        raise RuntimeError("Support ticket disappeared before its transaction was locked.")
    return ticket


async def get_enterprise_notification_recipient(
    db: AsyncSession, enterprise_id: str
) -> Account | None:
    return await get_enterprise_account_by_identifier(db, enterprise_id)


async def create_operational_alert(
    db: AsyncSession,
    *,
    alert_type: str,
    severity: str,
    requester: str,
    summary: str,
    required_action: str,
    resolution_mode: str,
    owner: str,
    enterprise: str | None = None,
    source_id: str | None = None,
) -> OperationalAlert:
    if source_id:
        existing = await db.scalar(
            select(OperationalAlert).where(
                OperationalAlert.source_id == source_id,
                OperationalAlert.alert_type == alert_type,
                OperationalAlert.status != "Resolved",
            )
        )
        if existing is not None:
            existing.severity = severity
            existing.summary = summary
            existing.required_action = required_action
            await db.flush([existing])
            await enqueue_operational_resource_event(
                db,
                event_type="operational_alert.updated.v2",
                aggregate_type="operational_alert",
                aggregate_id=existing.id,
                aggregate_version=2,
                payload={"operationalAlertId": existing.id},
                actor_account_id=None,
            )
            await db.commit()
            await db.refresh(existing)
            return existing

    alert_sequence = await db.scalar(text("SELECT nextval('operational_alert_code_seq')"))
    if not isinstance(alert_sequence, int):
        raise RuntimeError("The operational alert code sequence returned an invalid value.")
    alert = OperationalAlert(
        alert_code=f"ALT-{alert_sequence:06d}",
        alert_type=alert_type,
        severity=severity,
        enterprise=enterprise,
        requester=requester,
        summary=summary,
        required_action=required_action,
        resolution_mode=resolution_mode,
        owner=owner,
        source_id=source_id,
    )
    db.add(alert)
    await db.flush([alert])
    await enqueue_operational_resource_event(
        db,
        event_type="operational_alert.created.v2",
        aggregate_type="operational_alert",
        aggregate_id=alert.id,
        aggregate_version=1,
        payload={"operationalAlertId": alert.id},
        actor_account_id=None,
    )
    await db.commit()
    await db.refresh(alert)
    return alert


async def list_operational_alerts(db: AsyncSession) -> list[OperationalAlertSummary]:
    result = await db.scalars(select(OperationalAlert).order_by(OperationalAlert.created_at.desc()))
    return [to_operational_alert_summary(alert) for alert in result]


def can_view_operational_event(role: str, event_type: str) -> bool:
    if event_type == "resource.invalidated":
        return role in {item.value for item in AccountRole}
    return False


def enterprise_identifier(topology: AccountTopology) -> str:
    return topology.enterprise.official_code


def enterprise_name(topology: AccountTopology) -> str:
    return topology.enterprise.name


def format_timestamp(value: datetime) -> str:
    return _aware(value).strftime("%b %d, %Y %I:%M %p")


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value
