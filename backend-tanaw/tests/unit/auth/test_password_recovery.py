from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.auth import password_recovery
from app.features.auth.models import PasswordResetChallenge


@pytest.mark.asyncio
async def test_verification_code_is_consumed_after_successful_verify() -> None:
    challenge_id = "challenge-1"
    code = "123456"
    challenge = PasswordResetChallenge(
        id=challenge_id,
        email="user@example.com",
        account_id="account-1",
        code_hash=password_recovery._hash_secret(challenge_id, code, "password-reset-code"),
        expires_at=password_recovery._now() + timedelta(minutes=password_recovery.OTP_TTL_MINUTES),
        attempts=0,
        verified=False,
        code_consumed=False,
        used=False,
    )
    db = MagicMock()
    db.scalar = AsyncMock(return_value=challenge)
    db.execute = AsyncMock()
    db.commit = AsyncMock()

    reset_token = await password_recovery.verify_password_reset_code(db, challenge_id, code)

    assert reset_token
    assert challenge.verified is True
    assert challenge.verified_at is not None
    assert challenge.code_consumed is True
    assert challenge.code_hash == ""
    assert challenge.attempts == 1

    with pytest.raises(
        password_recovery.PasswordRecoveryError, match="Invalid or expired verification code."
    ):
        await password_recovery.verify_password_reset_code(db, challenge_id, code)


@pytest.mark.asyncio
async def test_invalid_verification_code_increments_and_persists_attempt() -> None:
    challenge_id = "challenge-2"
    challenge = PasswordResetChallenge(
        id=challenge_id,
        email="user@example.com",
        account_id="account-1",
        code_hash=password_recovery._hash_secret(challenge_id, "123456", "password-reset-code"),
        expires_at=password_recovery._now() + timedelta(minutes=password_recovery.OTP_TTL_MINUTES),
        attempts=0,
        verified=False,
        code_consumed=False,
        used=False,
    )
    db = MagicMock()
    db.scalar = AsyncMock(return_value=challenge)
    db.commit = AsyncMock()

    with pytest.raises(
        password_recovery.PasswordRecoveryError, match="Invalid or expired verification code."
    ):
        await password_recovery.verify_password_reset_code(db, challenge_id, "654321")

    assert challenge.attempts == 1
    assert "FOR UPDATE" in str(db.scalar.await_args_list[0].args[0])
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_invalid_reset_tokens_are_bounded_and_invalidate_the_challenge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    challenge_id = "challenge-reset-attempts"
    valid_reset_token = "valid-reset-token"
    challenge = PasswordResetChallenge(
        id=challenge_id,
        email="user@example.com",
        account_id="account-1",
        code_hash="",
        expires_at=password_recovery._now() + timedelta(minutes=password_recovery.OTP_TTL_MINUTES),
        attempts=1,
        reset_attempts=0,
        verified=True,
        code_consumed=True,
        used=False,
        reset_token_hash=password_recovery._hash_secret(
            challenge_id,
            valid_reset_token,
            "password-reset-token",
        ),
    )
    cancel = AsyncMock()
    monkeypatch.setattr(password_recovery, "cancel_pending_source_emails", cancel)
    db = MagicMock()
    db.scalar = AsyncMock(return_value=challenge)
    db.commit = AsyncMock()

    for _ in range(password_recovery.MAX_RESET_TOKEN_ATTEMPTS):
        with pytest.raises(
            password_recovery.PasswordRecoveryError,
            match="Password reset session is invalid or expired.",
        ):
            await password_recovery.reset_password_with_token(
                db,
                challenge_id=challenge_id,
                reset_token="wrong-reset-token",
                new_password="New recovery passphrase 2026",
            )

    assert challenge.reset_attempts == password_recovery.MAX_RESET_TOKEN_ATTEMPTS
    assert challenge.invalidated_at is not None
    assert challenge.used is True
    assert challenge.reset_token_hash is None
    cancel.assert_awaited_once()
    assert db.commit.await_count == password_recovery.MAX_RESET_TOKEN_ATTEMPTS
    assert all("FOR UPDATE" in str(call.args[0]) for call in db.scalar.await_args_list)
