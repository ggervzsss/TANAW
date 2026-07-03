import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from math import ceil, sin
from typing import cast

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole, AccountStatus, SystemConfiguration
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
    DesktopHealthSummary,
    DesktopMetricsSummary,
    DesktopReportSubmissionIngest,
    DesktopSessionSummary,
    DesktopTelemetryIngest,
    FinalReportCreate,
    FinalReportSourceSummary,
    FinalReportStatusUpdate,
    FinalReportSummary,
    FleetSimulationEnterpriseSummary,
    FleetSimulationTarget,
    IntakeReportSummary,
    OperationalAlertSummary,
    OperationalSummary,
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
)

STALE_GATEWAY_SECONDS = 120
OFFLINE_GATEWAY_SECONDS = 900
SYSTEM_SETTINGS_ID = "default"
NOTIFY_CAMERA_SESSION_ERROR_KEY = "notifications.cameraSessionErrorAlerts"
NOTIFY_GATEWAY_SERVICE_ERROR_KEY = "notifications.gatewayServiceErrorAlerts"
NOTIFY_SYNC_DELAY_KEY = "notifications.syncDelayAlerts"
NOTIFY_FAILED_LOGIN_LOCKOUT_KEY = "notifications.failedLoginLockoutAlerts"
NOTIFICATION_SETTING_LEGACY_KEYS = {
    NOTIFY_CAMERA_SESSION_ERROR_KEY: ("notifications.Notify Camera Offline",),
    NOTIFY_GATEWAY_SERVICE_ERROR_KEY: ("notifications.Notify Gateway Offline",),
    NOTIFY_SYNC_DELAY_KEY: ("notifications.Notify Sync Failed",),
    NOTIFY_FAILED_LOGIN_LOCKOUT_KEY: ("notifications.Notify Failed Login Threshold",),
}


class DuplicateReportPeriodError(Exception):
    pass


@dataclass(frozen=True)
class OccupancyAlertCondition:
    capacity: int
    threshold_percent: int
    threshold_count: int
    recovery_count: int
    current_occupancy: int

    @property
    def breached(self) -> bool:
        return self.current_occupancy >= self.threshold_count

    @property
    def recovered(self) -> bool:
        return self.current_occupancy <= self.recovery_count


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
    for legacy_key in NOTIFICATION_SETTING_LEGACY_KEYS.get(key, ()):
        legacy_value = values.get(legacy_key)
        if isinstance(legacy_value, bool):
            return legacy_value
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
    notification = UserNotification(
        recipient_account_id=recipient.id,
        recipient_role=recipient.role.value,
        recipient_enterprise_id=enterprise_identifier(recipient)
        if recipient.role == AccountRole.ENTERPRISE
        else None,
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
    return to_user_notification_summary(notification)


def to_support_ticket_summary(ticket: SupportTicket) -> SupportTicketSummary:
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
    statement = select(SupportTicket).order_by(SupportTicket.created_at.desc()).limit(limit)
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(SupportTicket.enterprise_id == enterprise_identifier(account))
    tickets = (await db.scalars(statement)).all()
    return [to_support_ticket_summary(ticket) for ticket in tickets]


async def get_support_ticket_for_account(
    db: AsyncSession, account: Account, ticket_id: str
) -> SupportTicket | None:
    ticket = cast(
        SupportTicket | None,
        await db.scalar(select(SupportTicket).where(SupportTicket.id == ticket_id)),
    )
    if ticket is None:
        return None
    if account.role == AccountRole.ENTERPRISE and ticket.enterprise_id != enterprise_identifier(
        account
    ):
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
    db: AsyncSession, account: Account, payload: SupportTicketCreate
) -> SupportTicketSummary:
    ticket_count = await db.scalar(select(func.count()).select_from(SupportTicket))
    ticket = SupportTicket(
        ticket_code=f"TCK-{int(ticket_count or 0) + 1:06d}",
        enterprise_account_id=account.id,
        enterprise_id=enterprise_identifier(account),
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
    await db.commit()
    await db.refresh(ticket)
    return to_support_ticket_summary(ticket)


async def create_support_ticket_message(
    db: AsyncSession,
    ticket: SupportTicket,
    author: Account,
    payload: SupportTicketMessageCreate,
) -> SupportTicketDetail:
    message = SupportTicketMessage(
        ticket_id=ticket.id,
        author_account_id=author.id,
        author_name=author.display_name,
        author_role=author.role.value,
        message=payload.message,
    )
    db.add(message)
    if ticket.status == "Open":
        ticket.status = "In Review"
    await db.commit()
    await db.refresh(ticket)
    await db.refresh(message)
    detail = await get_support_ticket_detail(db, author, ticket.id)
    if detail is None:
        raise RuntimeError("Support ticket detail disappeared after reply creation.")
    return detail


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
                or_(Account.id == enterprise_id, Account.enterprise_id == enterprise_id),
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


async def list_operational_alerts(db: AsyncSession) -> list[OperationalAlertSummary]:
    result = await db.scalars(select(OperationalAlert).order_by(OperationalAlert.created_at.desc()))
    return [to_operational_alert_summary(alert) for alert in result]


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


def occupancy_alert_condition(
    payload: DesktopTelemetryIngest,
) -> OccupancyAlertCondition | None:
    simulation = (payload.payload or {}).get("simulation")
    if not isinstance(simulation, dict):
        return None

    capacity = simulation.get("capacity")
    threshold_percent = simulation.get("thresholdPercent")
    if (
        not isinstance(capacity, int)
        or isinstance(capacity, bool)
        or capacity <= 0
        or not isinstance(threshold_percent, int)
        or isinstance(threshold_percent, bool)
        or threshold_percent <= 0
        or threshold_percent > 100
    ):
        return None

    threshold_count = max(1, ceil(capacity * threshold_percent / 100))
    recovery_percent = max(0, threshold_percent - 10)
    recovery_count = max(0, int(capacity * recovery_percent / 100))
    return OccupancyAlertCondition(
        capacity=capacity,
        threshold_percent=threshold_percent,
        threshold_count=threshold_count,
        recovery_count=recovery_count,
        current_occupancy=payload.metrics.currentOccupancy,
    )


async def evaluate_telemetry_alerts(
    db: AsyncSession,
    account: Account,
    payload: DesktopTelemetryIngest,
) -> list[tuple[str, OperationalAlertSummary]]:
    source_id = f"occupancy-threshold:{account.id}"
    existing = await db.scalar(
        select(OperationalAlert).where(
            OperationalAlert.source_id == source_id,
            OperationalAlert.alert_type == "Threshold Breach",
            OperationalAlert.status != "Resolved",
        )
    )
    condition = occupancy_alert_condition(payload)

    if condition is not None and condition.breached:
        if existing is not None:
            return []

        enterprise = enterprise_name(account)
        alert = await create_operational_alert(
            db,
            alert_type="Threshold Breach",
            severity="Critical",
            requester=enterprise,
            enterprise=enterprise,
            summary=(
                f"Live occupancy reached {condition.current_occupancy} of "
                f"{condition.capacity} people, exceeding the "
                f"{condition.threshold_percent}% alert threshold."
            ),
            required_action=(
                "Review live occupancy and apply the venue's crowd-management procedure."
            ),
            resolution_mode="Admin Monitoring",
            owner="IT",
            source_id=source_id,
        )
        return [("alert.created", to_operational_alert_summary(alert))]

    should_resolve = existing is not None and (condition is None or condition.recovered)
    if should_resolve and existing is not None:
        existing.status = "Resolved"
        existing.summary = (
            f"{existing.summary} The latest telemetry indicates that the threshold condition "
            "has cleared."
        )
        await db.commit()
        await db.refresh(existing)
        return [("alert.resolved", to_operational_alert_summary(existing))]

    return []


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

    enterprise_id = enterprise_identifier(account)
    snapshot = EnterpriseTelemetrySnapshot(
        enterprise_account_id=account.id,
        enterprise_id=enterprise_id,
        enterprise_name=enterprise_name(account),
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
        source_kind=payload.sourceKind,
        mock_run_id=payload.mockRunId,
    )
    db.add(snapshot)
    if update_account_gateway:
        account.gateway_status = (
            "Offline" if snapshot.error or snapshot.status == "error" else "Connected"
        )
        if payload.deviceId:
            account.gateway_id = payload.deviceId
    await db.commit()
    await db.refresh(snapshot)
    return to_telemetry_summary(snapshot, account)


async def list_fleet_simulation_enterprises(
    db: AsyncSession, actor: Account
) -> list[FleetSimulationEnterpriseSummary]:
    enterprises = (
        await db.scalars(
            select(Account)
            .where(Account.role == AccountRole.ENTERPRISE, Account.status == AccountStatus.ACTIVE)
            .order_by(Account.enterprise_name.asc(), Account.display_name.asc())
        )
    ).all()
    current_enterprise_id = (
        enterprise_identifier(actor) if actor.role == AccountRole.ENTERPRISE else None
    )
    return [
        FleetSimulationEnterpriseSummary(
            enterpriseId=enterprise_identifier(enterprise),
            enterpriseName=enterprise_name(enterprise),
            category=format_enterprise_category(enterprise.category),
            barangay=enterprise.barangay,
            isCurrent=enterprise_identifier(enterprise) == current_enterprise_id,
        )
        for enterprise in enterprises
    ]


async def enterprise_accounts_by_identifier(
    db: AsyncSession, enterprise_ids: set[str]
) -> dict[str, Account]:
    if not enterprise_ids:
        return {}
    accounts = (
        await db.scalars(
            select(Account).where(
                Account.role == AccountRole.ENTERPRISE,
                Account.status == AccountStatus.ACTIVE,
                (Account.enterprise_id.in_(enterprise_ids)) | (Account.id.in_(enterprise_ids)),
            )
        )
    ).all()
    return {enterprise_identifier(account): account for account in accounts}


def build_fleet_simulation_telemetry_payload(
    *,
    target: FleetSimulationTarget,
    enterprise: Account,
    run_id: str,
    started_at: datetime,
    elapsed_seconds: int,
) -> DesktopTelemetryIngest:
    now = datetime.now(UTC)
    seed = stable_simulation_seed(run_id, target.enterpriseId)
    capacity = target.capacity
    threshold_count = max(1, ceil(capacity * target.thresholdPercent / 100))
    current_occupancy = fleet_occupancy_for_lane(target, elapsed_seconds, seed)
    if target.lane == "one-minute-breach" and 20 <= elapsed_seconds % 180 < 80:
        current_occupancy = max(current_occupancy, threshold_count)

    peak_occupancy = max(
        current_occupancy,
        fleet_peak_for_lane(target, elapsed_seconds),
    )
    event_rate = fleet_events_per_minute(target.lane)
    tick_index = max(0, elapsed_seconds // 5)
    entries = max(
        current_occupancy, tick_index * max(1, event_rate // 6) + current_occupancy + seed % 19
    )
    exits = max(0, entries - current_occupancy)
    total_events = entries + exits
    unique_count = max(current_occupancy, int(entries * 0.82))
    confirmed_unique_count = int(unique_count * 0.9)
    degraded_unique_count = max(0, unique_count - confirmed_unique_count)
    unsynced_events = 3 + seed % 4 if target.lane == "warning" else 0
    session_status = "sync_delayed" if target.lane == "warning" else "running"

    return DesktopTelemetryIngest(
        deviceId=None,
        capturedAt=now,
        metrics=DesktopMetricsSummary(
            entries=entries,
            exits=exits,
            peakOccupancy=peak_occupancy,
            currentOccupancy=current_occupancy,
            uniqueCount=unique_count,
            confirmedUniqueCount=confirmed_unique_count,
            degradedUniqueCount=degraded_unique_count,
            totalEvents=total_events,
            unsubmittedEvents=0,
            unsyncedEvents=unsynced_events,
            firstEventAt=started_at,
            lastEventAt=now,
        ),
        session=DesktopSessionSummary(
            running=True,
            status=session_status,
            error=None,
            cameraId="fleet-sim",
            cameraName="Fleet Simulation Lab",
            updatedAt=now,
        ),
        health=DesktopHealthSummary(
            analyticsFps=24.0,
            processingProfile="simulation",
            detectorP50Ms=0.0,
            detectorP95Ms=0.0,
            processingFrameAgeMs=0.0,
            processingFramesSkipped=0,
            modelReady=True,
            reidReady=True,
            qualityReidReady=True,
            reidQueueDepth=0,
            qualityReidQueueDepth=0,
        ),
        sourceKind="mock",
        mockRunId=run_id,
        payload={
            "simulation": {
                "runId": run_id,
                "mode": "fleet",
                "scenario": target.lane,
                "state": "running",
                "capacity": target.capacity,
                "thresholdPercent": target.thresholdPercent,
                "eventsPerMinute": event_rate,
                "durationMinutes": None,
                "startedAt": started_at.isoformat(),
                "fleet": True,
                "lane": target.lane,
                "elapsedSeconds": elapsed_seconds,
                "enterpriseId": enterprise_identifier(enterprise),
                "enterpriseName": enterprise_name(enterprise),
            },
            "syncedAt": now.isoformat(),
        },
    )


async def ingest_report_submission(
    db: AsyncSession, account: Account, payload: DesktopReportSubmissionIngest
) -> IntakeReportSummary:
    enterprise_id = enterprise_identifier(account)
    result = await db.scalars(
        select(EnterpriseReportSubmission).where(
            EnterpriseReportSubmission.enterprise_id == enterprise_id,
            EnterpriseReportSubmission.report_id == payload.reportId,
        )
    )
    existing = result.first()
    duplicate_period = await db.scalar(
        select(EnterpriseReportSubmission).where(
            EnterpriseReportSubmission.enterprise_id == enterprise_id,
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
            enterprise_account_id=account.id,
            enterprise_id=enterprise_id,
            enterprise_name=enterprise_name(account),
            category=format_enterprise_category(account.category) or "Uncategorized",
            barangay=account.barangay or "Unassigned",
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
            source_kind=payload.sourceKind,
            mock_run_id=payload.mockRunId,
        )
        db.add(report)
    else:
        report = existing
        report.enterprise_account_id = account.id
        report.enterprise_name = enterprise_name(account)
        report.category = format_enterprise_category(account.category) or "Uncategorized"
        report.barangay = account.barangay or "Unassigned"
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
        report.source_kind = payload.sourceKind
        report.mock_run_id = payload.mockRunId
        if report.review_status == "Returned" and report_status in {"Submitted", "Resubmitted"}:
            report.review_status = "Pending Review"

    account.gateway_status = "Connected"
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
            partition_by=EnterpriseTelemetrySnapshot.enterprise_id,
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
        statement = statement.where(
            EnterpriseTelemetrySnapshot.enterprise_id == enterprise_identifier(account)
        )

    snapshots = (await db.scalars(statement)).all()
    accounts = await enterprise_accounts_by_id(db)

    return [
        to_telemetry_summary(snapshot, accounts.get(snapshot.enterprise_id))
        for snapshot in snapshots
    ]


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
        statement = statement.where(
            EnterpriseReportSubmission.enterprise_id == enterprise_identifier(account)
        )

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
        enterprise_id = enterprise_identifier(account)
        visible_ids = {
            item.final_report_id
            for item in (
                await db.scalars(
                    select(FinalReportSource).where(
                        FinalReportSource.enterprise_id == enterprise_id
                    )
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
        enterprise_count=len({item.enterprise_id for item in source_reports}),
        source_kind=source_kind_for_reports(source_reports),
        mock_run_id=mock_run_id_for_reports(source_reports),
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
                enterprise_id=source.enterprise_id,
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


async def update_final_report_status(
    db: AsyncSession, report_id: str, payload: FinalReportStatusUpdate
) -> FinalReportSummary | None:
    report = (
        await db.scalars(
            select(FinalReport).where(
                (FinalReport.id == report_id) | (FinalReport.report_code == report_id)
            )
        )
    ).first()
    if report is None:
        return None

    report.status = payload.status
    await db.commit()
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def enterprise_accounts_by_id(db: AsyncSession) -> dict[str, Account]:
    accounts = (
        await db.scalars(select(Account).where(Account.role == AccountRole.ENTERPRISE))
    ).all()
    return {enterprise_identifier(account): account for account in accounts}


def to_telemetry_summary(
    snapshot: EnterpriseTelemetrySnapshot, account: Account | None = None
) -> TelemetrySnapshotSummary:
    return TelemetrySnapshotSummary(
        id=snapshot.id,
        enterpriseId=snapshot.enterprise_id,
        enterpriseName=account.enterprise_name
        if account and account.enterprise_name
        else snapshot.enterprise_name,
        category=format_enterprise_category(account.category) if account else None,
        barangay=account.barangay if account else None,
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
        sourceKind=snapshot.source_kind,  # type: ignore[arg-type]
        mockRunId=snapshot.mock_run_id,
    )


def to_intake_report_summary(report: EnterpriseReportSubmission) -> IntakeReportSummary:
    return IntakeReportSummary(
        id=report.id,
        enterpriseId=report.enterprise_id,
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
    )


async def to_final_report_summary(db: AsyncSession, report: FinalReport) -> FinalReportSummary:
    sources = (
        await db.scalars(
            select(FinalReportSource)
            .where(FinalReportSource.final_report_id == report.id)
            .order_by(FinalReportSource.enterprise.asc())
        )
    ).all()
    return FinalReportSummary(
        id=report.report_code,
        title=report.title,
        period=report.period,
        generatedOn=_aware(report.generated_on).date().isoformat(),
        preparedBy=report.prepared_by,
        preparedRole=report.prepared_role,
        status=report.status,  # type: ignore[arg-type]
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
            )
            for source in sources
        ],
    )


def enterprise_identifier(account: Account) -> str:
    return account.enterprise_id or account.id


def enterprise_name(account: Account) -> str:
    return account.enterprise_name or account.display_name


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


def source_kind_for_reports(reports: Sequence[EnterpriseReportSubmission]) -> str:
    source_kinds = {report.source_kind for report in reports}
    if "hybrid" in source_kinds:
        return "hybrid"
    if source_kinds == {"mock"}:
        return "mock"
    return "real"


def mock_run_id_for_reports(reports: Sequence[EnterpriseReportSubmission]) -> str | None:
    run_ids = {report.mock_run_id for report in reports if report.mock_run_id}
    return run_ids.pop() if len(run_ids) == 1 else None


def fleet_occupancy_for_lane(target: FleetSimulationTarget, elapsed_seconds: int, seed: int) -> int:
    if target.lane == "warning":
        threshold_count = max(1, ceil(target.capacity * target.thresholdPercent / 100))
        warning_count = max(0, threshold_count - max(1, ceil(target.capacity * 0.08)))
        wave = int(sin((elapsed_seconds + seed % 37) / 18) * max(1, target.capacity * 0.02))
        return clamp_int(warning_count + wave, 0, max(0, threshold_count - 1))

    if target.lane == "one-minute-breach":
        phase = elapsed_seconds % 180
        if phase < 20:
            percent = interpolate(
                max(5.0, target.thresholdPercent - 35), target.thresholdPercent + 4, phase / 20
            )
        elif phase < 80:
            percent = target.thresholdPercent + 5 + sin((phase + seed % 23) / 12) * 2
        elif phase < 120:
            percent = interpolate(
                target.thresholdPercent + 4,
                max(0.0, target.thresholdPercent - 15),
                (phase - 80) / 40,
            )
        else:
            percent = normal_occupancy_percent(target.thresholdPercent, elapsed_seconds, seed)
        return occupancy_from_percent(target.capacity, percent)

    return occupancy_from_percent(
        target.capacity, normal_occupancy_percent(target.thresholdPercent, elapsed_seconds, seed)
    )


def fleet_peak_for_lane(target: FleetSimulationTarget, elapsed_seconds: int) -> int:
    if target.lane == "one-minute-breach" and elapsed_seconds % 180 >= 20:
        return occupancy_from_percent(target.capacity, min(100.0, target.thresholdPercent + 8))
    return 0


def normal_occupancy_percent(threshold_percent: int, elapsed_seconds: int, seed: int) -> float:
    upper_bound = max(5.0, threshold_percent - 22)
    center = min(55.0, max(8.0, upper_bound - 8))
    return min(upper_bound, max(0.0, center + sin((elapsed_seconds + seed % 53) / 24) * 7))


def occupancy_from_percent(capacity: int, percent: float) -> int:
    return clamp_int(round(capacity * percent / 100), 0, capacity)


def fleet_events_per_minute(lane: str) -> int:
    if lane == "warning":
        return 34
    if lane == "one-minute-breach":
        return 52
    return 22


def stable_simulation_seed(*parts: str) -> int:
    digest = sha256(":".join(parts).encode()).hexdigest()
    return int(digest[:8], 16)


def interpolate(start: float, end: float, ratio: float) -> float:
    return start + (end - start) * max(0.0, min(1.0, ratio))


def clamp_int(value: int, lower: int, upper: int) -> int:
    return min(upper, max(lower, value))


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
