import json
from dataclasses import dataclass
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account, AccountRole
from app.features.auth.secret_values import (
    derive_account_activation_token,
    derive_account_email_change_token,
    derive_password_reset_code,
)
from app.features.mail.models import EmailOutbox, EmailTemplateName
from app.features.mail.rendering import EmailRenderCancelled, render_outbox_email
from app.features.mail.templates import (
    EmailContent,
    EmailRecipient,
    account_activation_email,
    account_email_change_approved_email,
    account_email_change_request_notice_email,
    account_email_change_verification_email,
    business_email_change_email,
    password_reset_code_email,
)

from .schemas import DevDeliverySummary

router = APIRouter(prefix="/dev", tags=["dev"])
ITAccount = Annotated[Account, Depends(require_roles({"it"}))]


@dataclass(frozen=True)
class DevRenderedEmail:
    content: EmailContent
    action_link: str | None = None
    action_label: str | None = None


@router.get("/deliveries", response_model=list[DevDeliverySummary])
async def list_dev_deliveries(
    _: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 250,
) -> list[DevDeliverySummary]:
    settings = get_settings()
    if settings.is_production:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")

    records = list(
        await db.scalars(select(EmailOutbox).order_by(EmailOutbox.created_at.desc()).limit(limit))
    )
    return [await _to_dev_delivery(db, record) for record in records]


async def _to_dev_delivery(db: AsyncSession, record: EmailOutbox) -> DevDeliverySummary:
    rendered = await _render_dev_email(db, record)
    return DevDeliverySummary(
        id=record.id,
        accountId=record.account_id,
        recipient=record.recipient,
        subject=rendered.content.subject,
        body=rendered.content.text,
        status=record.status,
        createdAt=record.created_at,
        actionLink=rendered.action_link,
        actionLabel=rendered.action_label,
    )


async def _render_dev_email(db: AsyncSession, outbox: EmailOutbox) -> DevRenderedEmail:
    try:
        payload = _load_payload(outbox.template_payload_json)
        template_name = EmailTemplateName(outbox.template_name)
        if template_name == EmailTemplateName.ACCOUNT_ACTIVATION:
            return _render_dev_account_activation(payload)
        if template_name == EmailTemplateName.PASSWORD_RESET:
            return _render_dev_password_reset(payload)
        if template_name == EmailTemplateName.BUSINESS_EMAIL_CHANGE:
            return DevRenderedEmail(
                business_email_change_email(
                    _recipient_from_payload(payload), _required(payload, "newEmail")
                )
            )
        if template_name == EmailTemplateName.ACCOUNT_EMAIL_CHANGE_VERIFICATION:
            return _render_dev_account_email_change_verification(payload)
        if template_name == EmailTemplateName.ACCOUNT_EMAIL_CHANGE_REQUEST_NOTICE:
            return DevRenderedEmail(
                account_email_change_request_notice_email(
                    _recipient_from_payload(payload),
                    new_email=_required(payload, "newEmail"),
                    expires_label=_required(payload, "expiresLabel"),
                )
            )
        if template_name in {
            EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_OLD,
            EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_NEW,
        }:
            return DevRenderedEmail(
                account_email_change_approved_email(
                    _recipient_from_payload(payload),
                    old_email=_required(payload, "oldEmail"),
                    new_email=_required(payload, "newEmail"),
                    sent_to_old_address=(
                        template_name == EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_OLD
                    ),
                )
            )
    except EmailRenderCancelled, ValueError, KeyError:
        pass

    try:
        return DevRenderedEmail(await render_outbox_email(db, outbox))
    except EmailRenderCancelled as exc:
        return DevRenderedEmail(
            EmailContent(
                subject="Development email unavailable",
                text=f"This email can no longer be rendered: {exc}",
                html="",
            )
        )


def _render_dev_account_activation(payload: dict[str, str]) -> DevRenderedEmail:
    raw_token = derive_account_activation_token(_required(payload, "tokenId"))
    activation_url = (
        f"{_required(payload, 'frontendPublicUrl').rstrip('/')}"
        f"/activate-account#token={quote(raw_token)}"
    )
    return DevRenderedEmail(
        account_activation_email(
            _recipient_from_payload(payload),
            activation_url,
            _required(payload, "expiresLabel"),
        ),
        action_link=activation_url,
        action_label="Copy activation link",
    )


def _render_dev_password_reset(payload: dict[str, str]) -> DevRenderedEmail:
    return DevRenderedEmail(
        password_reset_code_email(
            _recipient_from_payload(payload),
            derive_password_reset_code(_required(payload, "challengeId")),
            _required(payload, "expiresLabel"),
        )
    )


def _render_dev_account_email_change_verification(payload: dict[str, str]) -> DevRenderedEmail:
    raw_token = derive_account_email_change_token(_required(payload, "requestId"))
    verification_url = (
        f"{_required(payload, 'frontendPublicUrl').rstrip('/')}"
        f"/verify-email-change#token={quote(raw_token)}"
    )
    return DevRenderedEmail(
        account_email_change_verification_email(
            _recipient_from_payload(payload),
            old_email=_required(payload, "oldEmail"),
            new_email=_required(payload, "newEmail"),
            verification_url=verification_url,
            expires_label=_required(payload, "expiresLabel"),
        ),
        action_link=verification_url,
        action_label="Copy verification link",
    )


def _load_payload(value: str) -> dict[str, str]:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise EmailRenderCancelled("Invalid email template payload.") from exc
    if not isinstance(payload, dict) or any(
        not isinstance(key, str) or not isinstance(item, str) for key, item in payload.items()
    ):
        raise EmailRenderCancelled("Invalid email template payload.")
    return payload


def _required(payload: dict[str, str], key: str) -> str:
    value = payload.get(key, "").strip()
    if not value:
        raise EmailRenderCancelled("Invalid email template payload.")
    return value


def _recipient_from_payload(payload: dict[str, str]) -> EmailRecipient:
    try:
        role = AccountRole(_required(payload, "role"))
    except ValueError as exc:
        raise EmailRenderCancelled("Invalid email template payload.") from exc
    return EmailRecipient(
        display_name=_required(payload, "displayName"),
        email=_required(payload, "email"),
        role=role,
        enterprise_id=payload.get("enterpriseId") or None,
    )
