from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.features.accounts.models import AccountRole
from app.features.mail.models import EmailOutboxStatus, EmailTemplateName
from app.features.mail.service import REDACTED_EMAIL_BODY, enqueue_email
from app.features.mail.templates import (
    EmailRecipient,
    account_activation_email,
    account_email_change_verification_email,
    support_ticket_reply_email,
)


@pytest.mark.asyncio
async def test_enqueue_email_persists_only_template_source_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.features.mail.service.get_settings", Settings)
    db = MagicMock()
    db.flush = AsyncMock()
    expires_at = datetime.now(UTC) + timedelta(minutes=10)

    outbox = await enqueue_email(
        db,
        account_id="account-1",
        source_id="challenge-source-id",
        recipient="USER@example.com",
        template_name=EmailTemplateName.PASSWORD_RESET,
        template_payload={
            "challengeId": "challenge-source-id",
            "displayName": "Test User",
            "email": "user@example.com",
            "role": "staff",
            "enterpriseId": "",
            "expiresLabel": "soon",
        },
        idempotency_key="password-reset-challenge-source-id",
        tags={"category": "password_reset"},
        valid_until=expires_at,
    )

    assert outbox.status == EmailOutboxStatus.QUEUED.value
    assert outbox.provider == "local"
    assert outbox.recipient == "user@example.com"
    assert outbox.source_id == "challenge-source-id"
    assert "123456" not in outbox.template_payload_json
    assert "body" not in outbox.__table__.columns
    db.add.assert_called_once_with(outbox)
    db.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_brevo_outbox_snapshots_sender_and_redacts_future_delivery_logs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        email_delivery_mode="brevo",
        brevo_api_key=SecretStr("xkeysib-test_sending_key_123456789"),
        email_from_name="TANAW System",
        email_from_address="no-reply@example.com",
    )
    monkeypatch.setattr("app.features.mail.service.get_settings", lambda: settings)
    db = MagicMock()
    db.flush = AsyncMock()

    outbox = await enqueue_email(
        db,
        account_id="account-1",
        source_id="activation-source-id",
        recipient="user@example.com",
        template_name=EmailTemplateName.ACCOUNT_ACTIVATION,
        template_payload={"tokenId": "activation-source-id"},
        idempotency_key="activation-source-id",
    )

    assert outbox.provider == "brevo"
    assert outbox.sender == "TANAW System <no-reply@example.com>"
    assert REDACTED_EMAIL_BODY == (
        "[Sensitive email content is not retained in production delivery logs.]"
    )


def test_transactional_email_html_escapes_user_controlled_values() -> None:
    malicious_name = '<img src=x onerror="alert(1)">'
    malicious_value = '"><script>alert("tanaw")</script>'
    recipient = EmailRecipient(
        display_name=malicious_name,
        email="recipient@example.com",
        role=AccountRole.ENTERPRISE,
        enterprise_id=malicious_value,
    )

    activation = account_activation_email(
        recipient,
        f"https://tanaw.example/activate-account#token={malicious_value}",
        malicious_value,
    )
    support = support_ticket_reply_email(
        ticket_code=malicious_value,
        subject="Support request",
        recipient_name=malicious_name,
        author_name=malicious_value,
        message=malicious_value,
    )
    email_change = account_email_change_verification_email(
        recipient,
        old_email=malicious_value,
        new_email=malicious_value,
        verification_url=f"https://tanaw.example/verify-email-change#token={malicious_value}",
        expires_label=malicious_value,
    )

    for content in (activation, support, email_change):
        assert malicious_name not in content.html
        assert "<script>" not in content.html
        assert "&lt;" in content.html
        assert "&gt;" in content.html
