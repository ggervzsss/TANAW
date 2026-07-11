from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.features.mail.models import EmailOutboxStatus, EmailTemplateName
from app.features.mail.service import REDACTED_EMAIL_BODY, enqueue_email


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
async def test_resend_outbox_snapshots_sender_and_redacts_future_delivery_logs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        email_delivery_mode="resend",
        resend_api_key=SecretStr("re_test_sending_key_123456789"),
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

    assert outbox.provider == "resend"
    assert outbox.sender == "TANAW System <no-reply@example.com>"
    assert REDACTED_EMAIL_BODY == (
        "[Sensitive email content is not retained in production delivery logs.]"
    )
