"""Requests: help asked of IT, and account changes that need IT's approval.

One request model covers both. A request is sent by an enterprise from the desktop app, by
anyone from the sign-in page (Sign-in help), or by TANAW when an enterprise edits a field
that needs approval (Account change). IT handles every request; the Admin reads them all and
can leave notes for IT; an enterprise sees its own.
"""

import json
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from typing import cast

from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.enterprise import enterprise_name
from app.features.accounts.models import (
    Account,
    AccountEmailChangeRequest,
    AccountRole,
    EnterpriseProfile,
)
from app.features.requests.models import (
    REQUEST_CODE_SEQUENCE,
    Request,
    RequestMessage,
    RequestRead,
)
from app.features.requests.ownership import (
    OPEN_STATUSES,
    claim_if_not_picked_up,
    request_handler,
    take_request,
)
from app.features.requests.schemas import (
    AccountChangeField,
    AccountChangeSummary,
    AccountChangeVerification,
    RequestAttachmentCreate,
    RequestAttachmentMetadata,
    RequestCreate,
    RequestDetail,
    RequestGroup,
    RequestMessageKind,
    RequestMessageSummary,
    RequestStatus,
    RequestSummary,
    SignInHelpCreate,
)

CLOSED_STATUSES = frozenset({"Resolved", "Approved"})
ACCOUNT_CHANGE_LABELS: dict[str, str] = {
    "businessEmail": "Business email",
    "contactNumber": "Contact number",
    "enterpriseName": "Enterprise name",
}
REQUEST_READER_ROLES = frozenset({AccountRole.ADMIN, AccountRole.IT, AccountRole.ENTERPRISE})


class RequestConflictError(ValueError):
    """Raised when a request can't move to the asked-for status or take a message."""


def _now() -> datetime:
    return datetime.now(UTC)


def account_change_label(field: str) -> str:
    return ACCOUNT_CHANGE_LABELS.get(field, "Account detail")


# Reading


def parse_request_attachments(value: str | None) -> list[RequestAttachmentCreate]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    attachments: list[RequestAttachmentCreate] = []
    for item in parsed:
        try:
            attachments.append(RequestAttachmentCreate.model_validate(item))
        except ValueError:
            continue
    return attachments


def request_attachment_summaries(request: Request) -> list[RequestAttachmentMetadata]:
    return [
        RequestAttachmentMetadata(
            id=f"{request.id}:{index}",
            fileName=attachment.fileName,
            mediaType=attachment.mediaType,
            sizeBytes=attachment.sizeBytes,
            url=f"/operational/requests/{request.id}/attachments/{index}",
        )
        for index, attachment in enumerate(parse_request_attachments(request.attachments_json))
    ]


def _email_verification(
    email_request: AccountEmailChangeRequest | None, now: datetime
) -> AccountChangeVerification | None:
    if email_request is None:
        return None
    expires_at = email_request.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at <= now and email_request.status in {"pending_verification", "verified"}:
        return "expired"
    if email_request.status == "verified":
        return "verified"
    return "pending_verification"


# An enterprise account's email and phone, loaded up front: reading profile.account here would
# lazy-load it outside the async session and fail.
AccountContact = tuple[str, str | None]


def _current_account_value(
    profile: EnterpriseProfile | None, field: str, contact: AccountContact | None
) -> str | None:
    if profile is None:
        return None
    if field == "businessEmail":
        return contact[0] if contact else None
    if field == "contactNumber":
        return contact[1] if contact else None
    return profile.enterprise_name


def _account_change_summary(
    request: Request,
    email_request: AccountEmailChangeRequest | None,
    now: datetime,
    contact: AccountContact | None = None,
) -> AccountChangeSummary | None:
    if request.change_field is None or request.change_value is None:
        return None
    verification = (
        _email_verification(email_request, now) if request.change_field == "businessEmail" else None
    )
    open_request = request.status in OPEN_STATUSES
    return AccountChangeSummary(
        field=cast(AccountChangeField, request.change_field),
        label=account_change_label(request.change_field),
        currentValue=_current_account_value(
            request.enterprise_profile, request.change_field, contact
        ),
        requestedValue=request.change_value,
        verification=verification,
        canApprove=open_request
        and (request.change_field != "businessEmail" or verification == "verified"),
    )


def to_request_summary(
    request: Request,
    *,
    viewer: Account,
    read_at: datetime | None = None,
    email_request: AccountEmailChangeRequest | None = None,
    now: datetime | None = None,
    contact: AccountContact | None = None,
) -> RequestSummary:
    current = now or _now()
    profile = request.enterprise_profile
    # Sign-in help may come from someone with no account; only LGU readers see the address.
    show_email = viewer.role in {AccountRole.ADMIN, AccountRole.IT}
    updated_at = request.updated_at
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=UTC)
    return RequestSummary(
        id=request.id,
        code=request.request_code,
        group=cast(RequestGroup, request.request_group),
        title=request.title,
        description=request.description,
        status=cast(RequestStatus, request.status),
        enterpriseId=profile.enterprise_id if profile is not None else None,
        enterpriseName=request.enterprise_name,
        requesterName=request.requester_name,
        requesterEmail=request.requester_email if show_email else None,
        affectedArea=request.affected_area,
        camera=request.camera,
        attachments=request_attachment_summaries(request),
        accountChange=_account_change_summary(request, email_request, current, contact),
        createdAt=request.created_at,
        updatedAt=request.updated_at,
        closedAt=request.closed_at,
        handledBy=request_handler(request),
        handledAt=request.handled_at,
        unread=read_at is None,
        updated=read_at is not None and read_at < updated_at,
    )


def to_request_message_summary(message: RequestMessage) -> RequestMessageSummary:
    return RequestMessageSummary(
        id=message.id,
        requestId=message.request_id,
        authorId=message.author_account_id,
        authorName=message.author_name,
        authorRole=message.author_role,
        kind=cast(RequestMessageKind, message.kind),
        message=message.message,
        createdAt=message.created_at,
    )


async def _email_requests_by_id(
    db: AsyncSession, requests: Iterable[Request]
) -> dict[str, AccountEmailChangeRequest]:
    ids = {request.email_change_request_id for request in requests} - {None}
    if not ids:
        return {}
    rows = await db.scalars(
        select(AccountEmailChangeRequest).where(AccountEmailChangeRequest.id.in_(ids))
    )
    return {row.id: row for row in rows}


async def _account_contacts(
    db: AsyncSession, requests: Iterable[Request]
) -> dict[str, AccountContact]:
    """Email and phone of the enterprises whose account changes are being summarized."""
    ids = {
        request.enterprise_profile_id
        for request in requests
        if request.change_field is not None and request.enterprise_profile_id is not None
    }
    if not ids:
        return {}
    rows = await db.execute(
        select(Account.id, Account.email, Account.phone).where(Account.id.in_(ids))
    )
    return {account_id: (email, phone) for account_id, email, phone in rows}


async def _read_times(
    db: AsyncSession, account: Account, request_ids: Sequence[str]
) -> dict[str, datetime]:
    if not request_ids:
        return {}
    rows = await db.execute(
        select(RequestRead.request_id, RequestRead.read_at).where(
            RequestRead.account_id == account.id, RequestRead.request_id.in_(request_ids)
        )
    )
    reads: dict[str, datetime] = {}
    for request_id, read_at in rows:
        reads[request_id] = read_at if read_at.tzinfo else read_at.replace(tzinfo=UTC)
    return reads


async def summarize_requests(
    db: AsyncSession, account: Account, requests: Sequence[Request]
) -> list[RequestSummary]:
    reads = await _read_times(db, account, [request.id for request in requests])
    email_requests = await _email_requests_by_id(db, requests)
    contacts = await _account_contacts(db, requests)
    now = _now()
    return [
        to_request_summary(
            request,
            viewer=account,
            read_at=reads.get(request.id),
            email_request=email_requests.get(request.email_change_request_id or ""),
            now=now,
            contact=contacts.get(request.enterprise_profile_id or ""),
        )
        for request in requests
    ]


async def list_requests(
    db: AsyncSession, account: Account, limit: int = 200, *, enterprise_id: str | None = None
) -> list[RequestSummary]:
    """The requests an account reads; Admin and IT may narrow them to one enterprise.

    `enterprise_id` is the enterprise's slug (such as ENT-001) or its account id.
    """
    if account.role not in REQUEST_READER_ROLES:
        return []
    statement = select(Request).order_by(Request.created_at.desc(), Request.id.desc()).limit(limit)
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(Request.enterprise_profile_id == account.id)
    elif enterprise_id:
        statement = statement.where(
            or_(
                Request.enterprise_profile_id == enterprise_id,
                Request.enterprise_profile_id.in_(
                    select(EnterpriseProfile.account_id).where(
                        EnterpriseProfile.enterprise_id == enterprise_id
                    )
                ),
            )
        )
    requests = (await db.scalars(statement)).unique().all()
    return await summarize_requests(db, account, requests)


async def get_request_for_account(
    db: AsyncSession,
    account: Account,
    request_id: str,
    *,
    for_update: bool = False,
) -> Request | None:
    if account.role not in REQUEST_READER_ROLES:
        return None
    statement = select(Request).where(Request.id == request_id)
    if for_update:
        statement = statement.with_for_update(of=Request).execution_options(populate_existing=True)
    request = cast(Request | None, await db.scalar(statement))
    if request is None:
        return None
    if account.role == AccountRole.ENTERPRISE and request.enterprise_profile_id != account.id:
        return None
    return request


async def get_request_detail(
    db: AsyncSession, account: Account, request_id: str
) -> RequestDetail | None:
    request = await get_request_for_account(db, account, request_id)
    if request is None:
        return None
    statement = (
        select(RequestMessage)
        .where(RequestMessage.request_id == request.id)
        .order_by(RequestMessage.created_at.asc(), RequestMessage.id.asc())
    )
    if account.role == AccountRole.ENTERPRISE:
        # Admin notes are for IT only.
        statement = statement.where(RequestMessage.kind != "note")
    messages = (await db.scalars(statement)).all()
    [summary] = await summarize_requests(db, account, [request])
    return RequestDetail(
        **summary.model_dump(),
        messages=[to_request_message_summary(message) for message in messages],
    )


async def require_request_detail(
    db: AsyncSession, account: Account, request_id: str
) -> RequestDetail:
    detail = await get_request_detail(db, account, request_id)
    if detail is None:
        raise RuntimeError("The request disappeared while it was being updated.")
    return detail


# Read marks


async def mark_requests_read(
    db: AsyncSession, account: Account, request_ids: Iterable[str] | None = None
) -> int:
    """Mark the given requests (or every visible one when `request_ids` is None) as read."""
    statement = select(Request.id)
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(Request.enterprise_profile_id == account.id)
    if request_ids is not None:
        ids = list(dict.fromkeys(request_ids))
        if not ids:
            return 0
        statement = statement.where(Request.id.in_(ids))
    visible = list((await db.scalars(statement)).all())
    if not visible:
        return 0
    now = _now()
    upsert = insert(RequestRead).values(
        [
            {"account_id": account.id, "request_id": request_id, "read_at": now}
            for request_id in visible
        ]
    )
    await db.execute(
        upsert.on_conflict_do_update(
            index_elements=[RequestRead.account_id, RequestRead.request_id],
            set_={"read_at": now},
        )
    )
    return len(visible)


# Writing


async def _next_request_code(db: AsyncSession) -> str:
    number = await db.scalar(select(REQUEST_CODE_SEQUENCE.next_value()))
    if number is None:
        raise RuntimeError("The request code sequence did not return a value.")
    return f"REQ-{number:06d}"


async def create_request(db: AsyncSession, account: Account, payload: RequestCreate) -> Request:
    profile = account.enterprise_profile
    request = Request(
        request_code=await _next_request_code(db),
        request_group=payload.group,
        title=payload.title,
        description=payload.description,
        status="In Progress",
        enterprise_profile_id=account.id,
        enterprise_name=enterprise_name(account),
        requester_name=(profile.manager_name if profile is not None else None)
        or account.display_name,
        affected_area=payload.affectedArea,
        camera=payload.camera,
        attachments_json=json.dumps(
            [attachment.model_dump(mode="json") for attachment in payload.attachments],
            sort_keys=True,
        )
        if payload.attachments
        else None,
    )
    db.add(request)
    await db.flush()
    await db.refresh(request)
    await mark_requests_read(db, account, [request.id])
    return request


async def create_sign_in_help_request(
    db: AsyncSession, payload: SignInHelpCreate, *, matched_account: Account | None
) -> Request:
    profile = matched_account.enterprise_profile if matched_account is not None else None
    request = Request(
        request_code=await _next_request_code(db),
        request_group="Sign-in help",
        title="Sign-in help",
        description=" ".join(payload.message.split()),
        status="In Progress",
        enterprise_profile_id=profile.account_id if profile is not None else None,
        enterprise_name=profile.enterprise_name if profile is not None else None,
        requester_name=" ".join(payload.name.split()),
        requester_email=str(payload.email).strip().lower(),
    )
    db.add(request)
    await db.flush()
    await db.refresh(request)
    return request


async def add_request_message(
    db: AsyncSession,
    request: Request,
    author: Account,
    message: str,
    *,
    kind: RequestMessageKind = "message",
) -> RequestMessage:
    if kind == "message" and request.status in CLOSED_STATUSES:
        raise RequestConflictError(
            "This request is closed. Reopen it to continue the conversation."
        )
    if kind == "message":
        claim_if_not_picked_up(request, author)
    record = RequestMessage(
        request_id=request.id,
        author_account_id=author.id,
        author_name=author.display_name,
        author_role=author.role.value,
        kind=kind,
        message=message,
    )
    db.add(record)
    request.updated_at = _now()
    await db.flush()
    await db.refresh(record)
    await mark_requests_read(db, author, [request.id])
    return record


def allowed_statuses(request: Request) -> frozenset[str]:
    """IT approves an account change, or resolves it without approving."""
    if request.change_field is not None:
        return frozenset({"In Progress", "Approved", "Resolved"})
    return frozenset({"In Progress", "Resolved"})


async def set_request_status(
    db: AsyncSession, request: Request, actor: Account, status: RequestStatus
) -> str:
    """Move a request to a new status and log it on the timeline. Returns the old status."""
    previous = request.status
    claim_if_not_picked_up(request, actor)
    if status == previous:
        return previous
    if status not in allowed_statuses(request):
        raise RequestConflictError(f"A {request.request_group.lower()} request can't be {status}.")
    if request.change_field is not None and previous in CLOSED_STATUSES:
        raise RequestConflictError("This account change is already decided.")
    request.status = status
    request.closed_at = _now() if status in CLOSED_STATUSES else None
    request.updated_at = _now()
    label = "Reopened" if previous == "Resolved" else status
    db.add(
        RequestMessage(
            request_id=request.id,
            author_account_id=actor.id,
            author_name=actor.display_name,
            author_role=actor.role.value,
            kind="status",
            message=label,
        )
    )
    await db.flush()
    await mark_requests_read(db, actor, [request.id])
    return previous


async def reopen_request(db: AsyncSession, request: Request, actor: Account) -> str:
    if request.status != "Resolved":
        raise RequestConflictError("Only a resolved request can be reopened.")
    previous = await set_request_status(db, request, actor, "In Progress")
    # IT reopening it takes it on; an enterprise reopening it keeps whoever handled it.
    if actor.role == AccountRole.IT:
        take_request(request, actor)
        await db.flush()
    return previous


async def update_request_fields(
    db: AsyncSession,
    request: Request,
    actor: Account,
    *,
    group: RequestGroup | None = None,
) -> None:
    if group is not None:
        if (group == "Account change") != (request.change_field is not None):
            raise RequestConflictError("Only account changes belong in the Account change group.")
        request.request_group = group
    claim_if_not_picked_up(request, actor)
    request.updated_at = _now()
    await db.flush()
    await mark_requests_read(db, actor, [request.id])


# Who handles a request


async def start_request(db: AsyncSession, request: Request, actor: Account) -> None:
    """An IT person picks up an open request, which shows on its timeline."""
    if request.status not in OPEN_STATUSES:
        raise RequestConflictError("Only an open request can be started.")
    handler = request_handler(request)
    if handler is not None:
        who = "You are" if handler.accountId == actor.id else f"{handler.name} is"
        raise RequestConflictError(f"{who} already handling this request.")
    take_request(request, actor)
    request.updated_at = _now()
    db.add(
        RequestMessage(
            request_id=request.id,
            author_account_id=actor.id,
            author_name=actor.display_name,
            author_role=actor.role.value,
            kind="status",
            message=f"{actor.display_name} started on it.",
        )
    )
    await db.flush()
    await mark_requests_read(db, actor, [request.id])


# Account changes


async def get_open_account_change_request(
    db: AsyncSession, enterprise_account_id: str, field: AccountChangeField
) -> Request | None:
    return cast(
        Request | None,
        await db.scalar(
            select(Request).where(
                Request.enterprise_profile_id == enterprise_account_id,
                Request.change_field == field,
                Request.status.in_(OPEN_STATUSES),
            )
        ),
    )


async def open_account_change_request(
    db: AsyncSession,
    account: Account,
    field: AccountChangeField,
    value: str,
    *,
    email_change_request_id: str | None = None,
) -> Request:
    """Open (or refresh) the Account change request for a field that needs IT's approval."""
    label = account_change_label(field)
    name = enterprise_name(account)
    description = f"{name} asked to change its {label.lower()} to {value}."
    existing = await get_open_account_change_request(db, account.id, field)
    if existing is not None:
        existing.change_value = value
        existing.description = description
        existing.email_change_request_id = email_change_request_id
        existing.status = "In Progress"
        existing.updated_at = _now()
        await db.flush()
        await mark_requests_read(db, account, [existing.id])
        return existing
    profile = account.enterprise_profile
    request = Request(
        request_code=await _next_request_code(db),
        request_group="Account change",
        title=f"Change of {label.lower()}",
        description=description,
        status="In Progress",
        enterprise_profile_id=account.id,
        enterprise_name=name,
        requester_name=(profile.manager_name if profile is not None else None)
        or account.display_name,
        change_field=field,
        change_value=value,
        email_change_request_id=email_change_request_id,
    )
    db.add(request)
    await db.flush()
    await db.refresh(request)
    await mark_requests_read(db, account, [request.id])
    return request


async def cancel_account_change_request(
    db: AsyncSession, enterprise_account_id: str, field: AccountChangeField
) -> None:
    """The enterprise withdrew the change, so the request leaves the list."""
    await db.execute(
        delete(Request).where(
            Request.enterprise_profile_id == enterprise_account_id,
            Request.change_field == field,
            Request.status.in_(OPEN_STATUSES),
        )
    )


async def close_account_change_request(
    db: AsyncSession,
    enterprise_account_id: str,
    field: AccountChangeField,
    *,
    approved: bool,
    actor: Account,
) -> None:
    request = await get_open_account_change_request(db, enterprise_account_id, field)
    if request is None:
        return
    await set_request_status(db, request, actor, "Approved" if approved else "Resolved")


async def touch_account_change_request(
    db: AsyncSession, enterprise_account_id: str, field: AccountChangeField
) -> None:
    """Show the request as Updated, for example when the new email address gets verified."""
    request = await get_open_account_change_request(db, enterprise_account_id, field)
    if request is not None:
        request.updated_at = _now()
        await db.flush()
