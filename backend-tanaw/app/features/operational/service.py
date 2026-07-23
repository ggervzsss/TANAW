import json
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import ceil
from statistics import fmean
from typing import cast

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import PHILIPPINE_TIME_ZONE
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
    SystemConfiguration,
)
from app.features.accounts.options import format_enterprise_category
from app.features.operational.models import (
    EnterpriseReportSubmission,
    EnterpriseTelemetrySnapshot,
    FinalReport,
    FinalReportSource,
    OperationalAlert,
    SupportTicket,
    SupportTicketMessage,
    UserNotification,
)
from app.features.operational.schemas import (
    DesktopReportSubmissionIngest,
    DesktopTelemetryIngest,
    FinalReportArchivedFromStatus,
    FinalReportCreate,
    FinalReportRevisionReturn,
    FinalReportSourceSummary,
    FinalReportStatusUpdate,
    FinalReportSummary,
    IntakeReportSummary,
    OperationalAlertSummary,
    OperationalAlertUrgency,
    OperationalSummary,
    ReportDemographicsSummary,
    ReportStatusUpdate,
    SupportTicketAttachment,
    SupportTicketCreate,
    SupportTicketDetail,
    SupportTicketMessageCreate,
    SupportTicketMessageSummary,
    SupportTicketStatusUpdate,
    SupportTicketSummary,
    TelemetrySnapshotSummary,
    UserNotificationSummary,
    VisitorInsightEnterprise,
    VisitorInsightPoint,
    VisitorInsightRange,
    VisitorInsightsSummary,
)

STALE_GATEWAY_SECONDS = 120
OFFLINE_GATEWAY_SECONDS = 900
VISITOR_ACTIVITY_BASELINE_DAYS = 35
VISITOR_ACTIVITY_MIN_BASELINE_DAYS = 3
VISITOR_ACTIVITY_TRIGGER_MULTIPLIER = 1.5
VISITOR_ACTIVITY_RECOVERY_MULTIPLIER = 1.2
VISITOR_ACTIVITY_MIN_INCREASE = 10
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
SUPPORT_TICKET_PRIORITY_RANK = {
    "Urgent": 0,
    "High": 1,
    "Normal": 2,
    "Low": 3,
}
FINAL_REPORT_ARCHIVED_STATUS = "Archived"
FINAL_REPORT_RETURNED_STATUS = "Returned for Revision"
FINAL_REPORT_RESTORABLE_STATUSES = {"Draft", "Finalized", FINAL_REPORT_RETURNED_STATUS}
REPORT_DEMOGRAPHIC_FIELDS = (
    "thisProvMale",
    "thisProvFemale",
    "otherProvMale",
    "otherProvFemale",
    "foreignMale",
    "foreignFemale",
)


class DuplicateReportPeriodError(Exception):
    pass


class InvalidReportWorkflowError(Exception):
    pass


@dataclass(frozen=True)
class VisitorActivityCondition:
    typical_occupancy: int
    baseline_days: int
    threshold_count: int
    recovery_count: int
    current_occupancy: int

    @property
    def breached(self) -> bool:
        return self.current_occupancy >= self.threshold_count

    @property
    def recovered(self) -> bool:
        return self.current_occupancy <= self.recovery_count

    @property
    def difference_percent(self) -> int:
        if self.typical_occupancy <= 0:
            return 100 if self.current_occupancy > 0 else 0
        return round(
            (self.current_occupancy - self.typical_occupancy) / self.typical_occupancy * 100
        )


def to_operational_alert_summary(alert: OperationalAlert) -> OperationalAlertSummary:
    return OperationalAlertSummary(
        id=alert.alert_code,
        type=alert.alert_type,  # type: ignore[arg-type]
        severity=alert.severity,  # type: ignore[arg-type]
        urgency=operational_alert_urgency(alert.severity),
        enterprise=alert.enterprise,
        requester=alert.requester,
        summary=alert.summary,
        requiredAction=alert.required_action,
        resolutionMode=alert.resolution_mode,  # type: ignore[arg-type]
        status=alert.status,  # type: ignore[arg-type]
        owner=alert.owner,  # type: ignore[arg-type]
        time=alert.created_at.isoformat(),
    )


def operational_alert_urgency(severity: str) -> OperationalAlertUrgency:
    if severity == "Critical":
        return "Urgent"
    if severity == "Warning":
        return "Important"
    return "Normal"


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
    await db.commit()
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

    await db.commit()
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
    await db.commit()
    await db.refresh(notification)
    return to_user_notification_summary(notification, account)


def to_support_ticket_summary(ticket: SupportTicket) -> SupportTicketSummary:
    return SupportTicketSummary(
        id=ticket.id,
        code=ticket.ticket_code,
        enterpriseId=ticket.enterprise_profile.enterprise_id,
        enterpriseName=ticket.enterprise_name,
        submittedBy=ticket.enterprise_name,
        category=ticket.category,
        priority=ticket.priority,
        subject=ticket.subject,
        description=ticket.description,
        affectedArea=ticket.affected_area,
        cameraNode=ticket.camera_node,
        attachments=ticket_attachment_summaries(ticket),
        status=ticket.status,  # type: ignore[arg-type]
        createdAt=ticket.created_at,
        updatedAt=ticket.updated_at,
    )


def ticket_attachment_summaries(ticket: SupportTicket) -> list[SupportTicketAttachment]:
    attachments = parse_ticket_attachments(ticket.attachments_json)
    return [
        attachment.model_copy(
            update={
                "id": f"{ticket.id}:{index}",
                "url": f"/operational/tickets/{ticket.id}/attachments/{index}",
            }
        )
        for index, attachment in enumerate(attachments)
    ]


def parse_ticket_attachments(value: str | None) -> list[SupportTicketAttachment]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    attachments: list[SupportTicketAttachment] = []
    for item in parsed:
        try:
            attachments.append(SupportTicketAttachment.model_validate(item))
        except ValueError:
            continue
    return attachments


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
    resolved_rank = case((SupportTicket.status == "Resolved", 1), else_=0)
    priority_rank = case(
        (SupportTicket.status == "Resolved", 0),
        *(
            (SupportTicket.priority == priority, rank)
            for priority, rank in SUPPORT_TICKET_PRIORITY_RANK.items()
        ),
        else_=len(SUPPORT_TICKET_PRIORITY_RANK),
    )
    workflow_rank = case(
        (SupportTicket.status == "Resolved", 0),
        (SupportTicket.status == "Open", 0),
        (SupportTicket.status == "In Review", 1),
        else_=2,
    )
    authoritative_activity_at = case(
        (SupportTicket.status == "Resolved", SupportTicket.updated_at),
        else_=SupportTicket.created_at,
    )
    statement = (
        select(SupportTicket)
        .order_by(
            resolved_rank.asc(),
            priority_rank.asc(),
            workflow_rank.asc(),
            authoritative_activity_at.desc(),
            SupportTicket.ticket_code.asc(),
            SupportTicket.id.asc(),
        )
        .limit(limit)
    )
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(SupportTicket.enterprise_profile_id == account.id)
    elif account.role == AccountRole.ADMIN:
        statement = statement.where(SupportTicket.priority.in_({"High", "Urgent"}))
    tickets = (await db.scalars(statement)).all()
    return [to_support_ticket_summary(ticket) for ticket in tickets]


async def get_support_ticket_for_account(
    db: AsyncSession,
    account: Account,
    ticket_id: str,
    *,
    for_update: bool = False,
) -> SupportTicket | None:
    statement = select(SupportTicket).where(SupportTicket.id == ticket_id)
    if for_update:
        statement = statement.with_for_update(of=SupportTicket).execution_options(
            populate_existing=True
        )
    ticket = cast(
        SupportTicket | None,
        await db.scalar(statement),
    )
    if ticket is None:
        return None
    if account.role == AccountRole.ENTERPRISE and ticket.enterprise_profile_id != account.id:
        return None
    if account.role == AccountRole.ADMIN and ticket.priority not in {"High", "Urgent"}:
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
    summary = to_support_ticket_summary(ticket)
    return SupportTicketDetail(
        **summary.model_dump(),
        messages=[to_support_ticket_message_summary(message) for message in message_rows],
    )


async def create_support_ticket(
    db: AsyncSession,
    account: Account,
    payload: SupportTicketCreate,
    *,
    commit: bool = True,
) -> SupportTicketSummary:
    ticket_count = await db.scalar(select(func.count()).select_from(SupportTicket))
    ticket = SupportTicket(
        ticket_code=f"TCK-{int(ticket_count or 0) + 1:06d}",
        enterprise_profile_id=account.id,
        enterprise_name=enterprise_name(account),
        category=payload.category,
        priority=payload.priority,
        subject=payload.subject,
        description=payload.description,
        affected_area=payload.affectedArea,
        camera_node=payload.cameraNode,
        attachments_json=json.dumps(
            [attachment.model_dump(mode="json") for attachment in payload.attachments],
            sort_keys=True,
        )
        if payload.attachments
        else None,
    )
    db.add(ticket)
    if commit:
        await db.commit()
    else:
        await db.flush()
    await db.refresh(ticket)
    return to_support_ticket_summary(ticket)


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
    if ticket.status == "Resolved":
        raise ResolvedTicketConversationError
    message = SupportTicketMessage(
        ticket_id=ticket.id,
        author_account_id=author.id,
        author_name=author.display_name,
        author_role=author.role.value,
        message=payload.message,
    )
    db.add(message)
    if author.role == AccountRole.IT and ticket.status == "Open":
        ticket.status = "In Review"
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


class ResolvedTicketConversationError(ValueError):
    """Raised when a message is submitted after a ticket conversation is closed."""


async def update_support_ticket_status(
    db: AsyncSession,
    ticket: SupportTicket,
    actor: Account,
    payload: SupportTicketStatusUpdate,
) -> SupportTicketDetail:
    ticket.status = payload.status
    await db.commit()
    await db.refresh(ticket)
    detail = await get_support_ticket_detail(db, actor, ticket.id)
    if detail is None:
        raise RuntimeError("Support ticket detail disappeared after status update.")
    return detail


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
            await db.commit()
            await db.refresh(existing)
            return existing

    count = await db.scalar(select(func.count()).select_from(OperationalAlert))
    alert = OperationalAlert(
        alert_code=f"ALT-{int(count or 0) + 1:06d}",
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
    await db.commit()
    await db.refresh(alert)
    return alert


async def get_active_operational_alert(
    db: AsyncSession, *, alert_type: str, source_id: str
) -> OperationalAlert | None:
    return cast(
        OperationalAlert | None,
        await db.scalar(
            select(OperationalAlert).where(
                OperationalAlert.source_id == source_id,
                OperationalAlert.alert_type == alert_type,
                OperationalAlert.status != "Resolved",
            )
        ),
    )


async def resolve_operational_alert(
    db: AsyncSession,
    *,
    alert_type: str,
    source_id: str,
    recovery_message: str,
) -> OperationalAlert | None:
    alert = await get_active_operational_alert(db, alert_type=alert_type, source_id=source_id)
    if alert is None:
        return None
    alert.status = "Resolved"
    if recovery_message not in alert.summary:
        alert.summary = f"{alert.summary} {recovery_message}"
    await db.commit()
    await db.refresh(alert)
    return alert


async def list_operational_alerts(
    db: AsyncSession, account: Account
) -> list[OperationalAlertSummary]:
    statement = select(OperationalAlert)
    if account.role == AccountRole.ADMIN:
        statement = statement.where(OperationalAlert.owner.in_({"Admin", "System"}))
    elif account.role == AccountRole.IT:
        statement = statement.where(OperationalAlert.owner.in_({"IT", "System"}))
    result = await db.scalars(statement.order_by(OperationalAlert.created_at.desc()))
    return [to_operational_alert_summary(alert) for alert in result]


def can_manage_operational_alert(account: Account, alert: OperationalAlert) -> bool:
    if account.role == AccountRole.ADMIN:
        return alert.owner == "Admin"
    if account.role == AccountRole.IT:
        return alert.owner == "IT"
    return False


def can_view_operational_event(role: str, event_type: str) -> bool:
    notification_events = {"notification.created", "notification.updated"}
    if role == AccountRole.ADMIN.value:
        return True
    if role == AccountRole.IT.value:
        return (
            event_type
            in {
                "telemetry.snapshot",
                "summary.updated",
                "alert.created",
                "alert.updated",
                "alert.resolved",
            }
            | notification_events
        )
    if role == AccountRole.STAFF.value:
        return (
            event_type
            in {
                "report.submitted",
                "report.updated",
                "summary.updated",
                "final_report.generated",
                "final_report.updated",
            }
            | notification_events
        )
    if role == AccountRole.ENTERPRISE.value:
        return event_type in {"report.updated", "notification.created", "notification.updated"}
    return False


def visitor_activity_condition(
    current_occupancy: int,
    baseline_occupancies: Sequence[int | float],
) -> VisitorActivityCondition | None:
    if len(baseline_occupancies) < VISITOR_ACTIVITY_MIN_BASELINE_DAYS:
        return None
    typical_occupancy = max(0, round(fmean(baseline_occupancies)))
    threshold_count = max(
        typical_occupancy + VISITOR_ACTIVITY_MIN_INCREASE,
        ceil(typical_occupancy * VISITOR_ACTIVITY_TRIGGER_MULTIPLIER),
    )
    recovery_count = max(
        typical_occupancy,
        ceil(typical_occupancy * VISITOR_ACTIVITY_RECOVERY_MULTIPLIER),
    )
    return VisitorActivityCondition(
        typical_occupancy=typical_occupancy,
        baseline_days=len(baseline_occupancies),
        threshold_count=threshold_count,
        recovery_count=recovery_count,
        current_occupancy=max(0, current_occupancy),
    )


async def load_matching_visitor_baseline(
    db: AsyncSession,
    enterprise_profile_id: str,
    reference_time: datetime,
) -> list[float]:
    reference = _aware(reference_time)
    local_reference = reference.astimezone(PHILIPPINE_TIME_ZONE)
    local_timestamp = func.timezone(
        str(PHILIPPINE_TIME_ZONE), EnterpriseTelemetrySnapshot.captured_at
    )
    local_day = func.date_trunc("day", local_timestamp)
    weekday = (local_reference.weekday() + 1) % 7
    statement = (
        select(func.avg(EnterpriseTelemetrySnapshot.current_occupancy))
        .where(
            EnterpriseTelemetrySnapshot.enterprise_profile_id == enterprise_profile_id,
            EnterpriseTelemetrySnapshot.captured_at
            >= reference - timedelta(days=VISITOR_ACTIVITY_BASELINE_DAYS),
            EnterpriseTelemetrySnapshot.captured_at < reference - timedelta(days=1),
            func.extract("dow", local_timestamp) == weekday,
            func.extract("hour", local_timestamp) == local_reference.hour,
        )
        .group_by(local_day)
        .order_by(local_day.desc())
    )
    return [float(value) for value in (await db.scalars(statement)).all()]


async def evaluate_telemetry_alerts(
    db: AsyncSession,
    account: Account,
    payload: DesktopTelemetryIngest,
    *,
    baseline_occupancies: Sequence[int | float] | None = None,
) -> list[tuple[str, OperationalAlertSummary]]:
    source_id = f"visitor-activity:{account.id}"
    existing = await db.scalar(
        select(OperationalAlert).where(
            OperationalAlert.source_id == source_id,
            OperationalAlert.alert_type == "Foot Traffic Alert",
            OperationalAlert.status != "Resolved",
        )
    )
    reference_time = payload.capturedAt or payload.metrics.lastEventAt or datetime.now(UTC)
    baseline = (
        list(baseline_occupancies)
        if baseline_occupancies is not None
        else await load_matching_visitor_baseline(db, account.id, reference_time)
    )
    condition = visitor_activity_condition(payload.metrics.currentOccupancy, baseline)

    if condition is not None and condition.breached:
        if existing is not None:
            return []

        enterprise = enterprise_name(account)
        local_reference = _aware(reference_time).astimezone(PHILIPPINE_TIME_ZONE)
        period_label = format_visitor_period(local_reference)
        alert = await create_operational_alert(
            db,
            alert_type="Foot Traffic Alert",
            severity="Critical" if condition.difference_percent >= 100 else "Warning",
            requester=enterprise,
            enterprise=enterprise,
            summary=(
                f"{enterprise} currently has {condition.current_occupancy} visitors, compared "
                f"with its usual {condition.typical_occupancy} around {period_label}."
            ),
            required_action=(
                "Review the live map and coordinate with the establishment, traffic team, or "
                "public-safety personnel if support is needed."
            ),
            resolution_mode="Admin Monitoring",
            owner="Admin",
            source_id=source_id,
        )
        return [("alert.created", to_operational_alert_summary(alert))]

    should_resolve = existing is not None and (condition is None or condition.recovered)
    if should_resolve and existing is not None:
        existing.status = "Resolved"
        existing.summary = (
            f"{existing.summary} The latest visitor level has returned to its usual range."
        )
        await db.commit()
        await db.refresh(existing)
        return [("alert.resolved", to_operational_alert_summary(existing))]

    return []


def format_visitor_period(value: datetime) -> str:
    return value.strftime("%A at %I %p").replace(" at 0", " at ")


async def ingest_telemetry(
    db: AsyncSession,
    account: Account,
    payload: DesktopTelemetryIngest,
    *,
    update_account_gateway: bool = True,
) -> TelemetrySnapshotSummary:
    captured_at = payload.capturedAt or payload.metrics.lastEventAt or datetime.now(UTC)
    if captured_at.tzinfo is None:
        captured_at = captured_at.replace(tzinfo=UTC)

    profile = require_enterprise_profile(account)
    snapshot = EnterpriseTelemetrySnapshot(
        enterprise_profile_id=profile.account_id,
        enterprise_name=profile.enterprise_name,
        camera_id=str(payload.session.cameraId) if payload.session.cameraId is not None else None,
        camera_name=payload.session.cameraName,
        captured_at=captured_at,
        entries=payload.metrics.entries,
        exits=payload.metrics.exits,
        current_occupancy=payload.metrics.currentOccupancy,
        peak_occupancy=payload.metrics.peakOccupancy,
        unique_count=payload.metrics.uniqueCount,
        confirmed_unique_count=payload.metrics.confirmedUniqueCount,
        degraded_unique_count=payload.metrics.degradedUniqueCount,
        total_events=payload.metrics.totalEvents,
        unsubmitted_events=payload.metrics.unsubmittedEvents,
        unsynced_events=payload.metrics.unsyncedEvents,
        running=payload.session.running,
        status=payload.session.status,
        error=payload.session.error,
        analytics_fps=payload.health.analyticsFps,
        payload_json=json.dumps(payload.model_dump(mode="json"), sort_keys=True),
    )
    db.add(snapshot)
    if update_account_gateway:
        profile.gateway_status = (
            "Offline" if snapshot.error or snapshot.status == "error" else "Connected"
        )
        if payload.deviceId:
            profile.gateway_id = payload.deviceId
    await db.commit()
    await db.refresh(snapshot)
    return to_telemetry_summary(snapshot, account)


async def ingest_report_submission(
    db: AsyncSession, account: Account, payload: DesktopReportSubmissionIngest
) -> IntakeReportSummary:
    profile = require_enterprise_profile(account)
    result = await db.scalars(
        select(EnterpriseReportSubmission).where(
            EnterpriseReportSubmission.enterprise_profile_id == profile.account_id,
            EnterpriseReportSubmission.report_id == payload.reportId,
        )
    )
    existing = result.first()
    duplicate_period = await db.scalar(
        select(EnterpriseReportSubmission).where(
            EnterpriseReportSubmission.enterprise_profile_id == profile.account_id,
            EnterpriseReportSubmission.period == payload.period,
            EnterpriseReportSubmission.report_id != payload.reportId,
        )
    )
    if duplicate_period is not None:
        raise DuplicateReportPeriodError(
            f"A report for {payload.period} has already been submitted."
        )
    report_status = status_from_payload(payload.payload)
    month = month_from_submission(payload.period, payload.submittedAt)

    if existing is None:
        report = EnterpriseReportSubmission(
            report_id=payload.reportId,
            enterprise_profile_id=profile.account_id,
            enterprise_name=profile.enterprise_name,
            category=format_enterprise_category(profile.category) or "Uncategorized",
            barangay=profile.barangay or "Unassigned",
            period=payload.period,
            month=month,
            submitted_at=_aware(payload.submittedAt),
            entries=payload.entries,
            exits=payload.exits,
            peak_occupancy=payload.peakOccupancy,
            unique_count=payload.uniqueCount,
            status=report_status,
            review_status="Pending Review",
            notes=payload.notes,
            sync_status=payload.syncStatus,
            payload_json=json.dumps(payload.payload or {}, sort_keys=True),
        )
        db.add(report)
    else:
        report = existing
        report.enterprise_profile_id = profile.account_id
        report.enterprise_name = profile.enterprise_name
        report.category = format_enterprise_category(profile.category) or "Uncategorized"
        report.barangay = profile.barangay or "Unassigned"
        report.period = payload.period
        report.month = month
        report.submitted_at = _aware(payload.submittedAt)
        report.entries = payload.entries
        report.exits = payload.exits
        report.peak_occupancy = payload.peakOccupancy
        report.unique_count = payload.uniqueCount
        report.status = report_status
        report.notes = payload.notes
        report.sync_status = payload.syncStatus
        report.payload_json = json.dumps(payload.payload or {}, sort_keys=True)
        if report.review_status == "Returned" and report_status in {"Submitted", "Resubmitted"}:
            report.review_status = "Pending Review"

    profile.gateway_status = "Connected"
    await db.commit()
    await db.refresh(report)
    return to_intake_report_summary(report)


async def list_latest_telemetry(
    db: AsyncSession, account: Account | None, limit: int = 500
) -> list[TelemetrySnapshotSummary]:
    latest_ranked_snapshot = select(
        EnterpriseTelemetrySnapshot.id.label("snapshot_id"),
        func.row_number()
        .over(
            partition_by=EnterpriseTelemetrySnapshot.enterprise_profile_id,
            order_by=EnterpriseTelemetrySnapshot.received_at.desc(),
        )
        .label("snapshot_rank"),
    ).subquery()
    statement = (
        select(EnterpriseTelemetrySnapshot)
        .join(
            latest_ranked_snapshot,
            EnterpriseTelemetrySnapshot.id == latest_ranked_snapshot.c.snapshot_id,
        )
        .where(latest_ranked_snapshot.c.snapshot_rank == 1)
        .order_by(EnterpriseTelemetrySnapshot.received_at.desc())
        .limit(limit)
    )
    if account is not None and account.role == AccountRole.ENTERPRISE:
        statement = statement.where(EnterpriseTelemetrySnapshot.enterprise_profile_id == account.id)

    snapshots = (await db.scalars(statement)).all()
    accounts = await enterprise_accounts_by_id(db)

    return [
        to_telemetry_summary(snapshot, accounts.get(snapshot.enterprise_profile_id))
        for snapshot in snapshots
    ]


@dataclass(frozen=True)
class HourlyVisitorObservation:
    enterprise_profile_id: str
    enterprise_id: str
    enterprise_name: str
    barangay: str
    start_at: datetime
    average_visitors: float
    peak_visitors: int


async def get_visitor_insights(
    db: AsyncSession,
    range_value: VisitorInsightRange,
    *,
    enterprise_id: str | None = None,
    barangay: str | None = None,
    now: datetime | None = None,
) -> VisitorInsightsSummary:
    current_time = _aware(now or datetime.now(UTC))
    local_now = current_time.astimezone(PHILIPPINE_TIME_ZONE)
    observations = await load_hourly_visitor_observations(db, current_time)
    latest = await list_latest_telemetry(db, None)

    if enterprise_id:
        observations = [item for item in observations if item.enterprise_id == enterprise_id]
        latest = [item for item in latest if item.enterpriseId == enterprise_id]
        scope_type = "enterprise"
        scope_id = enterprise_id
        scope_name = next(
            (item.enterprise_name for item in observations),
            next((item.enterpriseName for item in latest), "Selected establishment"),
        )
    elif barangay:
        normalized_barangay = barangay.strip().casefold()
        observations = [
            item for item in observations if item.barangay.casefold() == normalized_barangay
        ]
        latest = [
            item
            for item in latest
            if (item.barangay or "Unassigned").casefold() == normalized_barangay
        ]
        scope_type = "barangay"
        scope_id = barangay
        scope_name = f"Barangay {barangay}"
    else:
        scope_type = "city"
        scope_id = None
        scope_name = "San Pedro"

    baselines = visitor_baselines_by_enterprise(observations, local_now)
    enterprise_insights = [
        visitor_enterprise_insight(item, baselines.get(item.enterpriseId, [])) for item in latest
    ]
    enterprise_insights.sort(key=lambda item: item.currentVisitors, reverse=True)
    current_visitors = sum(item.currentVisitors for item in enterprise_insights)
    has_complete_baseline = bool(enterprise_insights) and all(
        item.typicalVisitors is not None for item in enterprise_insights
    )
    typical_visitors = (
        sum(item.typicalVisitors or 0 for item in enterprise_insights)
        if has_complete_baseline
        else None
    )
    difference_percent = visitor_difference_percent(current_visitors, typical_visitors)
    series = visitor_insight_series(observations, range_value, local_now)
    unusually_busy = [
        item for item in enterprise_insights if item.activityLevel == "Busier Than Usual"
    ]
    busiest_period = max(series, key=lambda item: item.averageVisitors, default=None)

    return VisitorInsightsSummary(
        range=range_value,
        scopeType=scope_type,  # type: ignore[arg-type]
        scopeId=scope_id,
        scopeName=scope_name,
        currentVisitors=current_visitors,
        typicalVisitors=typical_visitors,
        differencePercent=difference_percent,
        comparisonMessage=visitor_comparison_message(difference_percent),
        busiestEnterprise=enterprise_insights[0] if enterprise_insights else None,
        busiestPeriodLabel=busiest_period.label if busiest_period else None,
        series=series,
        unusuallyBusy=unusually_busy,
        lastUpdatedAt=max((item.receivedAt for item in latest), default=None),
    )


async def load_hourly_visitor_observations(
    db: AsyncSession,
    current_time: datetime,
) -> list[HourlyVisitorObservation]:
    local_timestamp = func.timezone(
        str(PHILIPPINE_TIME_ZONE), EnterpriseTelemetrySnapshot.captured_at
    )
    hour_bucket = func.date_trunc("hour", local_timestamp).label("hour_bucket")
    statement = (
        select(
            EnterpriseTelemetrySnapshot.enterprise_profile_id,
            EnterpriseProfile.enterprise_id,
            EnterpriseProfile.enterprise_name,
            EnterpriseProfile.barangay,
            hour_bucket,
            func.avg(EnterpriseTelemetrySnapshot.current_occupancy),
            func.max(EnterpriseTelemetrySnapshot.current_occupancy),
        )
        .join(
            EnterpriseProfile,
            EnterpriseProfile.account_id == EnterpriseTelemetrySnapshot.enterprise_profile_id,
        )
        .where(
            EnterpriseTelemetrySnapshot.captured_at
            >= current_time - timedelta(days=VISITOR_ACTIVITY_BASELINE_DAYS)
        )
        .group_by(
            EnterpriseTelemetrySnapshot.enterprise_profile_id,
            EnterpriseProfile.enterprise_id,
            EnterpriseProfile.enterprise_name,
            EnterpriseProfile.barangay,
            hour_bucket,
        )
        .order_by(hour_bucket.asc())
    )
    rows = (await db.execute(statement)).all()
    return [
        HourlyVisitorObservation(
            enterprise_profile_id=row[0],
            enterprise_id=row[1],
            enterprise_name=row[2],
            barangay=row[3] or "Unassigned",
            start_at=_philippine_hour(row[4]),
            average_visitors=max(0.0, float(row[5] or 0)),
            peak_visitors=max(0, int(row[6] or 0)),
        )
        for row in rows
    ]


def visitor_baselines_by_enterprise(
    observations: Sequence[HourlyVisitorObservation],
    local_now: datetime,
) -> dict[str, list[float]]:
    values: dict[str, list[float]] = defaultdict(list)
    cutoff = local_now - timedelta(days=1)
    for observation in observations:
        if observation.start_at >= cutoff:
            continue
        if observation.start_at.weekday() != local_now.weekday():
            continue
        if observation.start_at.hour != local_now.hour:
            continue
        values[observation.enterprise_id].append(observation.average_visitors)
    return values


def visitor_enterprise_insight(
    telemetry: TelemetrySnapshotSummary,
    baseline: Sequence[int | float],
) -> VisitorInsightEnterprise:
    condition = visitor_activity_condition(telemetry.currentOccupancy, baseline)
    typical_visitors = condition.typical_occupancy if condition else None
    difference_percent = visitor_difference_percent(telemetry.currentOccupancy, typical_visitors)
    return VisitorInsightEnterprise(
        enterpriseId=telemetry.enterpriseId,
        enterpriseName=telemetry.enterpriseName,
        barangay=telemetry.barangay or "Unassigned",
        currentVisitors=telemetry.currentOccupancy,
        typicalVisitors=typical_visitors,
        differencePercent=difference_percent,
        activityLevel=(
            "Busier Than Usual"
            if condition is not None and condition.breached
            else "Usual"
            if condition is not None
            else "No Recent Baseline"
        ),
    )


def visitor_insight_series(
    observations: Sequence[HourlyVisitorObservation],
    range_value: VisitorInsightRange,
    local_now: datetime,
) -> list[VisitorInsightPoint]:
    if range_value == "today":
        start_at = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        grouped: dict[datetime, list[HourlyVisitorObservation]] = defaultdict(list)
        for observation in observations:
            if observation.start_at >= start_at:
                grouped[observation.start_at].append(observation)
        return [
            VisitorInsightPoint(
                startAt=bucket,
                label=bucket.strftime("%I %p").lstrip("0"),
                averageVisitors=round(sum(item.average_visitors for item in items)),
                peakVisitors=sum(item.peak_visitors for item in items),
            )
            for bucket, items in sorted(grouped.items())
        ]

    days = 7 if range_value == "7d" else 30
    start_at = local_now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=days - 1
    )
    daily_enterprise: dict[tuple[datetime, str], list[HourlyVisitorObservation]] = defaultdict(list)
    for observation in observations:
        day = observation.start_at.replace(hour=0, minute=0, second=0, microsecond=0)
        if day >= start_at:
            daily_enterprise[(day, observation.enterprise_id)].append(observation)

    daily_totals: dict[datetime, tuple[float, int]] = defaultdict(lambda: (0.0, 0))
    for (day, _enterprise_id), items in daily_enterprise.items():
        total_average, total_peak = daily_totals[day]
        daily_totals[day] = (
            total_average + fmean(item.average_visitors for item in items),
            total_peak + max(item.peak_visitors for item in items),
        )

    return [
        VisitorInsightPoint(
            startAt=day,
            label=day.strftime("%a, %b %d").replace(" 0", " "),
            averageVisitors=round(values[0]),
            peakVisitors=values[1],
        )
        for day, values in sorted(daily_totals.items())
    ]


def visitor_difference_percent(current: int, typical: int | None) -> int | None:
    if typical is None:
        return None
    if typical <= 0:
        return 100 if current > 0 else 0
    return round((current - typical) / typical * 100)


def visitor_comparison_message(difference_percent: int | None) -> str:
    if difference_percent is None:
        return "More matching days are needed before TANAW can make a reliable comparison."
    if difference_percent >= 50:
        return "Visitor activity is much higher than usual for this day and time."
    if difference_percent >= 20:
        return "Visitor activity is higher than usual for this day and time."
    if difference_percent <= -20:
        return "Visitor activity is quieter than usual for this day and time."
    return "Visitor activity is within its usual range for this day and time."


def _philippine_hour(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=PHILIPPINE_TIME_ZONE)
    return value.astimezone(PHILIPPINE_TIME_ZONE)


async def get_operational_summary(db: AsyncSession, account: Account | None) -> OperationalSummary:
    latest = await list_latest_telemetry(db, account)
    reports = await list_intake_reports(db, account)
    last_sync_at = max((item.receivedAt for item in latest), default=None)
    return OperationalSummary(
        enterpriseCount=len(latest),
        onlineGateways=sum(1 for item in latest if item.gatewayStatus == "Connected"),
        delayedGateways=sum(1 for item in latest if item.gatewayStatus == "Sync Delayed"),
        offlineGateways=sum(1 for item in latest if item.gatewayStatus == "Offline"),
        totalCurrentOccupancy=sum(item.currentOccupancy for item in latest),
        totalEntries=sum(item.entries for item in latest),
        totalExits=sum(item.exits for item in latest),
        totalUniqueCount=sum(item.uniqueCount for item in latest),
        activeReports=len(reports),
        pendingReports=sum(1 for report in reports if report.status == "Pending Review"),
        lastSyncAt=last_sync_at,
    )


async def list_intake_reports(
    db: AsyncSession, account: Account | None, limit: int = 500
) -> list[IntakeReportSummary]:
    statement = (
        select(EnterpriseReportSubmission)
        .order_by(EnterpriseReportSubmission.submitted_at.desc())
        .limit(limit)
    )
    if account is not None and account.role == AccountRole.ENTERPRISE:
        statement = statement.where(EnterpriseReportSubmission.enterprise_profile_id == account.id)

    reports = (await db.scalars(statement)).all()
    return [to_intake_report_summary(report) for report in reports]


async def update_report_status(
    db: AsyncSession, report_id: str, payload: ReportStatusUpdate
) -> IntakeReportSummary | None:
    report = (
        await db.scalars(
            select(EnterpriseReportSubmission).where(EnterpriseReportSubmission.id == report_id)
        )
    ).first()
    if report is None:
        report = (
            await db.scalars(
                select(EnterpriseReportSubmission).where(
                    EnterpriseReportSubmission.report_id == report_id
                )
            )
        ).first()
    if report is None:
        return None

    validate_report_review_transition(report.review_status, payload.status)
    report.review_status = payload.status
    report.remarks = payload.remarks
    await db.commit()
    await db.refresh(report)
    return to_intake_report_summary(report)


async def list_final_reports(
    db: AsyncSession, account: Account, limit: int = 500
) -> list[FinalReportSummary]:
    statement = select(FinalReport).order_by(FinalReport.generated_on.desc()).limit(limit)
    reports = list((await db.scalars(statement)).all())
    if account.role == AccountRole.ENTERPRISE:
        visible_ids = {
            item.final_report_id
            for item in (
                await db.scalars(
                    select(FinalReportSource)
                    .join(FinalReportSource.intake_report)
                    .where(EnterpriseReportSubmission.enterprise_profile_id == account.id)
                )
            ).all()
        }
        reports = [report for report in reports if report.id in visible_ids]

    return [await to_final_report_summary(db, report) for report in reports]


async def create_final_report(
    db: AsyncSession, payload: FinalReportCreate
) -> FinalReportSummary | None:
    source_reports = (
        await db.scalars(
            select(EnterpriseReportSubmission)
            .where(EnterpriseReportSubmission.id.in_(payload.reportIds))
            .order_by(EnterpriseReportSubmission.submitted_at.asc())
        )
    ).all()
    if not source_reports:
        return None
    validate_final_report_sources(source_reports)

    period = final_report_period(source_reports)
    report = FinalReport(
        report_code=await generate_final_report_code(db, period),
        title="Citywide Tourism Aggregation",
        period=period,
        generated_on=datetime.now(UTC),
        prepared_by=payload.preparedBy,
        prepared_role="Staff Processing Division",
        status="Draft",
        total_entry=sum(item.entries for item in source_reports),
        total_exit=sum(item.exits for item in source_reports),
        total_unique=sum(item.unique_count for item in source_reports),
        enterprise_count=len({item.enterprise_profile_id for item in source_reports}),
    )
    db.add(report)
    await db.flush()

    for source in source_reports:
        source.review_status = "Consolidated"
        source.remarks = "Included in final report consolidation."
        db.add(
            FinalReportSource(
                final_report_id=report.id,
                intake_report_id=source.id,
                enterprise=source.enterprise_name,
                code=source.report_id,
                unique_count=source.unique_count,
                entries=source.entries,
                exits=source.exits,
            )
        )

    await db.commit()
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def return_final_report_for_revision(
    db: AsyncSession, report_id: str, payload: FinalReportRevisionReturn
) -> FinalReportSummary | None:
    report = await find_final_report(db, report_id)
    if report is None:
        return None
    sources = list(
        (
            await db.scalars(
                select(FinalReportSource).where(FinalReportSource.final_report_id == report.id)
            )
        ).all()
    )
    source_ids = {source.intake_report_id for source in sources}
    selected_source_ids = set(payload.sourceReportIds)
    validate_final_report_revision_return(report.status, source_ids, selected_source_ids)

    intake_reports = {
        intake_report.id: intake_report
        for intake_report in (
            await db.scalars(
                select(EnterpriseReportSubmission).where(
                    EnterpriseReportSubmission.id.in_(source_ids)
                )
            )
        ).all()
    }

    for source in sources:
        intake_report = intake_reports.get(source.intake_report_id)
        if intake_report is None:
            continue
        if source.intake_report_id in selected_source_ids:
            intake_report.review_status = "Returned"
            intake_report.remarks = payload.remarks
        else:
            intake_report.review_status = "Ready to Consolidate"
            intake_report.remarks = "Restored to Ready to Consolidate after final audit return."

    report.status = FINAL_REPORT_RETURNED_STATUS
    report.archived_from_status = None
    await db.commit()
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def update_final_report_status(
    db: AsyncSession, report_id: str, payload: FinalReportStatusUpdate
) -> FinalReportSummary | None:
    report = await find_final_report(db, report_id)
    if report is None:
        return None
    if payload.status == FINAL_REPORT_RETURNED_STATUS and not (
        report.status == FINAL_REPORT_ARCHIVED_STATUS
        and report.archived_from_status == FINAL_REPORT_RETURNED_STATUS
    ):
        raise InvalidReportWorkflowError(
            "Use the final audit return action to return a draft final report for revision."
        )

    next_status, archived_from_status = resolve_final_report_status_transition(
        current_status=report.status,
        current_archived_from_status=report.archived_from_status,
        requested_status=payload.status,
    )
    report.status = next_status
    report.archived_from_status = archived_from_status
    await db.commit()
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def find_final_report(db: AsyncSession, report_id: str) -> FinalReport | None:
    return (
        await db.scalars(
            select(FinalReport).where(
                (FinalReport.id == report_id) | (FinalReport.report_code == report_id)
            )
        )
    ).first()


async def enterprise_accounts_by_id(db: AsyncSession) -> dict[str, Account]:
    accounts = (
        await db.scalars(select(Account).where(Account.role == AccountRole.ENTERPRISE))
    ).all()
    return {account.id: account for account in accounts}


def to_telemetry_summary(
    snapshot: EnterpriseTelemetrySnapshot, account: Account | None = None
) -> TelemetrySnapshotSummary:
    profile = require_enterprise_profile(account) if account else snapshot.enterprise_profile
    return TelemetrySnapshotSummary(
        id=snapshot.id,
        enterpriseId=profile.enterprise_id,
        enterpriseName=profile.enterprise_name if account else snapshot.enterprise_name,
        category=format_enterprise_category(profile.category),
        barangay=profile.barangay,
        cameraId=snapshot.camera_id,
        cameraName=snapshot.camera_name,
        capturedAt=snapshot.captured_at,
        receivedAt=snapshot.received_at,
        entries=snapshot.entries,
        exits=snapshot.exits,
        currentOccupancy=snapshot.current_occupancy,
        peakOccupancy=snapshot.peak_occupancy,
        uniqueCount=snapshot.unique_count,
        confirmedUniqueCount=snapshot.confirmed_unique_count,
        degradedUniqueCount=snapshot.degraded_unique_count,
        totalEvents=snapshot.total_events,
        unsubmittedEvents=snapshot.unsubmitted_events,
        unsyncedEvents=snapshot.unsynced_events,
        running=snapshot.running,
        status=snapshot.status,
        error=snapshot.error,
        analyticsFps=snapshot.analytics_fps,
        gatewayStatus=gateway_status_for_snapshot(snapshot),
    )


def to_intake_report_summary(report: EnterpriseReportSubmission) -> IntakeReportSummary:
    payload = parse_report_payload(report.payload_json)
    return IntakeReportSummary(
        id=report.id,
        enterpriseId=report.enterprise_profile.enterprise_id,
        enterprise=report.enterprise_name,
        category=report.category or "Uncategorized",
        barangay=report.barangay or "Unassigned",
        month=report.month,
        period=report.period,
        submitted=format_timestamp(report.submitted_at),
        submittedAt=report.submitted_at,
        status=report.review_status,  # type: ignore[arg-type]
        code=report.report_id,
        remarks=report.remarks,
        notes=report.notes,
        metrics={
            "entry": report.entries,
            "exit": report.exits,
            "unique": report.unique_count,
            "peak": str(report.peak_occupancy),
        },
        payload=payload,
        demographics=report_demographics_from_payload(payload, report.unique_count),
    )


def parse_report_payload(payload_json: str | None) -> dict | None:
    if not payload_json:
        return None
    try:
        payload = json.loads(payload_json)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def report_demographics_from_payload(
    payload: Mapping[str, object] | None, unique_count: int
) -> ReportDemographicsSummary | None:
    demo = payload.get("demo") if payload else None
    if not isinstance(demo, Mapping):
        return None

    values: dict[str, int] = {}
    for field in REPORT_DEMOGRAPHIC_FIELDS:
        value = report_non_negative_int(demo.get(field))
        if value is None:
            return None
        values[field] = value

    if sum(values.values()) != unique_count:
        return None

    return ReportDemographicsSummary(**values)


def report_non_negative_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None


async def to_final_report_summary(db: AsyncSession, report: FinalReport) -> FinalReportSummary:
    sources = (
        await db.scalars(
            select(FinalReportSource)
            .where(FinalReportSource.final_report_id == report.id)
            .order_by(FinalReportSource.enterprise.asc())
        )
    ).all()
    intake_reports_by_id: dict[str, EnterpriseReportSubmission] = {}
    source_intake_ids = [source.intake_report_id for source in sources]
    if source_intake_ids:
        intake_reports = (
            await db.scalars(
                select(EnterpriseReportSubmission).where(
                    EnterpriseReportSubmission.id.in_(source_intake_ids)
                )
            )
        ).all()
        intake_reports_by_id = {intake_report.id: intake_report for intake_report in intake_reports}

    return FinalReportSummary(
        id=report.report_code,
        title=report.title,
        period=report.period,
        generatedOn=_aware(report.generated_on).date().isoformat(),
        preparedBy=report.prepared_by,
        preparedRole=report.prepared_role,
        status=report.status,  # type: ignore[arg-type]
        archivedFromStatus=to_final_report_archived_from_status(report.archived_from_status),
        totalEntry=report.total_entry,
        totalExit=report.total_exit,
        totalUnique=report.total_unique,
        enterpriseCount=report.enterprise_count,
        sources=[
            FinalReportSourceSummary(
                id=source.intake_report_id,
                enterprise=source.enterprise,
                code=source.code,
                unique=source.unique_count,
                entry=source.entries,
                exit=source.exits,
                demographics=source_demographics(source, intake_reports_by_id),
            )
            for source in sources
        ],
    )


def source_demographics(
    source: FinalReportSource, intake_reports_by_id: Mapping[str, EnterpriseReportSubmission]
) -> ReportDemographicsSummary | None:
    intake_report = intake_reports_by_id.get(source.intake_report_id)
    if intake_report is None:
        return None
    return report_demographics_from_payload(
        parse_report_payload(intake_report.payload_json), source.unique_count
    )


def resolve_final_report_status_transition(
    *, current_status: str, current_archived_from_status: str | None, requested_status: str
) -> tuple[str, str | None]:
    if requested_status == FINAL_REPORT_ARCHIVED_STATUS:
        if current_status == FINAL_REPORT_ARCHIVED_STATUS:
            return FINAL_REPORT_ARCHIVED_STATUS, restore_target_status(current_archived_from_status)
        archived_from_status = (
            current_status if current_status in FINAL_REPORT_RESTORABLE_STATUSES else "Finalized"
        )
        return FINAL_REPORT_ARCHIVED_STATUS, archived_from_status

    if current_status == FINAL_REPORT_ARCHIVED_STATUS and requested_status == "Draft":
        return restore_target_status(current_archived_from_status), None

    return requested_status, None


def restore_target_status(archived_from_status: str | None) -> str:
    return (
        archived_from_status
        if archived_from_status in FINAL_REPORT_RESTORABLE_STATUSES
        else "Finalized"
    )


def to_final_report_archived_from_status(
    archived_from_status: str | None,
) -> FinalReportArchivedFromStatus | None:
    if archived_from_status in FINAL_REPORT_RESTORABLE_STATUSES:
        return cast(FinalReportArchivedFromStatus, archived_from_status)
    return None


def require_enterprise_profile(account: Account) -> EnterpriseProfile:
    profile = account.enterprise_profile
    if account.role != AccountRole.ENTERPRISE or profile is None:
        raise RuntimeError("Enterprise account is missing its profile.")
    return profile


def enterprise_identifier(account: Account) -> str:
    return require_enterprise_profile(account).enterprise_id


def enterprise_name(account: Account) -> str:
    return require_enterprise_profile(account).enterprise_name


async def generate_final_report_code(db: AsyncSession, period: str) -> str:
    parts = period.split()
    month = (parts[0] if parts else "Current")[:3].upper()
    year = next(
        (part for part in reversed(parts) if part.isdigit() and len(part) == 4),
        str(datetime.now(UTC).year),
    )
    prefix = f"CON-{month}-{year}"
    existing = set(
        await db.scalars(
            select(FinalReport.report_code).where(FinalReport.report_code.like(f"{prefix}-%"))
        )
    )
    sequence = 1
    while True:
        code = f"{prefix}-{sequence:04d}"
        if code not in existing:
            return code
        sequence += 1


def final_report_period(reports: Sequence[EnterpriseReportSubmission]) -> str:
    first = reports[0]
    year = (
        first.period.split(",")[-1].strip()
        if "," in first.period
        else str(_aware(first.submitted_at).year)
    )
    if not year.isdigit():
        year = str(_aware(first.submitted_at).year)
    return f"{first.month} {year}"


def validate_report_review_transition(current_status: str, requested_status: str) -> None:
    if current_status != "Pending Review":
        raise InvalidReportWorkflowError(
            f"{current_status} reports cannot be changed through intake review actions."
        )
    if requested_status not in {"Ready to Consolidate", "Returned"}:
        raise InvalidReportWorkflowError(
            "Intake review can only accept a pending report or return it for revision."
        )


def validate_final_report_sources(reports: Sequence[EnterpriseReportSubmission]) -> None:
    invalid_reports = [
        report.report_id for report in reports if report.review_status != "Ready to Consolidate"
    ]
    if invalid_reports:
        joined_ids = ", ".join(invalid_reports)
        raise InvalidReportWorkflowError(
            f"Only reports marked Ready to Consolidate can be included in a final report: {joined_ids}."
        )

    periods = {report.period for report in reports}
    if len(periods) > 1:
        raise InvalidReportWorkflowError("A final report can only include one reporting period.")


def validate_final_report_revision_return(
    current_status: str, source_ids: set[str], selected_source_ids: set[str]
) -> None:
    if current_status != "Draft":
        raise InvalidReportWorkflowError("Only draft final reports can be returned for revision.")
    if not source_ids:
        raise InvalidReportWorkflowError("This final report has no source reports to return.")

    unknown_source_ids = selected_source_ids - source_ids
    if unknown_source_ids:
        joined_ids = ", ".join(sorted(unknown_source_ids))
        raise InvalidReportWorkflowError(
            f"Selected source reports do not belong to this final report: {joined_ids}."
        )


def gateway_status_for_snapshot(snapshot: EnterpriseTelemetrySnapshot) -> str:
    now = datetime.now(UTC)
    received_at = snapshot.received_at
    if received_at is None:
        return "Offline" if snapshot.error or snapshot.status == "error" else "Connected"
    if received_at.tzinfo is None:
        received_at = received_at.replace(tzinfo=UTC)
    age = (now - received_at).total_seconds()

    if snapshot.error or snapshot.status == "error":
        return "Offline"
    if age > OFFLINE_GATEWAY_SECONDS:
        return "Offline"
    if age > STALE_GATEWAY_SECONDS:
        return "Sync Delayed"
    if snapshot.unsynced_events > 0:
        return "Sync Delayed"
    return "Connected" if snapshot.running or snapshot.total_events > 0 else "Connected"


def status_from_payload(payload: dict | None) -> str:
    value = payload.get("status") if isinstance(payload, dict) else None
    return (
        value if isinstance(value, str) and value in {"Submitted", "Resubmitted"} else "Submitted"
    )


def month_from_submission(period: str, submitted_at: datetime) -> str:
    first = period.split(" ", 1)[0].strip()
    month_names = {
        "jan": "January",
        "january": "January",
        "feb": "February",
        "february": "February",
        "mar": "March",
        "march": "March",
        "apr": "April",
        "april": "April",
        "may": "May",
        "jun": "June",
        "june": "June",
        "jul": "July",
        "july": "July",
        "aug": "August",
        "august": "August",
        "sep": "September",
        "sept": "September",
        "september": "September",
        "oct": "October",
        "october": "October",
        "nov": "November",
        "november": "November",
        "dec": "December",
        "december": "December",
    }
    if first.lower() in month_names:
        return month_names[first.lower()]
    return _aware(submitted_at).strftime("%B")


def format_timestamp(value: datetime) -> str:
    return _aware(value).strftime("%b %d, %Y %I:%M %p")


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value
