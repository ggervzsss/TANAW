import json
from typing import cast

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.enterprise import enterprise_name
from app.features.accounts.models import Account, AccountRole
from app.features.support.models import SupportTicket, SupportTicketMessage
from app.features.support.schemas import (
    SupportTicketAttachmentCreate,
    SupportTicketAttachmentMetadata,
    SupportTicketCreate,
    SupportTicketDetail,
    SupportTicketMessageCreate,
    SupportTicketMessageSummary,
    SupportTicketStatusUpdate,
    SupportTicketSummary,
)

SUPPORT_TICKET_PRIORITY_RANK = {
    "Urgent": 0,
    "High": 1,
    "Normal": 2,
    "Low": 3,
}


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


def ticket_attachment_summaries(
    ticket: SupportTicket,
) -> list[SupportTicketAttachmentMetadata]:
    attachments = parse_ticket_attachments(ticket.attachments_json)
    return [
        SupportTicketAttachmentMetadata(
            id=f"{ticket.id}:{index}",
            fileName=attachment.fileName,
            mediaType=attachment.mediaType,
            sizeBytes=attachment.sizeBytes,
            url=f"/operational/tickets/{ticket.id}/attachments/{index}",
        )
        for index, attachment in enumerate(attachments)
    ]


def parse_ticket_attachments(value: str | None) -> list[SupportTicketAttachmentCreate]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    attachments: list[SupportTicketAttachmentCreate] = []
    for item in parsed:
        try:
            attachments.append(SupportTicketAttachmentCreate.model_validate(item))
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
    await db.flush()
    await db.refresh(ticket)
    return to_support_ticket_summary(ticket)


async def create_support_ticket_message(
    db: AsyncSession,
    ticket: SupportTicket,
    author: Account,
    payload: SupportTicketMessageCreate,
) -> SupportTicketDetail:
    detail, _ = await create_support_ticket_message_with_record(
        db,
        ticket,
        author,
        payload,
    )
    return detail


async def create_support_ticket_message_with_record(
    db: AsyncSession,
    ticket: SupportTicket,
    author: Account,
    payload: SupportTicketMessageCreate,
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
    await db.flush()
    await db.refresh(ticket)
    detail = await get_support_ticket_detail(db, actor, ticket.id)
    if detail is None:
        raise RuntimeError("Support ticket detail disappeared after status update.")
    return detail
