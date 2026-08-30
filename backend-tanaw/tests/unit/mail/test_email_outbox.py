import base64
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.auth import account_activation, password_recovery
from app.features.auth.models import PasswordResetChallenge
from app.features.auth.secret_values import (
    derive_account_activation_token,
    derive_password_reset_code,
)
from app.features.mail.models import EmailOutbox, EmailOutboxStatus
from app.features.mail.router import to_email_delivery_summary
from app.features.mail.schemas import EmailDeliverySummary
from app.features.mail.service import EmailOutboxRetryError, retry_terminal_email
from app.features.mail.worker import _retry_delay_seconds


def test_derived_activation_value_contains_256_bits_and_only_hash_is_verifier() -> None:
    token_id = "source-id-with-random-material-for-test"
    raw_token = derive_account_activation_token(token_id)
    padded = raw_token + "=" * (-len(raw_token) % 4)

    assert len(base64.urlsafe_b64decode(padded)) == 32
    assert len(account_activation._hash_token(raw_token)) == 64
    assert raw_token != token_id


def test_derived_password_code_matches_stored_verifier_without_persistence() -> None:
    challenge_id = "password-reset-source-id"
    code = derive_password_reset_code(challenge_id)
    stored_hash = password_recovery._hash_secret(challenge_id, code, "password-reset-code")

    assert len(code) == 6
    assert code.isdigit()
    assert len(stored_hash) == 64
    assert stored_hash != code
    assert "code" not in PasswordResetChallenge.__table__.columns


@pytest.mark.parametrize(
    ("attempt_count", "expected_seconds"),
    ((1, 30.0), (2, 120.0), (3, 300.0), (4, 600.0), (5, 600.0), (8, 600.0)),
)
def test_email_retry_schedule_uses_bounded_exponential_backoff(
    attempt_count: int, expected_seconds: float
) -> None:
    assert _retry_delay_seconds(attempt_count) == expected_seconds


def test_authorized_delivery_summary_never_exposes_template_payload_or_secrets() -> None:
    assert "template_payload_json" not in EmailDeliverySummary.model_fields
    assert "sender" not in EmailDeliverySummary.model_fields
    assert "idempotency_key" not in EmailDeliverySummary.model_fields

    record = outbox_record(status=EmailOutboxStatus.ACCEPTED)
    record.provider_message_id = "provider-1"
    record.accepted_at = datetime.now(UTC)
    summary = to_email_delivery_summary(record)

    assert summary.status == "accepted"
    assert summary.providerMessageId == "provider-1"
    assert summary.canRetry is False


@pytest.mark.asyncio
async def test_manual_retry_preserves_attempt_history_and_increments_retry_count() -> None:
    record = outbox_record(status=EmailOutboxStatus.TERMINAL_FAILED)
    record.attempt_count = 5
    record.max_attempts = 5
    db = MagicMock()
    db.scalar = AsyncMock(return_value=record)
    db.flush = AsyncMock()
    db.refresh = AsyncMock()

    result = await retry_terminal_email(db, record.id)

    assert result.status == EmailOutboxStatus.QUEUED.value
    assert result.attempt_count == 5
    assert result.max_attempts == 6
    assert result.manual_retry_count == 1
    db.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_manual_retry_rejects_expired_or_ambiguous_old_delivery() -> None:
    record = outbox_record(status=EmailOutboxStatus.TERMINAL_FAILED)
    record.first_provider_attempt_at = datetime.now(UTC) - timedelta(minutes=30)
    db = MagicMock()
    db.scalar = AsyncMock(return_value=record)

    with pytest.raises(EmailOutboxRetryError, match="idempotency window"):
        await retry_terminal_email(db, record.id)


def outbox_record(*, status: EmailOutboxStatus) -> EmailOutbox:
    now = datetime.now(UTC)
    return EmailOutbox(
        id="outbox-1",
        account_id="account-1",
        purpose="account_activation",
        source_id="source-1",
        recipient="user@example.com",
        sender="TANAW <no-reply@example.com>",
        template_name="account_activation",
        template_version="v1",
        secret_version="v1",
        template_payload_json='{"tokenId":"source-1"}',
        idempotency_key="activation-source-1",
        provider="brevo",
        status=status.value,
        attempt_count=0,
        max_attempts=5,
        next_attempt_at=now,
        valid_until=now + timedelta(hours=1),
        outcome_uncertain=False,
        manual_retry_count=0,
        created_at=now,
        updated_at=now,
    )
