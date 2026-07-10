import base64
import binascii
import hashlib
import hmac
import json
import re
import time
from email.utils import getaddresses, parseaddr
from html.parser import HTMLParser
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.features.accounts.models import AccountRole, DeliveryStatus, DevDelivery
from app.features.accounts.service import get_account_by_email
from app.features.mail.models import InboundEmailReceipt
from app.features.mail.service import _resend_client
from app.features.operational.models import SupportTicket
from app.features.operational.schemas import (
    OperationalWebSocketEnvelope,
    SupportTicketCreate,
    SupportTicketMessageCreate,
)
from app.features.operational.service import (
    create_role_notifications,
    create_support_ticket,
    create_support_ticket_message,
)
from app.features.operational.websocket import operational_ws_manager

router = APIRouter(prefix="/webhooks/resend", tags=["email-webhooks"])
TICKET_CODE_PATTERN = re.compile(r"\[(TCK-\d{6})]", re.IGNORECASE)
MAX_WEBHOOK_AGE_SECONDS = 5 * 60


@router.post("")
async def handle_resend_webhook(
    request: Request, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    settings = get_settings()
    if not settings.resend_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Resend webhooks are not configured.",
        )

    payload = await request.body()
    event_id = request.headers.get("svix-id", "")
    timestamp = request.headers.get("svix-timestamp", "")
    signature = request.headers.get("svix-signature", "")
    if not verify_resend_webhook(
        payload=payload,
        event_id=event_id,
        timestamp=timestamp,
        signature=signature,
        secret=settings.resend_webhook_secret,
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook.")

    try:
        event = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook JSON."
        ) from exc
    if not isinstance(event, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook.")

    event_type = event.get("type")
    data = event.get("data")
    if not isinstance(event_type, str) or not isinstance(data, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook.")

    if event_type == "email.received":
        await _handle_received_email(db, event_id=event_id, data=data)
    elif event_type in {
        "email.sent",
        "email.delivered",
        "email.delivery_delayed",
        "email.bounced",
        "email.failed",
        "email.complained",
        "email.suppressed",
    }:
        await _handle_delivery_event(db, event_type=event_type, data=data)
    return {"status": "ok"}


def verify_resend_webhook(
    *, payload: bytes, event_id: str, timestamp: str, signature: str, secret: str
) -> bool:
    if not event_id or not timestamp or not signature:
        return False
    try:
        event_time = int(timestamp)
    except ValueError:
        return False
    if abs(int(time.time()) - event_time) > MAX_WEBHOOK_AGE_SECONDS:
        return False

    encoded_secret = secret.removeprefix("whsec_")
    try:
        padding = "=" * (-len(encoded_secret) % 4)
        secret_bytes = base64.b64decode(encoded_secret + padding, validate=True)
    except ValueError, binascii.Error:
        return False
    signed_payload = f"{event_id}.{timestamp}.".encode() + payload
    expected = base64.b64encode(
        hmac.new(secret_bytes, signed_payload, hashlib.sha256).digest()
    ).decode()
    candidates = [item.removeprefix("v1,") for item in signature.split() if item.startswith("v1,")]
    return any(hmac.compare_digest(expected, candidate) for candidate in candidates)


async def _handle_received_email(db: AsyncSession, *, event_id: str, data: dict[str, Any]) -> None:
    email_id = data.get("email_id")
    if not isinstance(email_id, str) or not email_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing email ID.")
    existing = await db.scalar(
        select(InboundEmailReceipt).where(InboundEmailReceipt.provider_email_id == email_id)
    )
    if existing is not None:
        return

    settings = get_settings()
    try:
        received = await _resend_client(settings).get_received_email(email_id)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not retrieve the received email.",
        ) from exc

    sender_email = parseaddr(received.sender)[1].strip().lower()
    recipient_addresses = {
        address.lower() for _, address in getaddresses(list(received.recipients)) if address
    }
    configured_recipient = (settings.email_inbound_address or "").strip().lower()
    if not configured_recipient or configured_recipient not in recipient_addresses:
        await _record_receipt(
            db,
            email_id=email_id,
            event_id=event_id,
            message_id=received.message_id,
            sender_email=sender_email or "unknown",
            ticket_id=None,
            disposition="ignored_recipient",
        )
        return

    account = await get_account_by_email(db, sender_email) if sender_email else None
    if account is None:
        await _record_receipt(
            db,
            email_id=email_id,
            event_id=event_id,
            message_id=received.message_id,
            sender_email=sender_email or "unknown",
            ticket_id=None,
            disposition="unknown_sender",
        )
        return

    body = _email_body_as_text(received.text, received.html)
    if received.attachment_count:
        body = (
            f"{body}\n\n[This email included {received.attachment_count} attachment"
            f"{'s' if received.attachment_count != 1 else ''}; attachments are not imported.]"
        )
    ticket = await _find_replied_ticket(db, account.id, received.subject)
    if ticket is None:
        summary = await create_support_ticket(
            db,
            account,
            SupportTicketCreate(
                category="Account & Security",
                priority="Normal",
                subject=_minimum_length(
                    _truncate(received.subject.strip() or "Email support request", 160),
                    3,
                    "Email support request",
                ),
                description=_minimum_length(
                    _truncate(body, 4000), 10, "No message body was provided."
                ),
            ),
            commit=False,
        )
        ticket_id = summary.id
        notification_title = f"{account.display_name} emailed support ticket {summary.code}."
        notification_message = f"{account.display_name}: {summary.subject}."
        disposition = "ticket_created"
    else:
        detail = await create_support_ticket_message(
            db,
            ticket,
            account,
            SupportTicketMessageCreate(message=_truncate(body, 2000)),
            commit=False,
        )
        ticket_id = detail.id
        notification_title = f"{account.display_name} replied to {detail.code} by email."
        notification_message = f"New email reply on {detail.code}: {detail.subject}."
        disposition = "message_appended"

    db.add(
        InboundEmailReceipt(
            provider_email_id=email_id,
            webhook_event_id=event_id,
            message_id=received.message_id,
            sender_email=sender_email,
            ticket_id=ticket_id,
            disposition=disposition,
        )
    )
    await db.commit()
    notifications = await create_role_notifications(
        db,
        recipient_roles=[AccountRole.ADMIN, AccountRole.IT],
        title=notification_title,
        message=notification_message,
        notification_type="Email Support Ticket",
        severity="Info",
        actor=account,
        source_type="support.ticket",
        source_id=ticket_id,
    )
    for notification in notifications:
        await operational_ws_manager.broadcast(
            OperationalWebSocketEnvelope(
                type="notification.created",
                data=notification.model_dump(mode="json"),
            )
        )


async def _record_receipt(
    db: AsyncSession,
    *,
    email_id: str,
    event_id: str,
    message_id: str | None,
    sender_email: str,
    ticket_id: str | None,
    disposition: str,
) -> None:
    db.add(
        InboundEmailReceipt(
            provider_email_id=email_id,
            webhook_event_id=event_id,
            message_id=message_id,
            sender_email=sender_email,
            ticket_id=ticket_id,
            disposition=disposition,
        )
    )
    await db.commit()


async def _find_replied_ticket(
    db: AsyncSession, account_id: str, subject: str
) -> SupportTicket | None:
    match = TICKET_CODE_PATTERN.search(subject)
    if match is None:
        return None
    return cast(
        SupportTicket | None,
        await db.scalar(
            select(SupportTicket).where(
                SupportTicket.ticket_code == match.group(1).upper(),
                SupportTicket.enterprise_account_id == account_id,
            )
        ),
    )


async def _handle_delivery_event(
    db: AsyncSession, *, event_type: str, data: dict[str, Any]
) -> None:
    email_id = data.get("email_id")
    if not isinstance(email_id, str):
        return
    delivery = await db.scalar(
        select(DevDelivery).where(DevDelivery.provider_message_id == email_id)
    )
    if delivery is None:
        return
    if event_type in {"email.bounced", "email.failed", "email.complained", "email.suppressed"}:
        delivery.status = DeliveryStatus.FAILED
        delivery.error_message = event_type.removeprefix("email.").replace("_", " ")
    elif event_type in {"email.sent", "email.delivered"}:
        delivery.status = DeliveryStatus.SENT
        delivery.error_message = None
    await db.commit()


def _email_body_as_text(text: str | None, html: str | None) -> str:
    if text and text.strip():
        return _normalize_body(text)
    if html and html.strip():
        parser = _HTMLTextExtractor()
        parser.feed(html)
        return _normalize_body(" ".join(parser.parts))
    return "(No message body was provided.)"


def _normalize_body(value: str) -> str:
    lines = [" ".join(line.split()) for line in value.splitlines()]
    normalized = "\n".join(line for line in lines if line).strip()
    return normalized or "(No message body was provided.)"


def _truncate(value: str, maximum: int) -> str:
    return value if len(value) <= maximum else f"{value[: maximum - 1]}…"


def _minimum_length(value: str, minimum: int, fallback: str) -> str:
    return value if len(value) >= minimum else f"{value} {fallback}".strip()


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style"} and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth and data.strip():
            self.parts.append(data.strip())
