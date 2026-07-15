from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

from sqlalchemy import and_, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.keyset_pagination import decode_cursor, encode_cursor, filter_fingerprint
from app.core.pagination_schemas import CursorPageInfo
from app.features.accounts.models import Account, AccountRole
from app.features.assets.models import SupportAttachment
from app.features.assets.storage import AssetStorage, ValidatedImage
from app.features.support.models import SupportTicket, SupportTicketMessage
from app.features.support.schemas import (
    SupportTicketAttachment,
    SupportTicketCreate,
    SupportTicketDetail,
    SupportTicketMessageCreate,
    SupportTicketMessageSummary,
    SupportTicketPage,
    SupportTicketStatusUpdate,
    SupportTicketSummary,
)
from app.features.topology.account_scope import (
    AccountTopology,
    require_account_topology,
)


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
    db: AsyncSession, account: Account, *, limit: int, cursor: str | None
) -> SupportTicketPage:
    enterprise_id: str | None = None
    if account.role == AccountRole.ENTERPRISE:
        topology = await require_account_topology(db, account)
        enterprise_id = enterprise_identifier(topology)
    fingerprint = filter_fingerprint(
        {
            "accountId": str(account.id),
            "role": account.role.value,
            "enterpriseId": enterprise_id,
        }
    )
    statement = (
        select(SupportTicket)
        .order_by(SupportTicket.created_at.desc(), SupportTicket.id.desc())
        .limit(limit + 1)
    )
    if enterprise_id is not None:
        statement = statement.where(SupportTicket.enterprise_id == enterprise_id)
    if cursor is not None:
        cursor_at, cursor_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            or_(
                SupportTicket.created_at < cursor_at,
                and_(SupportTicket.created_at == cursor_at, SupportTicket.id < cursor_id),
            )
        )
    rows = (await db.scalars(statement)).all()
    tickets = rows[:limit]
    attachments_by_ticket = await _support_attachments_by_ticket(
        db,
        ticket_ids=[ticket.id for ticket in tickets],
    )
    items = [
        to_support_ticket_summary(ticket, attachments_by_ticket.get(ticket.id, ()))
        for ticket in tickets
    ]
    has_more = len(rows) > limit
    next_cursor = (
        encode_cursor(
            occurred_at=tickets[-1].created_at,
            resource_id=tickets[-1].id,
            fingerprint=fingerprint,
        )
        if has_more and tickets
        else None
    )
    return SupportTicketPage(
        items=items,
        page=CursorPageInfo(
            limit=limit,
            returnedCount=len(items),
            hasMore=has_more,
            nextCursor=next_cursor,
        ),
    )


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
    """Own the atomic database/object-storage transaction for a new ticket."""
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
    await db.flush([ticket])
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


def enterprise_identifier(topology: AccountTopology) -> str:
    return topology.enterprise.official_code


def enterprise_name(topology: AccountTopology) -> str:
    return topology.enterprise.name
