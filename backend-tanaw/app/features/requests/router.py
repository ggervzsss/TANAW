import base64
import binascii
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.api_helpers import resolve_enterprise_profile_change
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import get_account_by_id
from app.features.activity_logs.service import get_actor_role_label, record_activity_log
from app.features.mail.models import EmailTemplateName
from app.features.mail.service import email_idempotency_key, enqueue_email
from app.features.notifications.service import (
    create_role_notifications,
    create_user_notification,
    get_enterprise_notification_recipient,
    mark_source_notifications_read,
)
from app.features.requests.models import Request
from app.features.requests.schemas import (
    RequestCreate,
    RequestDetail,
    RequestGroupUpdate,
    RequestMessageCreate,
    RequestReadResponse,
    RequestReadUpdate,
    RequestStatusUpdate,
    RequestSummary,
)
from app.features.requests.service import (
    RequestConflictError,
    add_request_message,
    create_request,
    get_request_for_account,
    list_requests,
    mark_requests_read,
    parse_request_attachments,
    reopen_request,
    require_request_detail,
    set_request_status,
    update_request_fields,
)

router = APIRouter(prefix="/operational", tags=["requests"])

REQUEST_SOURCE_TYPE = "request"
ReaderAccount = Annotated[Account, Depends(require_roles({"admin", "it", "enterprise"}))]
ConversationAccount = Annotated[Account, Depends(require_roles({"it", "enterprise"}))]
EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]
AdminAccount = Annotated[Account, Depends(require_roles({"admin"}))]
ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
Db = Annotated[AsyncSession, Depends(get_db)]


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found.")


def _conflict(exc: RequestConflictError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "request_conflict", "message": str(exc)},
    )


async def _load(db: AsyncSession, account: Account, request_id: str) -> Request:
    request = await get_request_for_account(db, account, request_id, for_update=True)
    if request is None:
        raise _not_found()
    return request


def _place(request: Request) -> str:
    return request.enterprise_name or request.requester_name


async def _log(
    db: AsyncSession,
    request: Request,
    actor: Account,
    *,
    action: str,
    summary: str,
    severity: str = "Info",
    it_detail: str | None = None,
) -> None:
    await record_activity_log(
        db,
        group="Requests",
        severity=severity,
        actor=actor.display_name,
        actor_role=get_actor_role_label(actor),
        action=action,
        target=request.request_code,
        summary=summary,
        source_id=request.id,
        it_detail=it_detail,
        metadata={"requestCode": request.request_code, "requestGroup": request.request_group},
    )


async def _notify_sender(
    db: AsyncSession, request: Request, actor: Account, *, title: str, message: str
) -> None:
    if request.enterprise_profile is None:
        return
    recipient = await get_enterprise_notification_recipient(
        db, request.enterprise_profile.enterprise_id
    )
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
        notification_type="Request Update",
        severity="Info",
        actor=actor,
        source_type=REQUEST_SOURCE_TYPE,
        source_id=request.id,
    )


async def _notify_it(
    db: AsyncSession, request: Request, actor: Account | None, *, title: str, message: str
) -> None:
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.IT],
        title=title,
        message=message,
        notification_type="Request",
        severity="Info",
        actor=actor,
        source_type=REQUEST_SOURCE_TYPE,
        source_id=request.id,
        replace_existing_for_source=True,
    )


@router.get("/requests", response_model=list[RequestSummary])
async def list_request_summaries(account: ReaderAccount, db: Db) -> list[RequestSummary]:
    return await list_requests(db, account)


@router.get("/requests/{request_id}", response_model=RequestDetail)
async def get_request(request_id: str, account: ReaderAccount, db: Db) -> RequestDetail:
    if await get_request_for_account(db, account, request_id) is None:
        raise _not_found()
    return await require_request_detail(db, account, request_id)


@router.get("/requests/{request_id}/attachments/{attachment_index}")
async def get_request_attachment(
    request_id: str, attachment_index: int, account: ReaderAccount, db: Db
) -> Response:
    request = await get_request_for_account(db, account, request_id)
    if request is None:
        raise _not_found()
    attachments = parse_request_attachments(request.attachments_json)
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


@router.post("/requests", response_model=RequestDetail, status_code=status.HTTP_201_CREATED)
async def send_request(payload: RequestCreate, account: EnterpriseAccount, db: Db) -> RequestDetail:
    request = await create_request(db, account, payload)
    photos = len(payload.attachments)
    await _notify_it(
        db,
        request,
        account,
        title=f"{_place(request)} sent request {request.request_code}.",
        message=f"{request.request_group}: {request.title}.",
    )
    await _log(
        db,
        request,
        account,
        action="Send Request",
        summary=f"{_place(request)} sent a request: {request.title}.",
        it_detail=(
            f"{request.request_code} · {request.request_group}"
            + (f" · Camera: {request.camera}" if request.camera else "")
            + (f" · {photos} photo{'s' if photos != 1 else ''}" if photos else "")
        ),
    )
    return await require_request_detail(db, account, request.id)


@router.post("/requests/{request_id}/messages", response_model=RequestDetail)
async def reply_to_request(
    request_id: str, payload: RequestMessageCreate, account: ConversationAccount, db: Db
) -> RequestDetail:
    request = await _load(db, account, request_id)
    try:
        record = await add_request_message(db, request, account, payload.message)
    except RequestConflictError as exc:
        raise _conflict(exc) from exc
    if account.role == AccountRole.IT:
        recipient = (
            await get_account_by_id(db, request.enterprise_profile_id)
            if request.enterprise_profile_id
            else None
        )
        if recipient is not None:
            await enqueue_email(
                db,
                account_id=recipient.id,
                source_id=record.id,
                recipient=recipient.email,
                template_name=EmailTemplateName.SUPPORT_REPLY,
                template_payload={
                    "requestId": request.id,
                    "messageId": record.id,
                    "recipientName": recipient.display_name,
                },
                idempotency_key=email_idempotency_key("request-reply", record.id),
                tags={"category": "request_reply"},
            )
        await _notify_sender(
            db,
            request,
            account,
            title=f"IT replied to your request {request.request_code}.",
            message=f"IT replied about {request.title}.",
        )
    else:
        await _notify_it(
            db,
            request,
            account,
            title=f"{_place(request)} replied on {request.request_code}.",
            message=f"New reply about {request.title}.",
        )
    await _log(
        db,
        request,
        account,
        action="Reply to Request",
        summary=f"{account.display_name} replied to {_place(request)}'s request: {request.title}.",
    )
    return await require_request_detail(db, account, request.id)


@router.post("/requests/{request_id}/notes", response_model=RequestDetail)
async def add_note_for_it(
    request_id: str, payload: RequestMessageCreate, account: AdminAccount, db: Db
) -> RequestDetail:
    request = await _load(db, account, request_id)
    await add_request_message(db, request, account, payload.message, kind="note")
    await _notify_it(
        db,
        request,
        account,
        title=f"{account.display_name} added a note on {request.request_code}.",
        message=payload.message,
    )
    await _log(
        db,
        request,
        account,
        action="Add Note for IT",
        summary=f"{account.display_name} added a note for IT on {_place(request)}'s request.",
        it_detail=payload.message,
    )
    return await require_request_detail(db, account, request.id)


@router.patch("/requests/{request_id}/status", response_model=RequestDetail)
async def change_request_status(
    request_id: str, payload: RequestStatusUpdate, account: ITAccount, db: Db
) -> RequestDetail:
    request = await _load(db, account, request_id)
    if payload.status == "Approved" and request.change_field is None:
        raise _conflict(RequestConflictError("Only account changes can be approved."))
    if (
        payload.status in {"Approved", "Resolved"}
        and request.change_field is not None
        and request.status == "In Progress"
    ):
        # Approving applies the change; resolving without approving leaves the account as is.
        if request.enterprise_profile_id is None:
            raise _conflict(RequestConflictError("This account change has no enterprise."))
        enterprise = await get_account_by_id(db, request.enterprise_profile_id)
        if enterprise is None:
            raise _not_found()
        await resolve_enterprise_profile_change(
            db,
            account=enterprise,
            actor=account,
            request_type=request.change_field,  # type: ignore[arg-type]
            action="approve" if payload.status == "Approved" else "decline",
        )
        return await require_request_detail(db, account, request.id)
    try:
        previous = await set_request_status(db, request, account, payload.status)
    except RequestConflictError as exc:
        raise _conflict(exc) from exc
    if previous != request.status:
        label = "in progress" if request.status == "In Progress" else request.status.lower()
        await _notify_sender(
            db,
            request,
            account,
            title=f"Your request {request.request_code} is {label}.",
            message=f"IT marked {request.title} as {label}.",
        )
        if request.status == "Resolved":
            await mark_source_notifications_read(
                db,
                source_type=REQUEST_SOURCE_TYPE,
                source_id=request.id,
                recipient_role=AccountRole.IT,
            )
        await _log(
            db,
            request,
            account,
            action=f"Request {request.status}",
            severity="Success" if request.status == "Resolved" else "Info",
            summary=f"{account.display_name} marked {_place(request)}'s request {label}.",
            it_detail=f"{request.request_code}: {previous} → {request.status}.",
        )
    return await require_request_detail(db, account, request.id)


@router.post("/requests/{request_id}/reopen", response_model=RequestDetail)
async def reopen(request_id: str, account: ConversationAccount, db: Db) -> RequestDetail:
    request = await _load(db, account, request_id)
    try:
        await reopen_request(db, request, account)
    except RequestConflictError as exc:
        raise _conflict(exc) from exc
    if account.role == AccountRole.IT:
        await _notify_sender(
            db,
            request,
            account,
            title=f"IT reopened your request {request.request_code}.",
            message=f"IT reopened {request.title}.",
        )
    else:
        await _notify_it(
            db,
            request,
            account,
            title=f"{_place(request)} reopened {request.request_code}.",
            message=f"{request.title} needs another look.",
        )
    await _log(
        db,
        request,
        account,
        action="Reopen Request",
        summary=f"{account.display_name} reopened {_place(request)}'s request: {request.title}.",
    )
    return await require_request_detail(db, account, request.id)


@router.patch("/requests/{request_id}/group", response_model=RequestDetail)
async def move_request(
    request_id: str, payload: RequestGroupUpdate, account: ITAccount, db: Db
) -> RequestDetail:
    request = await _load(db, account, request_id)
    previous = request.request_group
    try:
        await update_request_fields(db, request, account, group=payload.group)
    except RequestConflictError as exc:
        raise _conflict(exc) from exc
    if previous != payload.group:
        await _log(
            db,
            request,
            account,
            action="Move Request",
            summary=f"{account.display_name} moved {_place(request)}'s request to {payload.group}.",
            it_detail=f"{request.request_code}: {previous} → {payload.group}.",
        )
    return await require_request_detail(db, account, request.id)


@router.post("/requests/read", response_model=RequestReadResponse)
async def read_requests(
    payload: RequestReadUpdate, account: ReaderAccount, db: Db
) -> RequestReadResponse:
    count = await mark_requests_read(db, account, None if payload.all else payload.requestIds)
    return RequestReadResponse(readCount=count)
