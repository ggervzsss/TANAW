from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import String, Table

from app.api.router import api_router
from app.core.config import Settings
from app.core.security import hash_password, verify_password
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.auth import account_activation, password_recovery
from app.features.auth import service as auth_service
from app.features.auth.models import AccountActivationToken
from app.features.mail.templates import account_activation_email


def test_activation_schema_replaces_temporary_password_state() -> None:
    account_columns = Account.__table__.columns
    assert "activated_at" in account_columns
    assert account_columns["activated_at"].nullable is True
    assert account_columns["password_hash"].nullable is False
    assert "must_change_password" not in account_columns
    assert "temporary_password_created_at" not in account_columns
    assert "temporary_password_expires_at" not in account_columns


def test_activation_tokens_store_only_a_hash_and_expire() -> None:
    token_table = cast(Table, AccountActivationToken.__table__)
    token_columns = token_table.columns
    assert set(token_columns.keys()) == {
        "id",
        "account_id",
        "token_hash",
        "expires_at",
        "consumed_at",
        "invalidated_at",
        "created_at",
    }
    token_hash_type = token_columns["token_hash"].type
    assert isinstance(token_hash_type, String)
    assert token_hash_type.length == 64
    assert "token" not in token_columns

    foreign_key = next(iter(token_columns["account_id"].foreign_keys))
    assert foreign_key.target_fullname == "accounts.id"
    assert foreign_key.ondelete == "CASCADE"

    indexes = {str(index.name): index for index in token_table.indexes if index.name is not None}
    assert indexes["ix_account_activation_tokens_token_hash"].unique is True
    assert "ix_account_activation_tokens_account_id" in indexes
    assert "ix_account_activation_tokens_expires_at" in indexes


def test_activation_configuration_has_safe_development_defaults() -> None:
    settings = Settings()

    assert settings.frontend_public_url == "http://localhost:5173"
    assert settings.account_activation_ttl_hours == 24


def test_activation_email_contains_a_link_without_an_emailed_password() -> None:
    account = Account(
        email="user@example.com",
        password_hash="unusable-password-hash",
        role=AccountRole.STAFF,
        display_name="Test User",
        title="LGU Staff",
        status=AccountStatus.ACTIVE,
    )
    activation_url = "https://tanaw.example/activate-account?token=secret-token"

    content = account_activation_email(account, activation_url, "2026-07-12 12:00 UTC")

    assert content.subject == "Activate your TANAW account"
    assert activation_url in content.text
    assert activation_url.replace("&", "&amp;") in content.html
    assert "Temporary password" not in content.text
    assert "unusable-password-hash" not in content.text
    assert "unusable-password-hash" not in content.html


def test_activation_endpoints_are_post_only() -> None:
    routes = {
        route.path: route.methods for route in api_router.routes if isinstance(route, APIRoute)
    }

    assert routes["/auth/account-activation/validate"] == {"POST"}
    assert routes["/auth/account-activation/complete"] == {"POST"}
    assert routes["/accounts/{account_id}/activation"] == {"POST"}


@pytest.mark.asyncio
async def test_pending_account_cannot_authenticate(monkeypatch: pytest.MonkeyPatch) -> None:
    account = activation_account(activated_at=None)
    lookup = AsyncMock(return_value=account)
    password_verifier = MagicMock(return_value=True)
    monkeypatch.setattr(auth_service, "get_account_by_login_identifier", lookup)
    monkeypatch.setattr(auth_service, "verify_password", password_verifier)

    authenticated = await auth_service.authenticate_account(
        MagicMock(), account.email, "Existing1!Password"
    )

    assert authenticated is None
    password_verifier.assert_not_called()


@pytest.mark.asyncio
async def test_activation_completion_sets_password_and_consumes_token() -> None:
    raw_token = "valid-activation-token"
    account = activation_account(activated_at=None)
    token = activation_token(
        raw_token,
        expires_at=account_activation._now() + timedelta(hours=1),
    )
    db = MagicMock()
    db.scalar = AsyncMock(side_effect=[token, account, token])
    db.scalars = AsyncMock(return_value=[])
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    new_password = "New account passphrase 2026"
    activated = await account_activation.complete_account_activation(db, raw_token, new_password)

    assert activated is account
    assert account.activated_at is not None
    assert account.password_changed_at == account.activated_at
    assert account.token_invalid_before == account.activated_at
    assert account.failed_login_attempts == 0
    assert account.locked_until is None
    assert verify_password(new_password, account.password_hash)
    assert token.consumed_at == account.activated_at
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(account)


@pytest.mark.parametrize("token_state", ["invalid", "expired", "reused"])
@pytest.mark.asyncio
async def test_invalid_expired_and_reused_activation_tokens_are_rejected(
    token_state: str,
) -> None:
    raw_token = "invalid-activation-token"
    token: AccountActivationToken | None
    if token_state == "invalid":
        token = None
    else:
        token = activation_token(
            raw_token,
            expires_at=(
                account_activation._now() - timedelta(seconds=1)
                if token_state == "expired"
                else account_activation._now() + timedelta(hours=1)
            ),
        )
        if token_state == "reused":
            token.consumed_at = account_activation._now()

    db = MagicMock()
    db.scalar = AsyncMock(return_value=token)

    with pytest.raises(
        account_activation.AccountActivationError,
        match="Activation link is invalid or expired.",
    ):
        await account_activation.validate_account_activation(db, raw_token)


@pytest.mark.asyncio
async def test_resending_activation_rotates_hash_without_storing_raw_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token_ids = ["first-activation-source-id", "second-activation-source-id"]
    settings = SimpleNamespace(
        email_secret_key_value="activation-test-secret",
        frontend_public_url="https://tanaw.example",
        account_activation_ttl_hours=24,
    )
    enqueue = AsyncMock()
    monkeypatch.setattr(account_activation, "get_settings", lambda: settings)
    monkeypatch.setattr(
        account_activation.secrets, "token_urlsafe", MagicMock(side_effect=token_ids)
    )
    monkeypatch.setattr(account_activation, "enqueue_email", enqueue)
    account = activation_account(activated_at=None)
    db = MagicMock()
    db.scalar = AsyncMock(return_value=account)
    db.scalars = AsyncMock(return_value=[])
    db.execute = AsyncMock()
    db.flush = AsyncMock()

    first = await account_activation.issue_account_activation(db, account)
    second = await account_activation.issue_account_activation(db, account)

    first_raw_token = account_activation.derive_account_activation_token(token_ids[0])
    second_raw_token = account_activation.derive_account_activation_token(token_ids[1])
    assert first.token_hash == account_activation._hash_token(first_raw_token)
    assert second.token_hash == account_activation._hash_token(second_raw_token)
    assert first.token_hash != second.token_hash
    assert not hasattr(first, "token")
    assert not hasattr(first, "raw_token")
    assert not hasattr(second, "token")
    assert not hasattr(second, "raw_token")
    assert db.execute.await_count == 2
    assert db.scalar.await_count == 2
    assert all("FOR UPDATE" in str(call.args[0]) for call in db.scalar.await_args_list)
    assert db.flush.await_count == 2
    assert db.add.call_count == 2
    assert enqueue.await_count == 2
    second_payload = enqueue.await_args_list[1].kwargs["template_payload"]
    assert second_payload["tokenId"] == token_ids[1]
    assert first_raw_token not in str(second_payload)
    assert second_raw_token not in str(second_payload)


@pytest.mark.asyncio
async def test_pending_account_is_ineligible_for_forgot_password_otp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = activation_account(activated_at=None)
    lookup = AsyncMock(return_value=account)
    enqueue = AsyncMock()
    monkeypatch.setattr(password_recovery, "get_account_by_email", lookup)
    monkeypatch.setattr(password_recovery, "enqueue_email", enqueue)
    monkeypatch.setattr(
        password_recovery,
        "consume_password_reset_rate_limits",
        AsyncMock(),
    )
    monkeypatch.setattr(
        password_recovery,
        "invalidate_password_reset_challenges_for_email",
        AsyncMock(),
    )
    monkeypatch.setattr(password_recovery, "_add_request_security_log", MagicMock())
    db = MagicMock()
    db.scalar = AsyncMock(return_value=None)
    db.commit = AsyncMock()

    result = await password_recovery.request_password_reset(db, account.email)
    challenge = db.add.call_args.args[0]

    assert challenge.account_id is None
    assert result.challenge_id == challenge.id
    assert result.reused_challenge is False
    enqueue.assert_not_awaited()
    db.add.assert_called_once_with(challenge)
    db.commit.assert_awaited_once()


def activation_account(*, activated_at: datetime | None) -> Account:
    return Account(
        id="account-1",
        email="user@example.com",
        password_hash=hash_password("Existing1!Password"),
        role=AccountRole.STAFF,
        display_name="Test User",
        title="LGU Staff",
        status=AccountStatus.ACTIVE,
        activated_at=activated_at,
        failed_login_attempts=2,
        locked_until=datetime.now(UTC) + timedelta(minutes=5),
    )


def activation_token(raw_token: str, *, expires_at: datetime) -> AccountActivationToken:
    return AccountActivationToken(
        id="activation-1",
        account_id="account-1",
        token_hash=account_activation._hash_token(raw_token),
        expires_at=expires_at,
    )
