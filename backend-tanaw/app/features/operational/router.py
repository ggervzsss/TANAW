import asyncio
import json
from contextlib import suppress
from typing import Annotated

import jwt
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.core.websocket_auth import receive_websocket_bearer_token
from app.db.session import AsyncSessionLocal, get_db
from app.features.accounts.dependencies import (
    is_token_invalidated,
    require_roles,
)
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import get_account_by_id
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.activity_logs.websocket import activity_log_manager
from app.features.alerts.models import OperationalAlert
from app.features.alerts.schemas import OperationalAlertStatusUpdate, OperationalAlertSummary
from app.features.alerts.service import list_operational_alerts, to_operational_alert_summary
from app.features.assets.runtime import get_asset_storage
from app.features.assets.storage import (
    AssetStorage,
    AssetStorageError,
    AssetValidationError,
    inline_content_disposition,
    validate_image,
    verify_stored_image,
)
from app.features.events.operational_resources import enqueue_operational_resource_event
from app.features.mail.models import EmailTemplateName
from app.features.mail.service import email_idempotency_key, enqueue_email
from app.features.notifications.schemas import (
    EnterpriseNotificationCreate,
    NotificationReadUpdate,
    UserNotificationSummary,
)
from app.features.notifications.service import (
    create_role_notifications,
    create_user_notification,
    get_enterprise_notification_recipient,
    list_user_notifications,
    set_user_notification_read,
)
from app.features.operational.websocket import operational_ws_manager
from app.features.reporting.models import EnterpriseReport, ReportingObligation, ReportingPeriod
from app.features.simulation.models import MockDataRun
from app.features.simulation.schemas import MockPreparationCounts, MockPreparationSummary
from app.features.support.schemas import (
    SupportTicketCreate,
    SupportTicketDetail,
    SupportTicketMessageCreate,
    SupportTicketStatusUpdate,
    SupportTicketSummary,
)
from app.features.support.service import (
    create_support_ticket,
    create_support_ticket_message,
    create_support_ticket_message_with_record,
    enterprise_identifier,
    get_support_attachment_for_account,
    get_support_ticket_detail,
    get_support_ticket_for_account,
    list_support_tickets,
    update_support_ticket_status,
)
from app.features.topology.account_scope import load_account_topology, require_account_topology

router = APIRouter(prefix="/operational", tags=["operational"])
WEBSOCKET_REAUTH_INTERVAL_SECONDS = 30.0
AssetStorageDependency = Annotated[AssetStorage, Depends(get_asset_storage)]

OperationalReadAccount = Annotated[
    Account, Depends(require_roles({"admin", "it", "staff", "enterprise"}))
]
TicketReadAccount = Annotated[Account, Depends(require_roles({"admin", "it", "enterprise"}))]
TicketMessageAccount = Annotated[Account, Depends(require_roles({"it", "enterprise"}))]
EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]
StaffWorkflowAccount = Annotated[Account, Depends(require_roles({"admin", "staff"}))]
ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
AlertReadAccount = Annotated[Account, Depends(require_roles({"admin", "it"}))]


@router.get("/desktop/simulation-preparation/v2", response_model=MockPreparationSummary | None)
async def get_desktop_mock_preparation(
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MockPreparationSummary | None:
    topology = await require_account_topology(db, account)
    run = await db.scalar(
        select(MockDataRun)
        .where(
            MockDataRun.target_account_id == account.id,
        )
        .order_by(MockDataRun.created_at.desc())
    )
    if run is None:
        return None

    pending_counts: list[MockPreparationCounts] = []
    if run.status == "active" and run.generated_counts_json:
        generated_counts = json.loads(run.generated_counts_json)
        raw_candidates = generated_counts.get("targetPreparedReportCounts")
        candidates = raw_candidates if isinstance(raw_candidates, list) else []
        candidate_period_keys = [
            candidate["periodKey"]
            for candidate in candidates
            if isinstance(candidate, dict) and isinstance(candidate.get("periodKey"), str)
        ]
        submitted_period_keys = set(
            (
                await db.scalars(
                    select(ReportingPeriod.natural_key)
                    .join(
                        ReportingObligation,
                        ReportingObligation.reporting_period_id == ReportingPeriod.id,
                    )
                    .join(
                        EnterpriseReport,
                        EnterpriseReport.reporting_obligation_id == ReportingObligation.id,
                    )
                    .where(
                        EnterpriseReport.enterprise_id == topology.enterprise.id,
                        EnterpriseReport.classification == "simulation",
                        ReportingPeriod.natural_key.in_(candidate_period_keys),
                    )
                )
            ).all()
            if candidate_period_keys
            else []
        )
        pending_counts = [
            MockPreparationCounts.model_validate(candidate)
            for candidate in candidates
            if isinstance(candidate, dict)
            and candidate.get("periodKey") not in submitted_period_keys
        ]

    return MockPreparationSummary(
        runId=run.id,
        status=run.status,  # type: ignore[arg-type]
        enterpriseId=run.target_enterprise_id or enterprise_identifier(topology),
        enterpriseName=run.target_enterprise_name or topology.enterprise.name,
        counts=pending_counts[0] if pending_counts else None,
        pendingCounts=pending_counts,
    )


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


@router.get("/tickets/{ticket_id}/attachments/{attachment_id}")
async def get_ticket_attachment(
    ticket_id: str,
    attachment_id: str,
    account: TicketReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: AssetStorageDependency,
) -> Response:
    attachment = await get_support_attachment_for_account(
        db,
        account,
        ticket_id=ticket_id,
        attachment_id=attachment_id,
    )
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment not found.",
        )
    try:
        content = await storage.read(
            key=attachment.storage_key,
            max_bytes=attachment.size_bytes,
        )
        verify_stored_image(
            content=content,
            size_bytes=attachment.size_bytes,
            content_hash=attachment.content_hash,
        )
    except AssetStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Attachment storage is unavailable.",
        ) from exc

    return Response(
        content=content,
        media_type=attachment.mime_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": inline_content_disposition(attachment.file_name),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/tickets",
    response_model=SupportTicketSummary,
    status_code=status.HTTP_201_CREATED,
)
async def create_enterprise_support_ticket(
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: AssetStorageDependency,
    payload: Annotated[str, Form()],
    attachments: Annotated[list[UploadFile] | None, File()] = None,
) -> SupportTicketSummary:
    attachments = attachments or []
    if len(attachments) > 5:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A support ticket can contain at most five attachments.",
        )
    try:
        command = SupportTicketCreate.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(),
        ) from exc
    settings = get_settings()
    try:
        images = [
            validate_image(
                file_name=upload.filename or "",
                declared_mime_type=upload.content_type,
                content=await upload.read(settings.support_attachment_max_bytes + 1),
                max_bytes=settings.support_attachment_max_bytes,
            )
            for upload in attachments
        ]
        ticket = await create_support_ticket(
            db,
            account,
            command,
            storage=storage,
            images=images,
        )
    except AssetValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except AssetStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Attachment storage is unavailable.",
        ) from exc
    enterprise = (await require_account_topology(db, account)).enterprise.name
    severity = "Warning" if ticket.priority in {"High", "Urgent"} else "Info"
    attachment_count = len(ticket.attachments)
    attachment_suffix = (
        f" Includes {attachment_count} photo attachment{'s' if attachment_count != 1 else ''}."
        if attachment_count
        else ""
    )
    await create_role_notifications(
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
    ticket = await get_support_ticket_for_account(db, account, ticket_id)
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Support ticket not found."
        )
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
    if account.role == AccountRole.IT:
        recipient = await get_account_by_id(db, ticket.enterprise_account_id)
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
            recipient_roles=support_ticket_notification_roles(detail.category),
            title=f"{detail.enterpriseName} replied to support ticket {detail.code}.",
            message=f"New enterprise response on {detail.code}: {detail.subject}.",
            notification_type="Enterprise Support Reply",
            severity="Info",
            actor=account,
            source_type="support.ticket",
            source_id=detail.id,
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
    await activity_log_manager.broadcast(log)
    return notification


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
    await db.commit()
    await db.refresh(alert)
    alert_summary = to_operational_alert_summary(alert)
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


@router.websocket("/ws")
async def operational_websocket(
    websocket: WebSocket, query_token: Annotated[str | None, Query(alias="token")] = None
) -> None:
    token = await receive_websocket_bearer_token(websocket, query_token)
    if token is None:
        return

    async with AsyncSessionLocal() as db:
        account = await authenticate_websocket_account(db, token)
        account_topology = (
            await load_account_topology(db, account)
            if account is not None and account.role == AccountRole.ENTERPRISE
            else None
        )
        topology_membership = account_topology.membership if account_topology is not None else None

    if account is None:
        await websocket.close(code=1008)
        return
    if account.role == AccountRole.ENTERPRISE and topology_membership is None:
        await websocket.close(code=1008)
        return

    await operational_ws_manager.connect(
        websocket,
        account.role.value,
        account.id,
        topology_enterprise_id=(
            topology_membership.enterprise_id if topology_membership is not None else None
        ),
        classification=(
            topology_membership.classification if topology_membership is not None else None
        ),
    )
    receive_task: asyncio.Task[str] | None = asyncio.create_task(websocket.receive_text())
    try:
        while True:
            if receive_task is None:
                raise RuntimeError("WebSocket receive task is unavailable.")
            active_receive_task = receive_task
            completed, _ = await asyncio.wait(
                {active_receive_task},
                timeout=WEBSOCKET_REAUTH_INTERVAL_SECONDS,
            )
            if not completed:
                message = None
            else:
                try:
                    message = active_receive_task.result()
                finally:
                    receive_task = None
                receive_task = asyncio.create_task(websocket.receive_text())
            async with AsyncSessionLocal() as db:
                current_account = await authenticate_websocket_account(db, token)
                current_topology = (
                    await load_account_topology(db, current_account)
                    if current_account is not None
                    and current_account.role == AccountRole.ENTERPRISE
                    else None
                )
                current_membership = (
                    current_topology.membership if current_topology is not None else None
                )
            if current_account is None:
                await websocket.close(code=1008)
                return
            if current_account.id != account.id or current_account.role != account.role:
                await websocket.close(code=1008)
                return
            if account.role == AccountRole.ENTERPRISE and (
                topology_membership is None
                or current_membership is None
                or current_membership.id != topology_membership.id
                or current_membership.enterprise_id != topology_membership.enterprise_id
                or current_membership.classification != topology_membership.classification
            ):
                await websocket.close(code=1008)
                return
            if message == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        if receive_task is not None:
            receive_task.cancel()
            with suppress(asyncio.CancelledError, WebSocketDisconnect):
                await receive_task
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
        or account.activated_at is None
        or is_token_invalidated(payload, account)
    ):
        return None
    return account


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
