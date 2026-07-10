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
    db.commit = AsyncMock()

    reset_token = await password_recovery.verify_password_reset_code(db, challenge_id, code)

    assert reset_token
    assert challenge.verified is True
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
    db.commit.assert_awaited_once()
