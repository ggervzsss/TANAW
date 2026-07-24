import base64
import binascii
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.features.accounts.dependencies import (
    get_current_operational_account,
    require_roles,
)
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.options import format_enterprise_category
from app.features.accounts.service import get_account_by_id
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.mail.models import EmailTemplateName
from app.features.mail.service import email_idempotency_key, enqueue_email
from app.features.operational.models import (
    EnterpriseReportSubmission,
    OperationalAlert,
)
from app.features.operational.schemas import (
    DesktopReportSubmissionIngest,
    DesktopTelemetryIngest,
    EnterpriseNotificationCreate,
    FinalReportCreate,
    FinalReportRevisionReturn,
    FinalReportStatusUpdate,
    FinalReportSummary,
    IntakeReportSummary,
    NotificationReadUpdate,
    OperationalAlertStatusUpdate,
    OperationalAlertSummary,
    OperationalSummary,
    ReportStatusUpdate,
    SamplePreparationCounts,
    SamplePreparationSummary,
    SupportTicketCreate,
    SupportTicketDetail,
    SupportTicketMessageCreate,
    SupportTicketStatusUpdate,
    SupportTicketSummary,
    TelemetrySnapshotSummary,
    UserNotificationSummary,
    VisitorInsightRange,
    VisitorInsightsSummary,
)
from app.features.operational.service import (
    NOTIFY_CAMERA_SESSION_ERROR_KEY,
    NOTIFY_GATEWAY_SERVICE_ERROR_KEY,
    NOTIFY_SYNC_DELAY_KEY,
    STAFF_REPORT_RESUBMITTED_NOTIFICATION,
    STAFF_REPORT_SUBMITTED_NOTIFICATION,
    DuplicateReportPeriodError,
    InvalidReportWorkflowError,
    ResolvedTicketConversationError,
    can_manage_operational_alert,
    create_final_report,
    create_operational_alert,
    create_role_notifications,
    create_support_ticket,
    create_support_ticket_message,
    create_support_ticket_message_with_record,
    create_user_notification,
    enterprise_identifier,
    enterprise_name,
    evaluate_telemetry_alerts,
    get_active_operational_alert,
    get_enterprise_notification_recipient,
    get_operational_summary,
    get_support_ticket_detail,
    get_support_ticket_for_account,
    get_visitor_insights,
    ingest_report_submission,
    ingest_telemetry,
    list_intake_reports,
    list_latest_telemetry,
    list_operational_alerts,
    list_support_tickets,
    list_user_notifications,
    mark_source_notifications_read,
    parse_ticket_attachments,
    require_enterprise_profile,
    resolve_operational_alert,
    return_final_report_for_revision,
    set_user_notification_read,
    system_setting_enabled,
    to_operational_alert_summary,
    update_final_report_status,
    update_report_status,
    update_support_ticket_status,
)
from app.features.operational.service import (
    list_final_reports as list_final_report_records,
)
from app.features.sample_data.dataset import prepared_counts, sample_dataset_marker_email

router = APIRouter(prefix="/operational", tags=["operational"])

OperationalReadAccount = Annotated[
    Account, Depends(require_roles({"admin", "it", "staff", "enterprise"}))
]
TicketReadAccount = Annotated[Account, Depends(require_roles({"admin", "it", "enterprise"}))]
TicketMessageAccount = Annotated[Account, Depends(require_roles({"it", "enterprise"}))]
EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]
StaffWorkflowAccount = Annotated[Account, Depends(require_roles({"admin", "staff"}))]
ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
AlertReadAccount = Annotated[Account, Depends(require_roles({"admin", "it"}))]
AlertManageAccount = Annotated[Account, Depends(require_roles({"admin", "it"}))]
AdminAccount = Annotated[Account, Depends(require_roles({"admin"}))]


@router.post(
    "/desktop/telemetry",
    response_model=TelemetrySnapshotSummary,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_desktop_telemetry(
    payload: DesktopTelemetryIngest,
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TelemetrySnapshotSummary:
    snapshot = await ingest_telemetry(db, account, payload)
    for event_type, alert_summary in await evaluate_telemetry_alerts(db, account, payload):
        if event_type == "alert.created" and alert_summary.owner == "Admin":
            await create_role_notifications(
                db,
                recipient_roles=[AccountRole.ADMIN],
                title=f"{alert_summary.enterprise or alert_summary.requester} needs attention.",
                message=alert_summary.summary,
                notification_type="High Visitor Activity",
                severity=alert_summary.severity,
                actor=account,
                source_type="operational.alert",
                source_id=alert_summary.id,
            )
        if alert_summary.owner == "Admin":
            await record_operational_log(
                db,
                category="Admin Operation",
                severity=("Success" if event_type == "alert.resolved" else alert_summary.severity),
                actor="TANAW",
                actor_role="System",
                action="Alert Resolved" if event_type == "alert.resolved" else "Alert Created",
                target=alert_summary.enterprise or alert_summary.requester,
                summary=alert_summary.summary,
                source_id=alert_summary.id,
                metadata={
                    "alertType": alert_summary.type,
                    "status": alert_summary.status,
                },
            )

    sync_source_id = f"sync-failed:{account.id}"
    existing_sync_alert = await get_active_operational_alert(
        db, alert_type="Maintenance Request", source_id=sync_source_id
    )
    if payload.metrics.unsyncedEvents > 0 and await system_setting_enabled(
        db, NOTIFY_SYNC_DELAY_KEY
    ):
        sync_alert = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Warning",
            requester=account.display_name,
            enterprise=enterprise_name(account),
            summary=(
                f"{payload.metrics.unsyncedEvents} desktop record"
                f"{'' if payload.metrics.unsyncedEvents == 1 else 's'} waiting to upload."
            ),
            required_action="Review the desktop app connection and retry the upload.",
            resolution_mode="Remote Review",
            owner="IT",
            source_id=sync_source_id,
        )
        sync_alert_summary = to_operational_alert_summary(sync_alert)
        if existing_sync_alert is None:
            await notify_it_technical_issue(db, account, sync_alert_summary)
    elif payload.metrics.unsyncedEvents == 0:
        await resolve_and_publish_it_alert(
            db,
            alert_type="Maintenance Request",
            source_id=sync_source_id,
            recovery_message="Visitor data is uploading normally again.",
        )

    session_error_setting_key = (
        NOTIFY_CAMERA_SESSION_ERROR_KEY
        if payload.session.cameraId is not None or payload.session.cameraName
        else NOTIFY_GATEWAY_SERVICE_ERROR_KEY
    )
    session_source_id = f"telemetry:{account.id}:{payload.session.cameraId or 'gateway'}"
    existing_session_alert = await get_active_operational_alert(
        db, alert_type="Maintenance Request", source_id=session_source_id
    )
    if payload.session.error and await system_setting_enabled(db, session_error_setting_key):
        maintenance_alert = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Critical",
            requester=account.display_name,
            enterprise=enterprise_name(account),
            summary=payload.session.error,
            required_action="Review the camera or desktop app error and restore monitoring.",
            resolution_mode="Remote Review",
            owner="IT",
            source_id=session_source_id,
        )
        maintenance_alert_summary = to_operational_alert_summary(maintenance_alert)
        if existing_session_alert is None:
            await notify_it_technical_issue(db, account, maintenance_alert_summary)
            await record_operational_log(
                db,
                category="Enterprise Activity",
                severity="Warning",
                actor=enterprise_name(account),
                actor_role="Enterprise Account",
                action="Desktop Application Problem",
                target=enterprise_name(account),
                summary=f"{enterprise_name(account)} reported a desktop application problem: {payload.session.error}",
                source_id=maintenance_alert.id,
                metadata={
                    "enterpriseId": snapshot.enterpriseId,
                    "cameraName": snapshot.cameraName,
                    "status": snapshot.status,
                },
            )
    elif not payload.session.error:
        await resolve_and_publish_it_alert(
            db,
            alert_type="Maintenance Request",
            source_id=session_source_id,
            recovery_message="The camera or desktop application is working normally again.",
        )

    return snapshot


async def notify_it_technical_issue(
    db: AsyncSession, actor: Account, alert: OperationalAlertSummary
) -> None:
    affected_name = alert.enterprise or alert.requester
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.IT],
        title=f"{affected_name} has a technical issue.",
        message=f"{alert.summary} {alert.requiredAction}",
        notification_type="Technical Issue",
        severity=alert.severity,
        actor=actor,
        source_type="operational.alert",
        source_id=alert.id,
        replace_existing_for_source=True,
    )


async def resolve_and_publish_it_alert(
    db: AsyncSession,
    *,
    alert_type: str,
    source_id: str,
    recovery_message: str,
) -> None:
    resolved = await resolve_operational_alert(
        db,
        alert_type=alert_type,
        source_id=source_id,
        recovery_message=recovery_message,
    )
    if resolved is None:
        return
    summary = to_operational_alert_summary(resolved)
    await mark_source_notifications_read(db, source_type="operational.alert", source_id=summary.id)
    await record_operational_log(
        db,
        category="System",
        severity="Success",
        actor="TANAW",
        actor_role="System",
        action="Technical Issue Resolved",
        target=resolved.enterprise or resolved.requester,
        summary=recovery_message,
        source_id=resolved.id,
        metadata={"alertType": resolved.alert_type, "status": resolved.status},
    )


@router.post(
    "/desktop/report-submissions",
    response_model=IntakeReportSummary,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_desktop_report_submission(
    payload: DesktopReportSubmissionIngest,
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IntakeReportSummary:
    try:
        report = await ingest_report_submission(db, account, payload)
    except DuplicateReportPeriodError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await notify_staff_report_submission(db, account, report)
    await record_operational_log(
        db,
        category="Staff Submission",
        severity="Success",
        actor=enterprise_name(account),
        actor_role="Enterprise Account",
        action="Submit Enterprise Report",
        target=report.enterprise,
        summary=f"{report.enterprise} submitted {report.code} for {report.period}.",
        source_id=report.id,
        metadata={
            "enterpriseId": report.enterpriseId,
            "period": report.period,
            "uniqueCount": report.metrics["unique"],
        },
    )
    return report


@router.get("/desktop/sample-preparation", response_model=SamplePreparationSummary | None)
async def get_desktop_sample_preparation(
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SamplePreparationSummary | None:
    if get_settings().is_production:
        return None
    marker = await db.scalar(
        select(Account.id).where(Account.email == sample_dataset_marker_email())
    )
    if marker is None:
        return None
    enterprise_id = enterprise_identifier(account)
    candidates = prepared_counts(enterprise_id)
    candidate_periods = [str(candidate["period"]) for candidate in candidates]
    submitted_periods = set(
        (
            await db.scalars(
                select(EnterpriseReportSubmission.period).where(
                    EnterpriseReportSubmission.enterprise_profile_id == account.id,
                    EnterpriseReportSubmission.period.in_(candidate_periods),
                )
            )
        ).all()
    )
    pending_counts = [
        SamplePreparationCounts.model_validate(candidate)
        for candidate in candidates
        if candidate["period"] not in submitted_periods
    ]
    return SamplePreparationSummary(
        enterpriseId=enterprise_id,
        enterpriseName=enterprise_name(account),
        counts=pending_counts[0] if pending_counts else None,
        pendingCounts=pending_counts,
    )


@router.get("/telemetry/latest", response_model=list[TelemetrySnapshotSummary])
async def get_latest_telemetry(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TelemetrySnapshotSummary]:
    return await list_latest_telemetry(db, account)


@router.get("/telemetry/summary", response_model=OperationalSummary)
async def get_summary(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperationalSummary:
    return await get_operational_summary(db, account)


@router.get("/visitor-insights", response_model=VisitorInsightsSummary)
async def get_admin_visitor_insights(
    _: AdminAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    range_value: Annotated[VisitorInsightRange, Query(alias="range")] = "7d",
    enterprise_id: Annotated[str | None, Query(alias="enterpriseId")] = None,
    barangay: str | None = None,
) -> VisitorInsightsSummary:
    if enterprise_id and barangay:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose either an establishment or a barangay insight scope.",
        )
    return await get_visitor_insights(
        db,
        range_value,
        enterprise_id=enterprise_id,
        barangay=barangay,
    )


@router.get("/reports/intake", response_model=list[IntakeReportSummary])
async def list_intake_report_submissions(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[IntakeReportSummary]:
    return await list_intake_reports(db, account)


@router.patch("/reports/intake/{report_id}/status", response_model=IntakeReportSummary)
async def update_intake_report_status(
    report_id: str,
    payload: ReportStatusUpdate,
    actor: StaffWorkflowAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IntakeReportSummary:
    try:
        report = await update_report_status(db, report_id, payload)
    except InvalidReportWorkflowError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")

    await record_operational_log(
        db,
        category="Staff Operation",
        severity="Warning" if payload.status == "Returned" else "Success",
        actor=actor.display_name,
        actor_role="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
        action=f"Report {payload.status}",
        target=report.enterprise,
        summary=f"{actor.display_name} marked {report.code} from {report.enterprise} as {payload.status}.",
        source_id=report.id,
        metadata={
            "enterpriseId": report.enterpriseId,
            "period": report.period,
            "remarks": payload.remarks,
        },
    )
    return report


@router.get("/reports/final", response_model=list[FinalReportSummary])
async def list_final_report_submissions(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[FinalReportSummary]:
    return await list_final_report_records(db, account)


@router.post(
    "/reports/final", response_model=FinalReportSummary, status_code=status.HTTP_201_CREATED
)
async def generate_final_report(
    payload: FinalReportCreate,
    actor: StaffWorkflowAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FinalReportSummary:
    try:
        final_report = await create_final_report(db, payload)
    except InvalidReportWorkflowError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if final_report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No report submissions were found for consolidation.",
        )

    await record_operational_log(
        db,
        category="Staff Operation",
        severity="Success",
        actor=actor.display_name,
        actor_role="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
        action="Generate Final Report",
        target=final_report.id,
        summary=f"{actor.display_name} generated {final_report.id} from {len(final_report.sources)} ready submissions.",
        source_id=final_report.id,
        metadata={"reportCount": len(final_report.sources), "period": final_report.period},
    )
    return final_report


@router.post("/reports/final/{report_id}/return-revision", response_model=FinalReportSummary)
async def return_final_report_revision(
    report_id: str,
    payload: FinalReportRevisionReturn,
    actor: StaffWorkflowAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FinalReportSummary:
    try:
        final_report = await return_final_report_for_revision(db, report_id, payload)
    except InvalidReportWorkflowError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if final_report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Final report not found.")

    await record_operational_log(
        db,
        category="Staff Operation",
        severity="Warning",
        actor=actor.display_name,
        actor_role="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
        action="Return Final Report for Revision",
        target=final_report.id,
        summary=f"{actor.display_name} returned {final_report.id} for source report revision.",
        source_id=final_report.id,
        metadata={
            "period": final_report.period,
            "sourceReportIds": ",".join(payload.sourceReportIds),
            "remarks": payload.remarks,
        },
    )
    return final_report


@router.patch("/reports/final/{report_id}/status", response_model=FinalReportSummary)
async def update_final_report_workflow_status(
    report_id: str,
    payload: FinalReportStatusUpdate,
    actor: StaffWorkflowAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FinalReportSummary:
    try:
        final_report = await update_final_report_status(db, report_id, payload)
    except InvalidReportWorkflowError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if final_report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Final report not found.")

    await record_operational_log(
        db,
        category="Staff Operation",
        severity="Success",
        actor=actor.display_name,
        actor_role="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
        action=f"Final Report {final_report.status}",
        target=final_report.id,
        summary=f"{actor.display_name} changed final report {final_report.id} to {final_report.status}.",
        source_id=final_report.id,
        metadata={
            "period": final_report.period,
            "status": final_report.status,
            "requestedStatus": payload.status,
            "archivedFromStatus": final_report.archivedFromStatus,
        },
    )
    return final_report


@router.get("/reports/enterprises")
async def list_report_enterprises(
    account: Annotated[Account, Depends(get_current_operational_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
    statement = (
        select(Account)
        .join(Account.enterprise_profile)
        .where(
            Account.role == AccountRole.ENTERPRISE,
            Account.status == AccountStatus.ACTIVE,
            Account.activated_at.is_not(None),
        )
        .order_by(EnterpriseProfile.enterprise_name.asc(), Account.display_name.asc())
    )
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(Account.id == account.id)

    result = await db.scalars(statement)
    return [
        {
            "id": require_enterprise_profile(account).enterprise_id,
            "name": require_enterprise_profile(account).enterprise_name,
            "category": format_enterprise_category(require_enterprise_profile(account).category)
            or "Uncategorized",
            "barangay": require_enterprise_profile(account).barangay or "Unassigned",
            "complianceOwner": require_enterprise_profile(account).manager_name or account.email,
        }
        for account in result
    ]


@router.get("/tickets", response_model=list[SupportTicketSummary])
async def list_tickets(
    account: TicketReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[SupportTicketSummary]:
    return await list_support_tickets(db, account)


@router.get("/tickets/{ticket_id}", response_model=SupportTicketDetail)
async def get_ticket_detail(
    ticket_id: str,
    account: TicketReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SupportTicketDetail:
    ticket = await get_support_ticket_detail(db, account, ticket_id)
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Support ticket not found."
        )
    return ticket


@router.get("/tickets/{ticket_id}/attachments/{attachment_index}")
async def get_ticket_attachment(
    ticket_id: str,
    attachment_index: int,
    account: TicketReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    ticket = await get_support_ticket_for_account(db, account, ticket_id)
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Support ticket not found."
        )
    attachments = parse_ticket_attachments(ticket.attachments_json)
    if attachment_index < 0 or attachment_index >= len(attachments):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found.")

    attachment = attachments[attachment_index]
    prefix = f"data:{attachment.mediaType};base64,"
    try:
        content = base64.b64decode(attachment.dataUrl.removeprefix(prefix), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Attachment data is not available.",
        ) from exc

    safe_file_name = attachment.fileName.replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=content,
        media_type=attachment.mediaType,
        headers={"Content-Disposition": f'inline; filename="{safe_file_name}"'},
    )


@router.post(
    "/tickets",
    response_model=SupportTicketSummary,
    status_code=status.HTTP_201_CREATED,
)
async def create_enterprise_support_ticket(
    payload: SupportTicketCreate,
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SupportTicketSummary:
    ticket = await create_support_ticket(db, account, payload)
    enterprise = enterprise_name(account)
    severity = "Warning" if ticket.priority in {"High", "Urgent"} else "Info"
    attachment_count = len(ticket.attachments)
    attachment_suffix = (
        f" Includes {attachment_count} photo attachment{'s' if attachment_count != 1 else ''}."
        if attachment_count
        else ""
    )
    await create_role_notifications(
        db,
        recipient_roles=support_ticket_notification_roles(ticket.priority),
        title=f"{enterprise} submitted support ticket {ticket.code}.",
        message=f"{enterprise} submitted a {ticket.category.lower()} ticket: {ticket.subject}.{attachment_suffix}",
        notification_type="Enterprise Support Ticket",
        severity=severity,
        actor=account,
        source_type="support.ticket",
        source_id=ticket.id,
        replace_existing_for_source=True,
    )
    await record_operational_log(
        db,
        category="Enterprise Activity",
        severity=severity,
        actor=enterprise,
        actor_role="Enterprise Account",
        action="Submit Support Ticket",
        target=ticket.code,
        summary=f"{enterprise} submitted {ticket.code}: {ticket.subject}.",
        source_id=ticket.id,
        metadata={
            "enterpriseId": ticket.enterpriseId,
            "category": ticket.category,
            "priority": ticket.priority,
            "attachmentCount": attachment_count,
        },
    )
    return ticket


@router.post("/tickets/{ticket_id}/messages", response_model=SupportTicketDetail)
async def create_ticket_message(
    ticket_id: str,
    payload: SupportTicketMessageCreate,
    account: TicketMessageAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SupportTicketDetail:
    ticket = await get_support_ticket_for_account(db, account, ticket_id, for_update=True)
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Support ticket not found."
        )
    try:
        if account.role == AccountRole.IT:
            detail, reply_record = await create_support_ticket_message_with_record(
                db,
                ticket,
                account,
                payload,
                commit=False,
            )
        else:
            detail = await create_support_ticket_message(db, ticket, account, payload)
            reply_record = None
    except ResolvedTicketConversationError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ticket_resolved",
                "message": "This ticket is resolved. The conversation is now closed.",
            },
        ) from exc
    if account.role == AccountRole.IT:
        recipient = await get_account_by_id(db, ticket.enterprise_profile_id)
        if recipient is not None and reply_record is not None:
            await enqueue_email(
                db,
                account_id=recipient.id,
                source_id=reply_record.id,
                recipient=recipient.email,
                template_name=EmailTemplateName.SUPPORT_REPLY,
                template_payload={
                    "ticketId": ticket.id,
                    "messageId": reply_record.id,
                    "recipientName": recipient.display_name,
                },
                idempotency_key=email_idempotency_key("support-reply", reply_record.id),
                tags={"category": "support_reply"},
            )
        await db.commit()
        await notify_enterprise_ticket_update(
            db,
            ticket=detail,
            actor=account,
            title=f"IT replied to support ticket {detail.code}.",
            message=f"IT replied to {detail.code}: {detail.subject}.",
            notification_type="Support Ticket Reply",
            severity="Info",
        )
    else:
        await create_role_notifications(
            db,
            recipient_roles=[AccountRole.IT],
            title=f"{detail.enterpriseName} replied to support ticket {detail.code}.",
            message=f"New enterprise response on {detail.code}: {detail.subject}.",
            notification_type="Enterprise Support Reply",
            severity="Info",
            actor=account,
            source_type="support.ticket",
            source_id=detail.id,
            replace_existing_for_source=True,
        )
    actor_role = "IT Personnel" if account.role == AccountRole.IT else "Enterprise Account"
    activity_category = "IT Activity" if account.role == AccountRole.IT else "Enterprise Activity"
    await record_operational_log(
        db,
        category=activity_category,
        severity="Success",
        actor=account.display_name,
        actor_role=actor_role,
        action="Reply Support Ticket",
        target=detail.code,
        summary=f"{account.display_name} replied to {detail.code} from {detail.enterpriseName}.",
        source_id=detail.id,
        metadata={"enterpriseId": detail.enterpriseId, "ticketCode": detail.code},
    )
    return detail


@router.patch("/tickets/{ticket_id}/status", response_model=SupportTicketDetail)
async def update_ticket_status(
    ticket_id: str,
    payload: SupportTicketStatusUpdate,
    account: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SupportTicketDetail:
    ticket = await get_support_ticket_for_account(db, account, ticket_id, for_update=True)
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Support ticket not found."
        )
    previous_status = ticket.status
    detail = await update_support_ticket_status(db, ticket, account, payload)
    if previous_status != detail.status:
        await notify_enterprise_ticket_update(
            db,
            ticket=detail,
            actor=account,
            title=f"Support ticket {detail.code} is now {detail.status}.",
            message=f"IT updated {detail.code} status from {previous_status} to {detail.status}.",
            notification_type="Support Ticket Status",
            severity="Success" if detail.status == "Resolved" else "Info",
        )
        if detail.status == "Resolved":
            await mark_source_notifications_read(
                db,
                source_type="support.ticket",
                source_id=detail.id,
                recipient_role=AccountRole.IT,
            )
        await record_operational_log(
            db,
            category="IT Activity",
            severity="Success",
            actor=account.display_name,
            actor_role="IT Personnel",
            action="Update Support Ticket Status",
            target=detail.code,
            summary=(
                f"{account.display_name} updated {detail.code} from "
                f"{previous_status} to {detail.status}."
            ),
            source_id=detail.id,
            metadata={
                "enterpriseId": detail.enterpriseId,
                "ticketCode": detail.code,
                "status": detail.status,
            },
        )
    return detail


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


@router.get("/map-enterprises")
async def list_map_enterprises(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
    latest = {item.enterpriseId: item for item in await list_latest_telemetry(db, account)}
    statement = (
        select(Account)
        .join(Account.enterprise_profile)
        .where(
            Account.role == AccountRole.ENTERPRISE,
            Account.status == AccountStatus.ACTIVE,
            Account.activated_at.is_not(None),
        )
        .order_by(EnterpriseProfile.enterprise_name.asc(), Account.display_name.asc())
    )
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(Account.id == account.id)

    result = await db.scalars(statement)
    enterprises = []
    for enterprise in result:
        profile = require_enterprise_profile(enterprise)
        telemetry = latest.get(enterprise_identifier(enterprise))
        enterprises.append(
            {
                "id": profile.enterprise_id,
                "name": profile.enterprise_name,
                "barangay": profile.barangay or "Unassigned",
                "category": format_enterprise_category(profile.category) or "Uncategorized",
                "fullAddress": profile.address or "Address not provided",
                "lat": profile.latitude,
                "lng": profile.longitude,
                "totalLiveOccupancy": telemetry.currentOccupancy if telemetry else 0,
                "estimatedUniqueCount": telemetry.uniqueCount if telemetry else 0,
                "status": enterprise_status_from_telemetry(telemetry),
                "contact": enterprise.phone or enterprise.email,
                "lastSync": telemetry.receivedAt.isoformat() if telemetry else None,
                "gatewayStatus": telemetry.gatewayStatus
                if telemetry
                else profile.gateway_status or "Not Linked",
            }
        )
    return enterprises


@router.get("/alerts", response_model=list[OperationalAlertSummary])
async def list_alerts(
    account: AlertReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[OperationalAlertSummary]:
    return await list_operational_alerts(db, account)


@router.patch("/alerts/{alert_code}/status", response_model=OperationalAlertSummary)
async def update_alert_status(
    alert_code: str,
    payload: OperationalAlertStatusUpdate,
    actor: AlertManageAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperationalAlertSummary:
    alert = await db.scalar(
        select(OperationalAlert).where(OperationalAlert.alert_code == alert_code)
    )
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found.")
    if not can_manage_operational_alert(actor, alert):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This situation is assigned to a different account type.",
        )
    previous_status = alert.status
    alert.status = payload.status
    await db.commit()
    await db.refresh(alert)
    alert_summary = to_operational_alert_summary(alert)
    if payload.status == "Resolved":
        await mark_source_notifications_read(
            db, source_type="operational.alert", source_id=alert_summary.id
        )
    actor_role = "Admin" if actor.role == AccountRole.ADMIN else "IT Personnel"
    activity_category = "Admin Operation" if actor.role == AccountRole.ADMIN else "IT Activity"
    await record_operational_log(
        db,
        category=activity_category,
        severity="Success" if payload.status == "Resolved" else "Info",
        actor=actor.display_name,
        actor_role=actor_role,
        action=f"Alert {payload.status}",
        target=alert.enterprise or alert.requester,
        summary=f"{actor.display_name} marked {alert.alert_code} as {payload.status}.",
        source_id=alert.id,
        metadata={"previousStatus": previous_status, "newStatus": payload.status},
    )
    return alert_summary


@router.get("/system-activities")
async def list_system_activities(
    _: Annotated[Account, Depends(get_current_operational_account)],
) -> list[dict]:
    return []


@router.get("/system-logs")
async def list_system_logs(
    _: Annotated[Account, Depends(get_current_operational_account)],
) -> list[dict]:
    return []


@router.get("/lgu-accounts")
async def list_lgu_accounts(
    _: Annotated[Account, Depends(get_current_operational_account)],
) -> list[dict]:
    return []


@router.get("/enterprise-accounts")
async def list_enterprise_accounts(
    _: Annotated[Account, Depends(get_current_operational_account)],
) -> list[dict]:
    return []


async def notify_enterprise_ticket_update(
    db: AsyncSession,
    *,
    ticket: SupportTicketDetail,
    actor: Account,
    title: str,
    message: str,
    notification_type: str,
    severity: str,
) -> None:
    recipient = await get_enterprise_notification_recipient(db, ticket.enterpriseId)
    if (
        recipient is None
        or recipient.status != AccountStatus.ACTIVE
        or recipient.activated_at is None
    ):
        return
    await create_user_notification(
        db,
        recipient=recipient,
        title=title,
        message=message,
        notification_type=notification_type,
        severity=severity,
        actor=actor,
        source_type="support.ticket",
        source_id=ticket.id,
    )


async def notify_staff_report_submission(
    db: AsyncSession, actor: Account, report: IntakeReportSummary
) -> None:
    is_resubmission = staff_report_notification_is_resubmission(report)
    action_label = "resubmitted" if is_resubmission else "submitted"
    notification_type = (
        STAFF_REPORT_RESUBMITTED_NOTIFICATION
        if is_resubmission
        else STAFF_REPORT_SUBMITTED_NOTIFICATION
    )
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.STAFF],
        title=notification_type,
        message=f"{report.enterprise} {action_label} {report.code} for {report.period}.",
        notification_type=notification_type,
        severity="Info",
        actor=actor,
        source_type="enterprise.report",
        source_id=report.id,
    )


def staff_report_notification_is_resubmission(report: IntakeReportSummary) -> bool:
    payload_status = (report.payload or {}).get("status")
    return isinstance(payload_status, str) and payload_status.strip().lower() == "resubmitted"


def support_ticket_notification_roles(priority: str) -> list[AccountRole]:
    if priority in {"High", "Urgent"}:
        return [AccountRole.ADMIN, AccountRole.IT]
    return [AccountRole.IT]


async def record_operational_log(
    db: AsyncSession,
    *,
    category: str,
    severity: str,
    actor: str,
    actor_role: str,
    action: str,
    target: str,
    summary: str,
    source_id: str,
    metadata: dict[str, str | int | float | bool | None] | None = None,
) -> None:
    await create_activity_log(
        db,
        ActivityLogCreate(
            category=category,  # type: ignore[arg-type]
            severity=severity,  # type: ignore[arg-type]
            actor=actor,
            actorRole=actor_role,  # type: ignore[arg-type]
            action=action,
            target=target,
            summary=summary,
            sourceId=source_id,
            metadata=metadata,
        ),
    )


def enterprise_status_from_telemetry(telemetry: TelemetrySnapshotSummary | None) -> str:
    if telemetry is None:
        return "Inactive"
    if telemetry.error or telemetry.status == "error":
        return "Critical"
    if telemetry.gatewayStatus == "Offline":
        return "Offline"
    if telemetry.gatewayStatus == "Sync Delayed" or telemetry.unsyncedEvents > 0:
        return "Warning"
    return "Normal"
