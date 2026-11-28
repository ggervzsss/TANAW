import base64
import json
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import jwt
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response

from app.core.security import decode_access_token, hash_password
from app.db.session import get_db
from app.features.accounts import dependencies as account_dependencies
from app.features.accounts.dependencies import is_token_invalidated
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import to_auth_user
from app.features.auth import session_router, two_factor_router
from app.features.auth.http_session import SIGNED_IN_AT_CLAIM, create_session_token
from app.features.auth.service import LoginLockoutPolicy
from app.features.auth.totp import hotp, totp_time_step
from app.features.auth.two_factor import (
    TwoFactorError,
    confirm_two_factor_setup,
    consume_recovery_code,
    create_two_factor_challenge,
    disable_two_factor,
    is_challenge_still_valid,
    is_two_factor_enabled,
    read_two_factor_challenge,
    recovery_code_hashes,
    start_two_factor_setup,
    verify_two_factor_code,
)

PASSWORD = "Correct horse two-step passphrase"


def _account(role: AccountRole = AccountRole.STAFF) -> Account:
    now = datetime.now(UTC)
    return Account(
        id=f"two-factor-{role.value}",
        email=f"{role.value}.two-factor@example.com",
        password_hash=hash_password(PASSWORD),
        role=role,
        display_name="Two Factor Tester",
        title="LGU Staff",
        status=AccountStatus.ACTIVE,
        activated_at=now - timedelta(days=30),
        failed_login_attempts=0,
    )


def _key(secret: str) -> bytes:
    return base64.b32decode(secret + "=" * (-len(secret) % 8))


def _code(key: bytes, at: datetime, offset: int = 0) -> str:
    return hotp(key, totp_time_step(at.timestamp()) + offset)


def _enable(account: Account, now: datetime) -> tuple[bytes, list[str]]:
    setup = start_two_factor_setup(account)
    key = _key(setup.secret)
    return key, confirm_two_factor_setup(account, _code(key, now), now=now)


# ---------------------------------------------------------------- Service rules


def test_setup_keeps_a_pending_key_until_a_code_from_it_is_confirmed() -> None:
    account = _account()
    now = datetime.now(UTC)

    setup = start_two_factor_setup(account)

    assert not is_two_factor_enabled(account)
    assert account.totp_secret_seed is None
    assert account.totp_pending_secret_seed is not None
    # Only the seed is stored; the key shown to the owner is derived with the server secret.
    assert setup.secret not in account.totp_pending_secret_seed
    assert setup.otpauth_uri.startswith(f"otpauth://totp/TANAW:{account.email}?secret=")
    assert f"secret={setup.secret}" in setup.otpauth_uri
    assert "issuer=TANAW" in setup.otpauth_uri

    with pytest.raises(TwoFactorError, match="did not match"):
        confirm_two_factor_setup(account, "000000", now=now)
    assert not is_two_factor_enabled(account)

    key = _key(setup.secret)
    recovery_codes = confirm_two_factor_setup(account, _code(key, now), now=now)

    assert is_two_factor_enabled(account)
    assert account.totp_pending_secret_seed is None
    assert account.totp_enabled_at == now
    assert len(recovery_codes) == 8
    stored = recovery_code_hashes(account)
    assert len(stored) == 8
    assert not any(code in (account.totp_recovery_code_hashes or "") for code in recovery_codes)


def test_setup_is_refused_while_on_and_for_enterprise_accounts() -> None:
    account = _account()
    _enable(account, datetime.now(UTC))

    with pytest.raises(TwoFactorError, match="already on"):
        start_two_factor_setup(account)
    with pytest.raises(TwoFactorError, match="not available"):
        start_two_factor_setup(_account(AccountRole.ENTERPRISE))
    with pytest.raises(TwoFactorError, match="Start the setup again"):
        confirm_two_factor_setup(_account(), "123456", now=datetime.now(UTC))


def test_a_sign_in_code_is_accepted_once() -> None:
    account = _account()
    now = datetime.now(UTC)
    key, _ = _enable(account, now)

    # The code used to confirm the setup cannot be used again to sign in.
    assert not verify_two_factor_code(account, _code(key, now), now=now)
    next_code = _code(key, now, offset=1)
    assert verify_two_factor_code(account, next_code, now=now)
    assert not verify_two_factor_code(account, next_code, now=now)
    assert not verify_two_factor_code(account, "12345", now=now)


def test_each_recovery_code_works_once() -> None:
    account = _account()
    _, recovery_codes = _enable(account, datetime.now(UTC))

    assert consume_recovery_code(account, recovery_codes[0].lower())
    assert len(recovery_code_hashes(account)) == 7
    assert not consume_recovery_code(account, recovery_codes[0])
    assert not consume_recovery_code(account, "AAAAA-AAAAA")
    assert not consume_recovery_code(account, "not a code")
    assert consume_recovery_code(account, recovery_codes[1].replace("-", " "))
    assert len(recovery_code_hashes(account)) == 6


def test_recovery_codes_are_bound_to_their_account() -> None:
    owner = _account()
    other = _account(AccountRole.IT)
    _, owner_codes = _enable(owner, datetime.now(UTC))
    _enable(other, datetime.now(UTC))

    assert not consume_recovery_code(other, owner_codes[0])
    assert consume_recovery_code(owner, owner_codes[0])


def test_disabling_clears_every_two_factor_value() -> None:
    account = _account()
    _enable(account, datetime.now(UTC))

    disable_two_factor(account)

    assert not is_two_factor_enabled(account)
    assert account.totp_secret_seed is None
    assert account.totp_pending_secret_seed is None
    assert account.totp_enabled_at is None
    assert account.totp_last_used_step is None
    assert account.totp_recovery_code_hashes is None
    assert recovery_code_hashes(account) == []


def test_sign_in_challenge_is_signed_short_lived_and_never_a_session_token() -> None:
    account = _account()
    now = datetime.now(UTC)
    _enable(account, now)

    token = create_two_factor_challenge(account, remember=True, now=now)
    challenge = read_two_factor_challenge(token)

    assert challenge is not None
    assert challenge.account_id == account.id
    assert challenge.remember is True
    assert is_challenge_still_valid(challenge, account)
    with pytest.raises(jwt.PyJWTError):
        decode_access_token(token)
    assert "sub" not in jwt.decode(token, options={"verify_signature": False})

    expired = create_two_factor_challenge(account, remember=False, now=now - timedelta(minutes=6))
    assert read_two_factor_challenge(expired) is None
    assert read_two_factor_challenge(token + "x") is None
    assert read_two_factor_challenge(create_session_token(account, remember=False)) is None

    account.token_invalid_before = now + timedelta(seconds=1)
    assert not is_challenge_still_valid(challenge, account)
    account.token_invalid_before = None
    disable_two_factor(account)
    assert not is_challenge_still_valid(challenge, account)


def test_auth_user_reports_two_factor_and_the_previous_sign_in() -> None:
    account = _account()
    latest = datetime(2026, 11, 28, 8, 15, tzinfo=UTC)
    previous = datetime(2026, 11, 26, 8, 15, tzinfo=UTC)

    assert to_auth_user(account).twoFactorEnabled is False
    assert to_auth_user(account).lastSignInAt is None
    assert to_auth_user(account).status == "active"
    assert to_auth_user(account).isActivated is True
    account.last_login_at = latest
    assert to_auth_user(account).lastSignInAt == latest
    account.previous_login_at = previous
    assert to_auth_user(account).lastSignInAt == previous

    _enable(account, datetime.now(UTC))
    assert to_auth_user(account).twoFactorEnabled is True
    assert to_auth_user(_account(AccountRole.ENTERPRISE)).twoFactorEnabled is None


# ---------------------------------------------------------------- HTTP flows


@dataclass
class AuthHarness:
    client: AsyncClient
    account: Account
    logs: list[dict[str, Any]]
    db: MagicMock

    def actions(self) -> list[str]:
        return [log["action"] for log in self.logs]


@pytest.fixture
def account() -> Iterator[Account]:
    yield _account()


@pytest_asyncio.fixture
async def harness(monkeypatch: pytest.MonkeyPatch, account: Account) -> AsyncIterator[AuthHarness]:
    logs: list[dict[str, Any]] = []

    async def record_log(_db: object, **values: Any) -> None:
        logs.append(values)

    async def find_by_identifier(_db: object, identifier: str, **_: object) -> Account | None:
        return account if identifier.strip().lower() == account.email else None

    async def find_by_id(_db: object, account_id: str, **_: object) -> Account | None:
        return account if account_id == account.id else None

    async def lockout_policy(_db: object) -> LoginLockoutPolicy:
        return LoginLockoutPolicy()

    monkeypatch.setattr(session_router, "record_auth_log", record_log)
    monkeypatch.setattr(two_factor_router, "record_auth_log", record_log)
    monkeypatch.setattr(session_router, "get_account_by_login_identifier", find_by_identifier)
    monkeypatch.setattr(session_router, "get_account_by_id", find_by_id)
    monkeypatch.setattr(two_factor_router, "get_account_by_id", find_by_id)
    monkeypatch.setattr(account_dependencies, "get_account_by_id", find_by_id)
    monkeypatch.setattr(session_router, "get_login_lockout_policy", lockout_policy)
    monkeypatch.setattr(two_factor_router, "get_login_lockout_policy", lockout_policy)

    db = MagicMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.rollback = AsyncMock()

    async def test_db() -> AsyncIterator[MagicMock]:
        yield db

    application = FastAPI()
    application.include_router(session_router.router)
    application.include_router(two_factor_router.router)
    application.dependency_overrides[get_db] = test_db
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        yield AuthHarness(client=client, account=account, logs=logs, db=db)


async def _password_step(
    harness: AuthHarness, password: str = PASSWORD, remember: bool = False
) -> Response:
    return await harness.client.post(
        "/auth/login",
        json={
            "username": harness.account.email,
            "password": password,
            "loginScope": "web",
            "rememberMe": remember,
        },
    )


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_login_without_two_factor_returns_the_same_session_response(
    harness: AuthHarness,
) -> None:
    response = await _password_step(harness, remember=True)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"token", "user"}
    assert body["user"]["email"] == harness.account.email
    assert body["user"]["twoFactorEnabled"] is False
    assert "tanaw_session=" in response.headers["set-cookie"]
    claims = decode_access_token(body["token"])
    assert claims["sub"] == harness.account.id
    assert claims["remember"] is True
    assert isinstance(claims[SIGNED_IN_AT_CLAIM], float)
    assert harness.account.last_login_at is not None
    assert harness.actions() == ["Login"]


@pytest.mark.asyncio
async def test_login_with_two_factor_needs_a_code_before_any_session(
    harness: AuthHarness,
) -> None:
    now = datetime.now(UTC)
    key, _ = _enable(harness.account, now)
    earlier_sign_in = now - timedelta(days=2)
    harness.account.last_login_at = earlier_sign_in
    harness.account.failed_login_attempts = 1

    response = await _password_step(harness, remember=True)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"twoFactorRequired", "challengeToken", "expiresInSeconds"}
    assert body["twoFactorRequired"] is True
    assert body["expiresInSeconds"] == 300
    assert "set-cookie" not in response.headers
    assert harness.account.last_login_at == earlier_sign_in
    # A right password must not reset the count of wrong codes.
    assert harness.account.failed_login_attempts == 1
    assert harness.logs == []

    challenge = body["challengeToken"]
    assert (await harness.client.get("/auth/me", headers=_bearer(challenge))).status_code == 401

    code = _code(key, now, offset=1)
    verified = await harness.client.post(
        "/auth/login/two-factor", json={"challengeToken": challenge, "code": code}
    )

    assert verified.status_code == 200
    session = verified.json()
    assert set(session) == {"token", "user"}
    assert session["user"]["twoFactorEnabled"] is True
    assert decode_access_token(session["token"])["remember"] is True
    assert "tanaw_session=" in verified.headers["set-cookie"]
    assert harness.account.failed_login_attempts == 0
    assert harness.account.previous_login_at == earlier_sign_in
    latest_sign_in = harness.account.last_login_at
    assert latest_sign_in is not None and latest_sign_in > earlier_sign_in
    assert harness.actions() == ["Login"]

    replay = await harness.client.post(
        "/auth/login/two-factor", json={"challengeToken": challenge, "code": code}
    )
    assert replay.status_code == 401
    assert replay.json()["detail"]["code"] == "two_factor_code_invalid"


@pytest.mark.asyncio
async def test_wrong_codes_count_toward_the_sign_in_lockout(harness: AuthHarness) -> None:
    _enable(harness.account, datetime.now(UTC))
    challenge = (await _password_step(harness)).json()["challengeToken"]

    for attempt in range(1, 3):
        response = await harness.client.post(
            "/auth/login/two-factor", json={"challengeToken": challenge, "code": "000000"}
        )
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "two_factor_code_invalid"
        assert harness.account.failed_login_attempts == attempt

    locked = await harness.client.post(
        "/auth/login/two-factor", json={"challengeToken": challenge, "code": "000000"}
    )
    assert locked.status_code == 429
    assert locked.json()["detail"]["retryAfterSeconds"] > 0
    assert int(locked.headers["Retry-After"]) > 0
    assert harness.actions() == ["Account Locked"]
    assert "wrong sign-in codes" in harness.logs[0]["summary"]

    still_locked = await _password_step(harness)
    assert still_locked.status_code == 429


@pytest.mark.asyncio
async def test_a_recovery_code_signs_in_once(harness: AuthHarness) -> None:
    _, recovery_codes = _enable(harness.account, datetime.now(UTC))
    challenge = (await _password_step(harness)).json()["challengeToken"]

    first = await harness.client.post(
        "/auth/login/two-factor",
        json={"challengeToken": challenge, "recoveryCode": recovery_codes[3]},
    )
    assert first.status_code == 200
    assert harness.actions() == ["Recovery Code Used", "Login"]
    assert harness.logs[0]["metadata"] == {"recoveryCodesLeft": 7}

    again = await harness.client.post(
        "/auth/login/two-factor",
        json={"challengeToken": challenge, "recoveryCode": recovery_codes[3]},
    )
    assert again.status_code == 401
    assert "already used" in again.json()["detail"]["message"]


@pytest.mark.asyncio
async def test_second_step_needs_a_live_challenge_and_exactly_one_code(
    harness: AuthHarness,
) -> None:
    now = datetime.now(UTC)
    key, _ = _enable(harness.account, now)
    code = _code(key, now, offset=1)

    garbage = await harness.client.post(
        "/auth/login/two-factor", json={"challengeToken": "not-a-token", "code": code}
    )
    assert garbage.status_code == 401
    assert garbage.json()["detail"]["code"] == "two_factor_challenge_expired"

    challenge = (await _password_step(harness)).json()["challengeToken"]
    both = await harness.client.post(
        "/auth/login/two-factor",
        json={"challengeToken": challenge, "code": code, "recoveryCode": "AAAAA-AAAAA"},
    )
    neither = await harness.client.post(
        "/auth/login/two-factor", json={"challengeToken": challenge}
    )
    assert both.status_code == 422
    assert neither.status_code == 422

    # Signing out everywhere (or a password change) ends a challenge that was already issued.
    harness.account.token_invalid_before = datetime.now(UTC) + timedelta(seconds=1)
    revoked = await harness.client.post(
        "/auth/login/two-factor", json={"challengeToken": challenge, "code": code}
    )
    assert revoked.status_code == 401
    assert revoked.json()["detail"]["code"] == "two_factor_challenge_expired"
    assert harness.account.failed_login_attempts == 0


@pytest.mark.asyncio
async def test_settings_turn_two_factor_on_and_off(harness: AuthHarness) -> None:
    headers = _bearer(create_session_token(harness.account, remember=False))

    setup = await harness.client.post("/auth/two-factor/setup", headers=headers)
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    assert setup.json()["otpauthUri"].startswith("otpauth://totp/TANAW:")

    wrong = await harness.client.post(
        "/auth/two-factor/confirm", headers=headers, json={"code": "000000"}
    )
    assert wrong.status_code == 400
    assert not is_two_factor_enabled(harness.account)

    confirmed = await harness.client.post(
        "/auth/two-factor/confirm",
        headers=headers,
        json={"code": _code(_key(secret), datetime.now(UTC))},
    )
    assert confirmed.status_code == 200
    assert len(confirmed.json()["recoveryCodes"]) == 8
    assert confirmed.json()["user"]["twoFactorEnabled"] is True
    assert harness.actions() == ["Two-Step Verification Turned On"]

    again = await harness.client.post("/auth/two-factor/setup", headers=headers)
    assert again.status_code == 400

    bad_password = await harness.client.post(
        "/auth/two-factor/disable", headers=headers, json={"currentPassword": "wrong password"}
    )
    # 400, not 401: the portal signs out on any 401.
    assert bad_password.status_code == 400
    assert harness.account.failed_login_attempts == 1
    assert is_two_factor_enabled(harness.account)

    disabled = await harness.client.post(
        "/auth/two-factor/disable", headers=headers, json={"currentPassword": PASSWORD}
    )
    assert disabled.status_code == 200
    assert disabled.json()["twoFactorEnabled"] is False
    assert harness.account.totp_secret_seed is None
    assert harness.account.failed_login_attempts == 0
    assert harness.actions()[-1] == "Two-Step Verification Turned Off"


@pytest.mark.asyncio
async def test_enterprise_accounts_cannot_turn_on_two_factor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enterprise = _account(AccountRole.ENTERPRISE)

    async def find_by_id(_db: object, account_id: str, **_: object) -> Account | None:
        return enterprise if account_id == enterprise.id else None

    monkeypatch.setattr(account_dependencies, "get_account_by_id", find_by_id)
    application = FastAPI()
    application.include_router(two_factor_router.router)

    async def test_db() -> AsyncIterator[MagicMock]:
        yield MagicMock()

    application.dependency_overrides[get_db] = test_db
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/two-factor/setup",
            headers=_bearer(create_session_token(enterprise, remember=False)),
        )
    assert response.status_code == 403
    assert enterprise.totp_pending_secret_seed is None


@pytest.mark.asyncio
async def test_signing_out_other_devices_keeps_this_one(harness: AuthHarness) -> None:
    signed_in_at = datetime.now(UTC) - timedelta(hours=3)
    old_token = create_session_token(harness.account, remember=True, signed_in_at=signed_in_at)

    current = await harness.client.get("/auth/sessions/current", headers=_bearer(old_token))
    assert current.status_code == 200
    assert datetime.fromisoformat(current.json()["signedInAt"]) == signed_in_at

    response = await harness.client.post("/auth/sessions/revoke-others", headers=_bearer(old_token))

    assert response.status_code == 200
    fresh_token = response.json()["token"]
    assert fresh_token != old_token
    assert "tanaw_session=" in response.headers["set-cookie"]
    assert harness.account.token_invalid_before is not None
    assert is_token_invalidated(decode_access_token(old_token), harness.account)
    fresh_claims = decode_access_token(fresh_token)
    assert not is_token_invalidated(fresh_claims, harness.account)
    assert fresh_claims["remember"] is True
    assert fresh_claims[SIGNED_IN_AT_CLAIM] == signed_in_at.timestamp()
    assert harness.actions() == ["Other Devices Signed Out"]

    assert (await harness.client.get("/auth/me", headers=_bearer(old_token))).status_code == 401
    assert (await harness.client.get("/auth/me", headers=_bearer(fresh_token))).status_code == 200


@pytest.mark.asyncio
async def test_session_restore_keeps_the_original_sign_in_time(harness: AuthHarness) -> None:
    signed_in_at = datetime.now(UTC) - timedelta(days=1)
    token = create_session_token(harness.account, remember=False, signed_in_at=signed_in_at)

    restored = await harness.client.post("/auth/session", headers=_bearer(token))

    assert restored.status_code == 200
    claims = decode_access_token(restored.json()["token"])
    assert claims[SIGNED_IN_AT_CLAIM] == signed_in_at.timestamp()


def test_two_factor_values_never_appear_in_the_auth_user() -> None:
    account = _account()
    _enable(account, datetime.now(UTC))

    payload = json.dumps(to_auth_user(account).model_dump(mode="json"))

    assert account.totp_secret_seed is not None
    assert account.totp_secret_seed not in payload
    assert "totp" not in payload.lower()
    assert "recovery" not in payload.lower()
