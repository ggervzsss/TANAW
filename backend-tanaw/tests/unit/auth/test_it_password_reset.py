from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.auth import password_recovery
from app.features.auth.models import PasswordResetChallenge
from app.features.mail.templates import EmailRecipient, password_reset_code_email


def _account(account_id: str, role: AccountRole) -> Account:
    return Account(
        id=account_id,
        email=f"{account_id}@example.com",
        password_hash="hash",
        role=role,
        display_name=f"Name {account_id}",
        title="Title",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )


def _challenge(
    *, issued_by_name: str | None, claimed: bool, age: timedelta
) -> PasswordResetChallenge:
    now = datetime.now(UTC)
    return PasswordResetChallenge(
        id="existing-challenge",
        email="owner@example.com",
        account_id="owner",
        code_hash="hash",
        expires_at=now + timedelta(minutes=5),
        attempts=0,
        reset_attempts=0,
        verified=False,
        code_consumed=False,
        used=False,
        issued_by_name=issued_by_name,
        claimed_at=now if claimed else None,
        created_at=now - age,
    )


@pytest.fixture
def recovery_mocks(monkeypatch: pytest.MonkeyPatch) -> dict[str, MagicMock]:
    mocks: dict[str, MagicMock] = {
        "get_account_by_email": AsyncMock(return_value=_account("owner", AccountRole.STAFF)),
        "enqueue_email": AsyncMock(),
        "consume_password_reset_rate_limits": AsyncMock(),
        "invalidate_password_reset_challenges_for_email": AsyncMock(),
        "_add_request_security_log": MagicMock(),
    }
    for name, mock in mocks.items():
        monkeypatch.setattr(password_recovery, name, mock)
    return mocks


def _db(recent: PasswordResetChallenge | None) -> MagicMock:
    db = MagicMock()
    db.scalar = AsyncMock(return_value=recent)
    db.commit = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_it_issued_code_records_the_sender_and_names_it_in_the_email(
    recovery_mocks: dict[str, MagicMock],
) -> None:
    actor = _account("it-1", AccountRole.IT)
    db = _db(None)

    result = await password_recovery.request_password_reset(
        db, "owner@example.com", client_ip="it-personnel:it-1", issued_by=actor
    )

    challenge = db.add.call_args.args[0]
    assert challenge.issued_by_name == actor.display_name
    assert challenge.claimed_at is None
    assert result.reused_challenge is False
    payload = recovery_mocks["enqueue_email"].await_args.kwargs["template_payload"]
    assert payload["issuedByName"] == actor.display_name


@pytest.mark.asyncio
async def test_owner_request_picks_up_the_code_it_sent_instead_of_replacing_it(
    recovery_mocks: dict[str, MagicMock],
) -> None:
    recent = _challenge(issued_by_name="Name it-1", claimed=False, age=timedelta(minutes=4))
    db = _db(recent)

    result = await password_recovery.request_password_reset(db, "owner@example.com")

    assert result.challenge_id == recent.id
    assert result.reused_challenge is True
    assert recent.claimed_at is not None
    db.add.assert_not_called()
    recovery_mocks["enqueue_email"].assert_not_awaited()
    recovery_mocks["invalidate_password_reset_challenges_for_email"].assert_not_awaited()


@pytest.mark.asyncio
async def test_a_claimed_it_code_is_replaced_by_the_next_request_after_cooldown(
    recovery_mocks: dict[str, MagicMock],
) -> None:
    recent = _challenge(issued_by_name="Name it-1", claimed=True, age=timedelta(minutes=4))
    db = _db(recent)

    result = await password_recovery.request_password_reset(db, "owner@example.com")

    assert result.challenge_id != recent.id
    assert result.reused_challenge is False
    recovery_mocks["enqueue_email"].assert_awaited_once()


@pytest.mark.asyncio
async def test_it_cannot_resend_inside_the_cooldown(
    recovery_mocks: dict[str, MagicMock],
) -> None:
    recent = _challenge(issued_by_name=None, claimed=False, age=timedelta(seconds=5))
    db = _db(recent)

    result = await password_recovery.request_password_reset(
        db,
        "owner@example.com",
        client_ip="it-personnel:it-1",
        issued_by=_account("it-1", AccountRole.IT),
    )

    assert result.reused_challenge is True
    assert result.resend_available_in_seconds > 0
    db.add.assert_not_called()
    recovery_mocks["enqueue_email"].assert_not_awaited()


def test_it_sent_email_tells_the_owner_how_to_use_the_code() -> None:
    recipient = EmailRecipient(
        display_name="Maria Santos", email="maria@example.com", role=AccountRole.STAFF
    )

    it_sent = password_reset_code_email(
        recipient, "123456", "Nov 20, 2026 12:10 PM", issued_by_name="Jose Reyes"
    )
    self_service = password_reset_code_email(recipient, "123456", "Nov 20, 2026 12:10 PM")

    assert "Jose Reyes from TANAW IT" in it_sent.text
    assert "Forgot password" in it_sent.text
    assert "Jose Reyes" not in self_service.text
    assert "123456" in it_sent.html
