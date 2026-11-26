from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.features.accounts import requests_router
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.accounts.schemas import AccountStatusUpdate
from app.features.auth.password_recovery import PasswordResetRequestResult
from app.features.auth.recovery_rate_limit import (
    PasswordResetRateContext,
    PasswordResetRateLimitExceeded,
)

NOW = datetime(2026, 11, 20, 4, 0, tzinfo=UTC)


def _account(
    account_id: str,
    *,
    role: AccountRole = AccountRole.STAFF,
    status: AccountStatus = AccountStatus.ACTIVE,
    activated: bool = True,
) -> Account:
    account = Account(
        id=account_id,
        email=f"{account_id}@example.com",
        password_hash="hash",
        role=role,
        display_name=f"Name {account_id}",
        title="Title",
        status=status,
        is_protected_system_account=False,
        activated_at=NOW if activated else None,
    )
    if role == AccountRole.ENTERPRISE:
        account.enterprise_profile = EnterpriseProfile(
            account_id=account_id,
            enterprise_id=f"{account_id}_001@tanaw.sanpedro",
            enterprise_name="Laguna Heritage Park",
            attraction_code="411",
            manager_name="Ana Cruz",
            barangay="Poblacion",
        )
    return account


def _db_returning(account: Account | None) -> MagicMock:
    db = MagicMock()
    db.scalar = AsyncMock(return_value=account)
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


@pytest.fixture
def status_side_effects(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    mocks = {
        "ensure_privileged_account_remains_available": AsyncMock(),
        "invalidate_password_reset_challenges": AsyncMock(),
        "invalidate_account_email_change_requests": AsyncMock(),
        "sync_pending_account_activation": AsyncMock(),
        "record_account_log": AsyncMock(),
        "to_account_summary_with_requests": AsyncMock(return_value="summary"),
    }
    for name, mock in mocks.items():
        monkeypatch.setattr(requests_router, name, mock)
    return mocks


@pytest.mark.asyncio
async def test_it_cannot_deactivate_its_own_account(
    status_side_effects: dict[str, AsyncMock],
) -> None:
    actor = _account("it-1", role=AccountRole.IT)

    with pytest.raises(HTTPException) as raised:
        await requests_router.update_account_status(
            actor.id, AccountStatusUpdate(status="inactive"), actor, _db_returning(actor)
        )

    assert raised.value.status_code == 400
    assert raised.value.detail == "You cannot deactivate your own account."
    assert actor.status == AccountStatus.ACTIVE


@pytest.mark.asyncio
async def test_deactivation_records_who_and_when_and_activation_clears_it(
    status_side_effects: dict[str, AsyncMock],
) -> None:
    actor = _account("it-1", role=AccountRole.IT)
    account = _account("staff-1")
    db = _db_returning(account)

    await requests_router.update_account_status(
        account.id, AccountStatusUpdate(status="inactive"), actor, db
    )

    assert account.status == AccountStatus.INACTIVE
    assert account.deactivated_at is not None
    assert account.deactivated_by_name == actor.display_name
    summary_call = status_side_effects["to_account_summary_with_requests"].await_args
    assert summary_call is not None and summary_call.kwargs["viewer"] is actor

    await requests_router.update_account_status(
        account.id, AccountStatusUpdate(status="active"), actor, db
    )

    assert account.status == AccountStatus.ACTIVE
    assert account.deactivated_at is None
    assert account.deactivated_by_name is None


def _reset_result(*, reused: bool = False) -> PasswordResetRequestResult:
    return PasswordResetRequestResult(
        challenge_id="challenge-1",
        expires_in_minutes=10,
        resend_available_in_seconds=45 if reused else 60,
        reused_challenge=reused,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("role", "group"),
    ((AccountRole.ENTERPRISE, "Enterprises"), (AccountRole.STAFF, "Accounts")),
)
async def test_it_sends_the_self_service_reset_code_and_logs_it(
    monkeypatch: pytest.MonkeyPatch, role: AccountRole, group: str
) -> None:
    actor = _account("it-1", role=AccountRole.IT)
    account = _account("owner-1", role=role)
    request_reset = AsyncMock(return_value=_reset_result())
    record_log = AsyncMock()
    monkeypatch.setattr(requests_router, "request_password_reset", request_reset)
    monkeypatch.setattr(requests_router, "record_account_log", record_log)

    response = await requests_router.send_account_password_reset(
        account.id, actor, _db_returning(account)
    )

    assert response.sentTo == account.email
    reset_call = request_reset.await_args
    assert reset_call is not None
    assert reset_call.args[1] == account.email
    assert reset_call.kwargs["issued_by"] is actor
    assert reset_call.kwargs["client_ip"] == f"it-personnel:{actor.id}"
    log_call = record_log.await_args
    assert log_call is not None
    log_kwargs = log_call.kwargs
    assert log_kwargs["group"] == group
    assert log_kwargs["action"] == "Send Password Reset"
    assert log_kwargs["source_id"] == account.id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("account", "status_code"),
    (
        (None, 404),
        (_account("pending-1", activated=False), 400),
        (_account("inactive-1", status=AccountStatus.INACTIVE), 400),
    ),
)
async def test_password_reset_needs_an_active_activated_account(
    monkeypatch: pytest.MonkeyPatch, account: Account | None, status_code: int
) -> None:
    request_reset = AsyncMock(return_value=_reset_result())
    monkeypatch.setattr(requests_router, "request_password_reset", request_reset)

    with pytest.raises(HTTPException) as raised:
        await requests_router.send_account_password_reset(
            "missing", _account("it-1", role=AccountRole.IT), _db_returning(account)
        )

    assert raised.value.status_code == status_code
    request_reset.assert_not_awaited()


@pytest.mark.asyncio
async def test_password_reset_is_rate_limited_per_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _account("owner-1")
    record_log = AsyncMock()
    monkeypatch.setattr(requests_router, "record_account_log", record_log)
    monkeypatch.setattr(
        requests_router,
        "request_password_reset",
        AsyncMock(return_value=_reset_result(reused=True)),
    )

    with pytest.raises(HTTPException) as cooldown:
        await requests_router.send_account_password_reset(
            account.id, _account("it-1", role=AccountRole.IT), _db_returning(account)
        )

    monkeypatch.setattr(
        requests_router,
        "request_password_reset",
        AsyncMock(
            side_effect=PasswordResetRateLimitExceeded(
                retry_after_seconds=600,
                context=PasswordResetRateContext(identifier_hash="i", ip_hash="p"),
                exceeded_scopes=("identifier",),
                should_record_event=True,
            )
        ),
    )
    with pytest.raises(HTTPException) as limited:
        await requests_router.send_account_password_reset(
            account.id, _account("it-1", role=AccountRole.IT), _db_returning(account)
        )

    assert cooldown.value.status_code == 429
    assert cooldown.value.headers == {"Retry-After": "45"}
    assert limited.value.status_code == 429
    assert limited.value.headers == {"Retry-After": "600"}
    record_log.assert_not_awaited()
