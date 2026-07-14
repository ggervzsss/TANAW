from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.features.accounts.dependencies import (
    require_roles,
)
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import get_account_by_id
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.activity_logs.websocket import activity_log_manager
from app.features.assets.runtime import get_asset_storage
from app.features.assets.storage import (
    AssetStorage,
    AssetStorageError,
    AssetValidationError,
    inline_content_disposition,
    validate_image,
    verify_stored_image,
)
from app.features.mail.models import EmailTemplateName
from app.features.mail.service import email_idempotency_key, enqueue_email
from app.features.notifications.service import (
    create_role_notifications,
    create_user_notification,
    get_enterprise_notification_recipient,
)
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
    get_support_attachment_for_account,
    get_support_ticket_detail,
    get_support_ticket_for_account,
    list_support_tickets,
    update_support_ticket_status,
)
from app.features.topology.account_scope import require_account_topology

router = APIRouter(prefix="/operational", tags=["support"])
AssetStorageDependency = Annotated[AssetStorage, Depends(get_asset_storage)]

TicketReadAccount = Annotated[Account, Depends(require_roles({"admin", "it", "enterprise"}))]
TicketMessageAccount = Annotated[Account, Depends(require_roles({"it", "enterprise"}))]
EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]
ITAccount = Annotated[Account, Depends(require_roles({"it"}))]


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
    else:
        await db.commit()
    return detail


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
    await db.commit()
    await activity_log_manager.broadcast(log)
