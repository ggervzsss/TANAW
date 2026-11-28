"""Time-based one-time passwords (RFC 6238) and recovery codes, using the standard library only.

Authenticator apps (Google Authenticator, Microsoft Authenticator, 1Password and others) all read
the same ``otpauth://totp`` link: an HMAC-SHA1 key, a 30-second step and six digits.
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import quote, urlencode

TOTP_DIGITS = 6
TOTP_PERIOD_SECONDS = 30
TOTP_KEY_BYTES = 20
# Accept the code before and after the current one, so a phone clock a little off still works.
TOTP_ALLOWED_DRIFT_STEPS = 1
TOTP_ISSUER = "TANAW"

RECOVERY_CODE_COUNT = 8
RECOVERY_CODE_LENGTH = 10
# No 0/O or 1/I, so a code read off paper is typed correctly.
RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

DigestFactory = Callable[..., Any]


def hotp(
    key: bytes,
    counter: int,
    *,
    digits: int = TOTP_DIGITS,
    digest: DigestFactory = hashlib.sha1,
) -> str:
    """RFC 4226 HOTP: the dynamic truncation of HMAC(key, counter)."""
    mac = hmac.new(key, struct.pack(">Q", counter), digest).digest()
    offset = mac[-1] & 0x0F
    binary = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{binary % (10**digits):0{digits}d}"


def totp_time_step(at: float | None = None, *, period: int = TOTP_PERIOD_SECONDS) -> int:
    return int((time.time() if at is None else at) // period)


def totp(
    key: bytes,
    at: float | None = None,
    *,
    digits: int = TOTP_DIGITS,
    period: int = TOTP_PERIOD_SECONDS,
    digest: DigestFactory = hashlib.sha1,
) -> str:
    """RFC 6238 TOTP: HOTP over the number of whole periods since the Unix epoch."""
    return hotp(key, totp_time_step(at, period=period), digits=digits, digest=digest)


def normalize_totp_code(value: str) -> str | None:
    """The six digits of a code as typed, allowing spaces or a dash between groups."""
    digits = "".join(character for character in value if character not in " -")
    if len(digits) != TOTP_DIGITS or not digits.isascii() or not digits.isdigit():
        return None
    return digits


def match_totp_step(
    key: bytes,
    code: str,
    *,
    at: float | None = None,
    after_step: int | None = None,
    drift_steps: int = TOTP_ALLOWED_DRIFT_STEPS,
) -> int | None:
    """The time step ``code`` belongs to, within the allowed drift, or None when it matches none.

    Steps at or before ``after_step`` are refused, so a code that was already used cannot be used
    again (RFC 6238, section 5.2).
    """
    normalized = normalize_totp_code(code)
    if normalized is None:
        return None
    current = totp_time_step(at)
    matched: int | None = None
    for step in range(current - drift_steps, current + drift_steps + 1):
        if after_step is not None and step <= after_step:
            continue
        # Compare every candidate so the time taken does not depend on which one matched.
        if hmac.compare_digest(hotp(key, step), normalized) and matched is None:
            matched = step
    return matched


def encode_totp_key(key: bytes) -> str:
    """The base32 key an authenticator app accepts, without padding."""
    return base64.b32encode(key).decode("ascii").rstrip("=")


def totp_provisioning_uri(secret: str, account_name: str, *, issuer: str = TOTP_ISSUER) -> str:
    """The ``otpauth://totp`` link an authenticator app reads from a QR code or a tap."""
    label = f"{quote(issuer, safe='')}:{quote(account_name, safe='@')}"
    query = urlencode(
        {
            "secret": secret,
            "issuer": issuer,
            "algorithm": "SHA1",
            "digits": TOTP_DIGITS,
            "period": TOTP_PERIOD_SECONDS,
        }
    )
    return f"otpauth://totp/{label}?{query}"


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """One-time codes shown once, formatted ``XXXXX-XXXXX`` for reading and typing."""
    codes: set[str] = set()
    while len(codes) < count:
        raw = "".join(secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(RECOVERY_CODE_LENGTH))
        codes.add(f"{raw[:5]}-{raw[5:]}")
    return sorted(codes)


def normalize_recovery_code(value: str) -> str | None:
    """A recovery code as stored for hashing: upper case, without spaces or dashes."""
    compact = "".join(character for character in value.upper() if character not in " -")
    if len(compact) != RECOVERY_CODE_LENGTH or any(
        character not in RECOVERY_CODE_ALPHABET for character in compact
    ):
        return None
    return compact
