import base64
import hashlib
import hmac
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.config import Settings, get_settings
from app.features.accounts.models import DeliveryStatus
from app.features.mail.router import _email_body_as_text, verify_resend_webhook
from app.features.mail.service import REDACTED_EMAIL_BODY, deliver_email
from app.features.mail.templates import EmailContent


def test_resend_webhook_signature_is_verified() -> None:
    payload = b'{"type":"email.received"}'
    event_id = "msg_test"
    timestamp = str(int(time.time()))
    secret_bytes = b"tanaw-webhook-secret"
    secret = f"whsec_{base64.b64encode(secret_bytes).decode()}"
    signed_payload = f"{event_id}.{timestamp}.".encode() + payload
    signature = base64.b64encode(
        hmac.new(secret_bytes, signed_payload, hashlib.sha256).digest()
    ).decode()

    assert verify_resend_webhook(
        payload=payload,
        event_id=event_id,
        timestamp=timestamp,
        signature=f"v1,{signature}",
        secret=secret,
    )
    assert not verify_resend_webhook(
        payload=b"tampered",
        event_id=event_id,
        timestamp=timestamp,
        signature=f"v1,{signature}",
        secret=secret,
    )


def test_received_html_is_converted_to_plain_text() -> None:
    assert _email_body_as_text(None, "<p>Hello <strong>TANAW</strong></p><script>x</script>") == (
        "Hello TANAW"
    )


@pytest.mark.asyncio
async def test_log_mode_retains_message_for_local_development() -> None:
    get_settings.cache_clear()
    db = MagicMock()
    content = EmailContent(subject="Test", text="Secret body", html="<p>Secret body</p>")

    delivery = await deliver_email(
        db,
        account_id="account-1",
        recipient="USER@example.com",
        content=content,
        idempotency_key="test-log-mode",
    )

    assert delivery.status == DeliveryStatus.RECORDED
    assert delivery.body == "Secret body"
    assert delivery.recipient == "user@example.com"
    db.add.assert_called_once_with(delivery)


@pytest.mark.asyncio
async def test_resend_mode_redacts_sensitive_delivery_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        email_delivery_mode="resend",
        resend_api_key="test-key",
        email_test_recipient="user@example.com",
    )
    client = AsyncMock()
    client.send_email.return_value.id = "email-1"
    monkeypatch.setattr("app.features.mail.service.get_settings", lambda: settings)
    monkeypatch.setattr("app.features.mail.service._resend_client", lambda _: client)
    db = MagicMock()
    content = EmailContent(subject="OTP", text="Code 123456", html="<p>Code 123456</p>")

    delivery = await deliver_email(
        db,
        account_id="account-1",
        recipient="user@example.com",
        content=content,
        idempotency_key="test-redaction",
    )

    assert delivery.status == DeliveryStatus.SENT
    assert delivery.body == REDACTED_EMAIL_BODY
    assert "123456" not in delivery.body
    assert delivery.provider_message_id == "email-1"


@pytest.mark.asyncio
async def test_production_never_records_sensitive_content_in_log_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        environment="production",
        cors_origins="https://tanaw-sanpedro.vercel.app",
        email_delivery_mode="log",
    )
    monkeypatch.setattr("app.features.mail.service.get_settings", lambda: settings)
    db = MagicMock()
    content = EmailContent(subject="OTP", text="Code 123456", html="<p>Code 123456</p>")

    delivery = await deliver_email(
        db,
        account_id="account-1",
        recipient="user@example.com",
        content=content,
        idempotency_key="test-production-redaction",
        raise_on_failure=False,
    )

    assert delivery.status == DeliveryStatus.FAILED
    assert delivery.body == REDACTED_EMAIL_BODY
    assert "123456" not in delivery.body
