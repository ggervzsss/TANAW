from datetime import timedelta

import pytest

from app.features.auth import password_recovery


def setup_function() -> None:
    password_recovery._password_reset_challenges.clear()


def teardown_function() -> None:
    password_recovery._password_reset_challenges.clear()


def test_verification_code_is_consumed_after_successful_verify() -> None:
    challenge_id = "challenge-1"
    code = "123456"
    challenge = password_recovery.PasswordResetChallenge(
        id=challenge_id,
        email="user@example.com",
        account_id="account-1",
        code_hash=password_recovery._hash_secret(challenge_id, code, "password-reset-code"),
        expires_at=password_recovery._now() + timedelta(minutes=password_recovery.OTP_TTL_MINUTES),
    )
    password_recovery._password_reset_challenges[challenge_id] = challenge

    reset_token = password_recovery.verify_password_reset_code(challenge_id, code)

    assert reset_token
    assert challenge.verified is True
    assert challenge.code_consumed is True
    assert challenge.code_hash == ""
    assert challenge.attempts == 1

    with pytest.raises(
        password_recovery.PasswordRecoveryError, match="Invalid or expired verification code."
    ):
        password_recovery.verify_password_reset_code(challenge_id, code)
