import base64
import binascii
import json
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.core.websocket_auth import receive_websocket_bearer_token
from app.db.session import AsyncSessionLocal, get_db
from app.features.accounts.dependencies import (
    get_current_operational_account,
    is_token_invalidated,
    require_roles,
)
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.options import format_enterprise_category
from app.features.accounts.service import get_account_by_id
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.activity_logs.websocket import activity_log_manager
from app.features.operational.models import MockDataRun, OperationalAlert
from app.features.operational.schemas import (
    DesktopReportSubmissionIngest,
    DesktopTelemetryIngest,
    EnterpriseNotificationCreate,
    FinalReportCreate,
    FinalReportStatusUpdate,
    FinalReportSummary,
    FleetSimulationEnterpriseSummary,
    FleetSimulationTickIngest,
    FleetSimulationTickSummary,
    IntakeReportSummary,
    MockPreparationCounts,
    MockPreparationSummary,
    NotificationReadUpdate,
    OperationalAlertStatusUpdate,
    OperationalAlertSummary,
    OperationalSummary,
    OperationalWebSocketEnvelope,
    ReportStatusUpdate,
    SupportTicketCreate,
    SupportTicketDetail,
    SupportTicketMessageCreate,
    SupportTicketStatusUpdate,
    SupportTicketSummary,
    TelemetrySnapshotSummary,
    UserNotificationSummary,
)
from app.features.operational.service import (
    NOTIFY_CAMERA_SESSION_ERROR_KEY,
    NOTIFY_GATEWAY_SERVICE_ERROR_KEY,
    NOTIFY_SYNC_DELAY_KEY,
    DuplicateReportPeriodError,
    build_fleet_simulation_telemetry_payload,
    create_final_report,
    create_operational_alert,
    create_role_notifications,
    create_support_ticket,
    create_support_ticket_message,
    create_user_notification,
    enterprise_accounts_by_identifier,
    enterprise_identifier,
    evaluate_telemetry_alerts,
    get_enterprise_notification_recipient,
    get_operational_summary,
    get_support_ticket_detail,
    get_support_ticket_for_account,
    ingest_report_submission,
    ingest_telemetry,
    list_fleet_simulation_enterprises,
    list_intake_reports,
    list_latest_telemetry,
    list_operational_alerts,
    list_support_tickets,
    list_user_notifications,
    parse_ticket_attachments,
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
from app.features.operational.websocket import operational_ws_manager

router = APIRouter(prefix="/operational", tags=["operational"])

OperationalReadAccount = Annotated[
    Account, Depends(require_roles({"admin", "it", "staff", "enterprise"}))
]
TicketReadAccount = Annotated[Account, Depends(require_roles({"admin", "it", "enterprise"}))]
EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]
StaffWorkflowAccount = Annotated[Account, Depends(require_roles({"admin", "staff"}))]
ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
AlertReadAccount = Annotated[Account, Depends(require_roles({"admin", "it"}))]


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
    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(
            type="telemetry.snapshot", data=snapshot.model_dump(mode="json")
        )
    )
    await broadcast_summary(db)
    for event_type, alert_summary in await evaluate_telemetry_alerts(db, account, payload):
        await operational_ws_manager.broadcast(
            OperationalWebSocketEnvelope(
                type=event_type,  # type: ignore[arg-type]
                data=alert_summary.model_dump(mode="json"),
            )
        )

    if payload.metrics.unsyncedEvents > 0 and await system_setting_enabled(
        db, NOTIFY_SYNC_DELAY_KEY
    ):
        sync_alert = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Warning",
            requester=account.display_name,
            enterprise=account.enterprise_name or account.display_name,
            summary=(
                f"{payload.metrics.unsyncedEvents} telemetry event"
                f"{'' if payload.metrics.unsyncedEvents == 1 else 's'} remain unsynced."
            ),
            required_action="Review cloud synchronization and retry failed telemetry sync.",
            resolution_mode="Remote Review",
            owner="IT",
            source_id=f"sync-failed:{account.id}",
        )
        await operational_ws_manager.broadcast(
            OperationalWebSocketEnvelope(
                type="alert.updated",
                data=to_operational_alert_summary(sync_alert).model_dump(mode="json"),
            )
        )

    session_error_setting_key = (
        NOTIFY_CAMERA_SESSION_ERROR_KEY
        if payload.session.cameraId is not None or payload.session.cameraName
        else NOTIFY_GATEWAY_SERVICE_ERROR_KEY
    )
    if payload.session.error and await system_setting_enabled(db, session_error_setting_key):
        maintenance_alert = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Critical",
            requester=account.display_name,
            enterprise=account.enterprise_name or account.display_name,
            summary=payload.session.error,
            required_action="Review the camera or gateway error and restore monitoring.",
            resolution_mode="Remote Review",
            owner="IT",
            source_id=f"telemetry:{account.id}:{payload.session.cameraId or 'gateway'}",
        )
        await operational_ws_manager.broadcast(
            OperationalWebSocketEnvelope(
                type="alert.updated",
                data=to_operational_alert_summary(maintenance_alert).model_dump(mode="json"),
            )
        )
        await record_operational_log(
            db,
            category="Enterprise Activity",
            severity="Warning",
            actor=account.enterprise_name or account.display_name,
            actor_role="Enterprise Account",
            action="Gateway Telemetry Error",
            target=account.enterprise_name or account.email,
            summary=f"{account.enterprise_name or account.display_name} reported gateway status {payload.session.status}: {payload.session.error}",
            source_id=snapshot.id,
            metadata={
                "enterpriseId": snapshot.enterpriseId,
                "cameraName": snapshot.cameraName,
                "status": snapshot.status,
            },
        )

    return snapshot


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
    envelope = OperationalWebSocketEnvelope(
        type="report.submitted", data=report.model_dump(mode="json")
    )
    await operational_ws_manager.broadcast(envelope)
    await broadcast_summary(db)
    await record_operational_log(
        db,
        category="Staff Submission",
        severity="Success",
        actor=account.enterprise_name or account.display_name,
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


@router.get("/desktop/mock-preparation", response_model=MockPreparationSummary | None)
async def get_desktop_mock_preparation(
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MockPreparationSummary | None:
    run = await db.scalar(
        select(MockDataRun)
        .where(
            MockDataRun.target_account_id == account.id,
        )
        .order_by(MockDataRun.created_at.desc())
    )
    if run is None:
        return None

    prepared_counts: MockPreparationCounts | None = None
    if run.status == "active" and run.generated_counts_json:
        generated_counts = json.loads(run.generated_counts_json)
        candidate = generated_counts.get("targetPreparedCounts")
        if isinstance(candidate, dict):
            prepared_counts = MockPreparationCounts.model_validate(candidate)

    return MockPreparationSummary(
        runId=run.id,
        status=run.status,  # type: ignore[arg-type]
        enterpriseId=run.target_enterprise_id or enterprise_identifier(account),
        enterpriseName=run.target_enterprise_name
        or account.enterprise_name
        or account.display_name,
        counts=prepared_counts,
    )


@router.get(
    "/simulation/fleet/enterprises",
    response_model=list[FleetSimulationEnterpriseSummary],
)
async def list_fleet_simulation_targets(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[FleetSimulationEnterpriseSummary]:
    ensure_simulation_api_allowed()
    return await list_fleet_simulation_enterprises(db, account)


@router.post(
    "/simulation/fleet/tick",
    response_model=FleetSimulationTickSummary,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_fleet_simulation_tick(
    payload: FleetSimulationTickIngest,
    _: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FleetSimulationTickSummary:
    ensure_simulation_api_allowed()
    accounts = await enterprise_accounts_by_identifier(
        db, {target.enterpriseId for target in payload.targets}
    )
    snapshots: list[TelemetrySnapshotSummary] = []
    alerts: list[OperationalAlertSummary] = []

    for target in payload.targets:
        enterprise = accounts.get(target.enterpriseId)
        if enterprise is None:
            continue

        telemetry_payload = build_fleet_simulation_telemetry_payload(
            target=target,
            enterprise=enterprise,
            run_id=payload.runId,
            started_at=payload.startedAt,
            elapsed_seconds=payload.elapsedSeconds,
        )
        snapshot = await ingest_telemetry(
            db,
            enterprise,
            telemetry_payload,
            update_account_gateway=False,
        )
        snapshots.append(snapshot)
        await operational_ws_manager.broadcast(
            OperationalWebSocketEnvelope(
                type="telemetry.snapshot", data=snapshot.model_dump(mode="json")
            )
        )

        for event_type, alert_summary in await evaluate_telemetry_alerts(
            db, enterprise, telemetry_payload
        ):
            alerts.append(alert_summary)
            await operational_ws_manager.broadcast(
                OperationalWebSocketEnvelope(
                    type=event_type,  # type: ignore[arg-type]
                    data=alert_summary.model_dump(mode="json"),
                )
            )

    if snapshots:
        await broadcast_summary(db)

    return FleetSimulationTickSummary(
        runId=payload.runId,
        snapshots=snapshots,
        alerts=alerts,
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
    report = await update_report_status(db, report_id, payload)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")

    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(type="report.updated", data=report.model_dump(mode="json"))
    )
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
    final_report = await create_final_report(db, payload)
    if final_report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No report submissions were found for consolidation.",
        )

    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(
            type="final_report.generated", data=final_report.model_dump(mode="json")
        )
    )
    await broadcast_summary(db)
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


@router.patch("/reports/final/{report_id}/status", response_model=FinalReportSummary)
async def update_final_report_workflow_status(
    report_id: str,
    payload: FinalReportStatusUpdate,
    actor: StaffWorkflowAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FinalReportSummary:
    final_report = await update_final_report_status(db, report_id, payload)
    if final_report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Final report not found.")

    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(
            type="final_report.updated", data=final_report.model_dump(mode="json")
        )
    )
    await record_operational_log(
        db,
        category="Staff Operation",
        severity="Success",
        actor=actor.display_name,
        actor_role="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
        action=f"Final Report {payload.status}",
        target=final_report.id,
        summary=f"{actor.display_name} changed final report {final_report.id} to {payload.status}.",
        source_id=final_report.id,
        metadata={"period": final_report.period, "status": payload.status},
    )
    return final_report


@router.get("/reports/enterprises")
async def list_report_enterprises(
    account: Annotated[Account, Depends(get_current_operational_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
    statement = (
        select(Account)
        .where(Account.role == AccountRole.ENTERPRISE, Account.status == AccountStatus.ACTIVE)
        .order_by(Account.enterprise_name.asc(), Account.display_name.asc())
    )
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(Account.id == account.id)

    result = await db.scalars(statement)
    return [
        {
            "id": account.enterprise_id or account.id,
            "name": account.enterprise_name or account.display_name,
            "category": format_enterprise_category(account.category) or "Uncategorized",
            "barangay": account.barangay or "Unassigned",
            "complianceOwner": account.manager_name or account.email,
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
    enterprise = account.enterprise_name or account.display_name
    severity = "Warning" if ticket.priority in {"High", "Urgent"} else "Info"
    attachment_count = len(ticket.attachments)
    attachment_suffix = (
        f" Includes {attachment_count} photo attachment{'s' if attachment_count != 1 else ''}."
        if attachment_count
        else ""
    )
    notifications = await create_role_notifications(
        db,
        recipient_roles=support_ticket_notification_roles(ticket.category),
        title=f"{enterprise} submitted support ticket {ticket.code}.",
        message=f"{enterprise} submitted a {ticket.category.lower()} ticket: {ticket.subject}.{attachment_suffix}",
        notification_type="Enterprise Support Ticket",
        severity=severity,
        actor=account,
        source_type="support.ticket",
        source_id=ticket.id,
    )
    for notification in notifications:
        await operational_ws_manager.broadcast(
            OperationalWebSocketEnvelope(
                type="notification.created",
                data=notification.model_dump(mode="json"),
            )
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
    account: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SupportTicketDetail:
    ticket = await get_support_ticket_for_account(db, account, ticket_id)
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Support ticket not found."
        )
    detail = await create_support_ticket_message(db, ticket, account, payload)
    await notify_enterprise_ticket_update(
        db,
        ticket=detail,
        actor=account,
        title=f"IT replied to support ticket {detail.code}.",
        message=f"IT replied to {detail.code}: {detail.subject}.",
        notification_type="Support Ticket Reply",
        severity="Info",
    )
    await record_operational_log(
        db,
        category="IT Activity",
        severity="Success",
        actor=account.display_name,
        actor_role="IT Personnel",
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
    ticket = await get_support_ticket_for_account(db, account, ticket_id)
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
    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(
            type="notification.updated",
            data=notification.model_dump(mode="json"),
        )
    )
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
    if recipient is None or recipient.status != AccountStatus.ACTIVE:
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
    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(
            type="notification.created",
            data=notification.model_dump(mode="json"),
        )
    )
    log = await create_activity_log(
        db,
        ActivityLogCreate(
            category="Staff Operation",
            severity="Success",
            actor=actor.display_name,
            actorRole="LGU Staff" if actor.role == AccountRole.STAFF else "Admin",
            action="Notify Enterprise",
            target=recipient.enterprise_name or recipient.display_name,
            summary=(
                f"{actor.display_name} notified "
                f"{recipient.enterprise_name or recipient.display_name}: {payload.message}"
            ),
            sourceId=notification.id,
        ),
    )
    await activity_log_manager.broadcast(log)
    return notification


@router.get("/map-enterprises")
async def list_map_enterprises(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
    latest = {item.enterpriseId: item for item in await list_latest_telemetry(db, account)}
    statement = (
        select(Account)
        .where(Account.role == AccountRole.ENTERPRISE, Account.status == AccountStatus.ACTIVE)
        .order_by(Account.enterprise_name.asc(), Account.display_name.asc())
    )
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(Account.id == account.id)

    result = await db.scalars(statement)
    enterprises = []
    for enterprise in result:
        telemetry = latest.get(enterprise_identifier(enterprise))
        enterprises.append(
            {
                "id": enterprise.enterprise_id or enterprise.id,
                "name": enterprise.enterprise_name or enterprise.display_name,
                "barangay": enterprise.barangay or "Unassigned",
                "category": format_enterprise_category(enterprise.category) or "Uncategorized",
                "fullAddress": enterprise.address
                or enterprise.geocoded_address
                or "Address not provided",
                "lat": enterprise.latitude,
                "lng": enterprise.longitude,
                "totalLiveOccupancy": telemetry.currentOccupancy if telemetry else 0,
                "estimatedUniqueCount": telemetry.uniqueCount if telemetry else 0,
                "status": enterprise_status_from_telemetry(telemetry),
                "contact": enterprise.phone or enterprise.email,
                "lastSync": telemetry.receivedAt.isoformat() if telemetry else None,
                "gatewayStatus": telemetry.gatewayStatus
                if telemetry
                else enterprise.gateway_status or "Not Linked",
                "sourceKind": telemetry.sourceKind if telemetry else "real",
                "mockRunId": telemetry.mockRunId if telemetry else None,
            }
        )
    return enterprises


@router.get("/alerts", response_model=list[OperationalAlertSummary])
async def list_alerts(
    _: AlertReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[OperationalAlertSummary]:
    return await list_operational_alerts(db)


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
    previous_status = alert.status
    alert.status = payload.status
    await db.commit()
    await db.refresh(alert)
    alert_summary = to_operational_alert_summary(alert)
    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(
            type="alert.resolved" if payload.status == "Resolved" else "alert.updated",
            data=alert_summary.model_dump(mode="json"),
        )
    )
    await record_operational_log(
        db,
        category="IT Activity",
        severity="Success" if payload.status == "Resolved" else "Info",
        actor=actor.display_name,
        actor_role="IT Personnel",
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


@router.websocket("/ws")
async def operational_websocket(
    websocket: WebSocket, query_token: Annotated[str | None, Query(alias="token")] = None
) -> None:
    token = await receive_websocket_bearer_token(websocket, query_token)
    if token is None:
        return

    async with AsyncSessionLocal() as db:
        account = await authenticate_websocket_account(db, token)

    if account is None:
        await websocket.close(code=1008)
        return

    await operational_ws_manager.connect(
        websocket,
        account.role.value,
        account.id,
        enterprise_identifier(account) if account.role == AccountRole.ENTERPRISE else None,
    )
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        operational_ws_manager.disconnect(websocket, account.role.value)


async def authenticate_websocket_account(db: AsyncSession, token: str) -> Account | None:
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        return None

    account_id = payload.get("sub")
    if not isinstance(account_id, str):
        return None

    account = await get_account_by_id(db, account_id)
    if (
        account is None
        or account.status != AccountStatus.ACTIVE
        or account.must_change_password
        or is_token_invalidated(payload, account)
    ):
        return None
    return account


async def broadcast_summary(db: AsyncSession) -> None:
    summary = await get_operational_summary(db, None)
    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(type="summary.updated", data=summary.model_dump(mode="json"))
    )


def ensure_simulation_api_allowed() -> None:
    settings = get_settings()
    if settings.is_production and not settings.allow_mock_data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Simulation Lab fleet endpoints are disabled in production.",
        )


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
    if recipient is None or recipient.status != AccountStatus.ACTIVE:
        return
    notification = await create_user_notification(
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
    await operational_ws_manager.broadcast(
        OperationalWebSocketEnvelope(
            type="notification.created",
            data=notification.model_dump(mode="json"),
        )
    )


def support_ticket_notification_roles(category: str) -> list[AccountRole]:
    roles = [AccountRole.ADMIN, AccountRole.IT]
    if category == "Report Concern":
        roles.append(AccountRole.STAFF)
    return roles


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
    log = await create_activity_log(
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
    await activity_log_manager.broadcast(log)


def enterprise_status_from_telemetry(telemetry: TelemetrySnapshotSummary | None) -> str:
    if telemetry is None:
        return "Warning"
    if telemetry.gatewayStatus == "Offline" or telemetry.error:
        return "Critical"
    if telemetry.gatewayStatus == "Sync Delayed" or telemetry.unsyncedEvents > 0:
        return "Warning"
    return "Normal"
