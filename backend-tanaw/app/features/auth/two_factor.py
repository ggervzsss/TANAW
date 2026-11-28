"""Two-step verification with an authenticator app for LGU accounts (Admin, IT and Staff).

Enterprise accounts sign in on the desktop app and never use it. Turning it on is two steps: the
server keeps a pending key until the owner proves their app produces its codes, then makes it the
account's key and hands out recovery codes once. While it is on, a correct password only earns a
short-lived sign-in challenge; the session comes after a code from the app or a recovery code.
"""

import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import get_settings
from app.features.accounts.models import Account, AccountRole
from app.features.auth.secret_values import derive_two_factor_key, hash_two_factor_recovery_code
from app.features.auth.totp import (
    encode_totp_key,
    generate_recovery_codes,
    match_totp_step,
    normalize_recovery_code,
    totp_provisioning_uri,
)

TWO_FACTOR_ROLES = frozenset({AccountRole.ADMIN, AccountRole.IT, AccountRole.STAFF})
TWO_FACTOR_CHALLENGE_SECONDS = 5 * 60
_CHALLENGE_PURPOSE = "tanaw-two-factor-sign-in"
_CHALLENGE_ALGORITHM = "HS256"


class TwoFactorError(Exception):
    """A two-step verification change that cannot be made, with a message for the owner."""


@dataclass(frozen=True)
class TwoFactorSetup:
    secret: str
    otpauth_uri: str


@dataclass(frozen=True)
class TwoFactorChallenge:
    account_id: str
    remember: bool
    issued_at: datetime


def can_use_two_factor(account: Account) -> bool:
    return account.role in TWO_FACTOR_ROLES


def is_two_factor_enabled(account: Account) -> bool:
    return (
        can_use_two_factor(account)
        and account.totp_enabled_at is not None
        and account.totp_secret_seed is not None
    )


def start_two_factor_setup(account: Account) -> TwoFactorSetup:
    """Give the account a new pending key; it is used only after a code from it is confirmed."""
    if not can_use_two_factor(account):
        raise TwoFactorError("Two-step verification is not available for this account.")
    if is_two_factor_enabled(account):
        raise TwoFactorError("Two-step verification is already on.")
    seed = secrets.token_urlsafe(32)
    account.totp_pending_secret_seed = seed
    secret = encode_totp_key(derive_two_factor_key(seed))
    return TwoFactorSetup(secret=secret, otpauth_uri=totp_provisioning_uri(secret, account.email))


def confirm_two_factor_setup(account: Account, code: str, *, now: datetime) -> list[str]:
    """Turn two-step verification on when ``code`` comes from the pending key.

    Returns the recovery codes, which are shown this once and stored only as keyed hashes.
    """
    if is_two_factor_enabled(account):
        raise TwoFactorError("Two-step verification is already on.")
    seed = account.totp_pending_secret_seed
    if seed is None:
        raise TwoFactorError("Start the setup again to get a new key.")
    step = match_totp_step(derive_two_factor_key(seed), code, at=now.timestamp())
    if step is None:
        raise TwoFactorError(
            "That code did not match. Check the time on your phone and enter the newest code."
        )
    account.totp_secret_seed = seed
    account.totp_pending_secret_seed = None
    account.totp_enabled_at = now
    account.totp_last_used_step = step
    recovery_codes = generate_recovery_codes()
    account.totp_recovery_code_hashes = json.dumps(
        [_recovery_code_hash(account, code) for code in recovery_codes]
    )
    return recovery_codes


def disable_two_factor(account: Account) -> None:
    account.totp_secret_seed = None
    account.totp_pending_secret_seed = None
    account.totp_enabled_at = None
    account.totp_last_used_step = None
    account.totp_recovery_code_hashes = None


def verify_two_factor_code(account: Account, code: str, *, now: datetime) -> bool:
    """Accept a current code from the authenticator app once; a used code is refused."""
    if not is_two_factor_enabled(account) or account.totp_secret_seed is None:
        return False
    step = match_totp_step(
        derive_two_factor_key(account.totp_secret_seed),
        code,
        at=now.timestamp(),
        after_step=account.totp_last_used_step,
    )
    if step is None:
        return False
    account.totp_last_used_step = step
    return True


def consume_recovery_code(account: Account, code: str) -> bool:
    """Accept an unused recovery code and strike it off, so it never works again."""
    if not is_two_factor_enabled(account):
        return False
    normalized = normalize_recovery_code(code)
    stored = recovery_code_hashes(account)
    if normalized is None or not stored:
        return False
    candidate = hash_two_factor_recovery_code(account.id, normalized)
    matched: str | None = None
    for stored_hash in stored:
        if hmac.compare_digest(stored_hash, candidate) and matched is None:
            matched = stored_hash
    if matched is None:
        return False
    account.totp_recovery_code_hashes = json.dumps(
        [stored_hash for stored_hash in stored if stored_hash != matched]
    )
    return True


def recovery_code_hashes(account: Account) -> list[str]:
    try:
        values = json.loads(account.totp_recovery_code_hashes or "[]")
    except json.JSONDecodeError:
        return []
    return [value for value in values if isinstance(value, str)] if isinstance(values, list) else []


def create_two_factor_challenge(account: Account, *, remember: bool, now: datetime) -> str:
    """A signed, short-lived proof that the password step passed.

    It is signed with a key derived for this purpose only, and carries no ``sub`` claim, so it can
    never be accepted as a session token.
    """
    payload = {
        "purpose": _CHALLENGE_PURPOSE,
        "aid": account.id,
        "remember": remember,
        "iat": now.timestamp(),
        "exp": now + timedelta(seconds=TWO_FACTOR_CHALLENGE_SECONDS),
        "jti": secrets.token_urlsafe(12),
    }
    return jwt.encode(payload, _challenge_signing_key(), algorithm=_CHALLENGE_ALGORITHM)


def read_two_factor_challenge(token: str) -> TwoFactorChallenge | None:
    try:
        payload = jwt.decode(
            token,
            _challenge_signing_key(),
            algorithms=[_CHALLENGE_ALGORITHM],
            options={"require": ["exp", "iat"]},
        )
    except jwt.PyJWTError:
        return None
    account_id = payload.get("aid")
    issued_at = payload.get("iat")
    if (
        payload.get("purpose") != _CHALLENGE_PURPOSE
        or not isinstance(account_id, str)
        or not isinstance(issued_at, int | float)
    ):
        return None
    return TwoFactorChallenge(
        account_id=account_id,
        remember=payload.get("remember") is True,
        issued_at=datetime.fromtimestamp(issued_at, UTC),
    )


def is_challenge_still_valid(challenge: TwoFactorChallenge, account: Account) -> bool:
    """A challenge dies with the sessions: a password change or sign-out everywhere ends it."""
    if not is_two_factor_enabled(account):
        return False
    invalid_before = account.token_invalid_before
    if invalid_before is None:
        return True
    if invalid_before.tzinfo is None:
        invalid_before = invalid_before.replace(tzinfo=UTC)
    return challenge.issued_at > invalid_before


def _recovery_code_hash(account: Account, code: str) -> str:
    normalized = normalize_recovery_code(code)
    if normalized is None:
        raise ValueError("Generated recovery codes must be valid.")
    return hash_two_factor_recovery_code(account.id, normalized)


def _challenge_signing_key() -> str:
    return hmac.new(
        get_settings().jwt_secret_key.encode(),
        b"tanaw-two-factor-sign-in-challenge",
        hashlib.sha256,
    ).hexdigest()
