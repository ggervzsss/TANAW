from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.config import Settings, get_settings
from app.features.accounts.models import DeliveryStatus
from app.features.mail.service import REDACTED_EMAIL_BODY, deliver_email
from app.features.mail.templates import EmailContent


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
        frontend_public_url="https://tanaw-sanpedro.vercel.app",
        jwt_secret_key="production-jwt-secret-with-at-least-32-characters",
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
