import base64
import hashlib
from urllib.parse import parse_qs, urlsplit

import pytest

from app.features.auth.totp import (
    RECOVERY_CODE_ALPHABET,
    RECOVERY_CODE_COUNT,
    encode_totp_key,
    generate_recovery_codes,
    hotp,
    match_totp_step,
    normalize_recovery_code,
    normalize_totp_code,
    totp,
    totp_provisioning_uri,
    totp_time_step,
)

# RFC 6238, appendix B: the seeds are ASCII "1234567890" repeated to each hash's block size.
RFC_SEED_SHA1 = b"12345678901234567890"
RFC_SEED_SHA256 = b"12345678901234567890123456789012"
RFC_SEED_SHA512 = b"1234567890123456789012345678901234567890123456789012345678901234"


@pytest.mark.parametrize(
    ("at", "sha1", "sha256", "sha512"),
    (
        (59, "94287082", "46119246", "90693936"),
        (1111111109, "07081804", "68084774", "25091201"),
        (1111111111, "14050471", "67062674", "99943326"),
        (1234567890, "89005924", "91819424", "93441116"),
        (2000000000, "69279037", "90698825", "38618901"),
        (20000000000, "65353130", "77737706", "47863826"),
    ),
)
def test_totp_matches_the_rfc_6238_test_vectors(
    at: int, sha1: str, sha256: str, sha512: str
) -> None:
    assert totp(RFC_SEED_SHA1, at, digits=8, digest=hashlib.sha1) == sha1
    assert totp(RFC_SEED_SHA256, at, digits=8, digest=hashlib.sha256) == sha256
    assert totp(RFC_SEED_SHA512, at, digits=8, digest=hashlib.sha512) == sha512


def test_hotp_matches_the_rfc_4226_test_vectors() -> None:
    expected = [
        "755224",
        "287082",
        "359152",
        "969429",
        "338314",
        "254676",
        "287922",
        "162583",
        "399871",
        "520489",
    ]
    assert [hotp(RFC_SEED_SHA1, counter) for counter in range(10)] == expected


def test_authenticator_codes_are_six_digits_on_a_thirty_second_step() -> None:
    assert totp_time_step(59) == 1
    assert totp_time_step(60) == 2
    assert totp(RFC_SEED_SHA1, 59) == "287082"
    assert totp(RFC_SEED_SHA1, 59) == hotp(RFC_SEED_SHA1, 1)


def test_a_code_is_accepted_one_step_either_side_of_now() -> None:
    now = 1_800_000_000.0
    current = totp_time_step(now)

    for offset in (-1, 0, 1):
        code = hotp(RFC_SEED_SHA1, current + offset)
        assert match_totp_step(RFC_SEED_SHA1, code, at=now) == current + offset

    for offset in (-2, 2):
        code = hotp(RFC_SEED_SHA1, current + offset)
        assert match_totp_step(RFC_SEED_SHA1, code, at=now) is None


def test_a_used_code_and_older_codes_are_refused() -> None:
    now = 1_800_000_000.0
    current = totp_time_step(now)
    code = hotp(RFC_SEED_SHA1, current)

    assert match_totp_step(RFC_SEED_SHA1, code, at=now, after_step=current) is None
    assert (
        match_totp_step(
            RFC_SEED_SHA1, hotp(RFC_SEED_SHA1, current - 1), at=now, after_step=current - 1
        )
        is None
    )
    assert match_totp_step(RFC_SEED_SHA1, code, at=now, after_step=current - 1) == current


@pytest.mark.parametrize(
    ("typed", "expected"),
    (
        ("123456", "123456"),
        (" 123 456 ", "123456"),
        ("123-456", "123456"),
        ("12345", None),
        ("1234567", None),
        ("12a456", None),
        ("١٢٣٤٥٦", None),
        ("", None),
    ),
)
def test_typed_codes_are_normalized_to_six_ascii_digits(typed: str, expected: str | None) -> None:
    assert normalize_totp_code(typed) == expected


def test_the_key_and_link_are_what_authenticator_apps_read() -> None:
    secret = encode_totp_key(RFC_SEED_SHA1)
    assert secret == "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert "=" not in encode_totp_key(b"\x00" * 21)
    assert base64.b32decode(secret) == RFC_SEED_SHA1

    uri = totp_provisioning_uri(secret, "staff.member@example.com")
    parts = urlsplit(uri)
    assert parts.scheme == "otpauth"
    assert parts.netloc == "totp"
    assert parts.path == "/TANAW:staff.member@example.com"
    assert parse_qs(parts.query) == {
        "secret": [secret],
        "issuer": ["TANAW"],
        "algorithm": ["SHA1"],
        "digits": ["6"],
        "period": ["30"],
    }


def test_recovery_codes_are_distinct_readable_and_normalize_for_hashing() -> None:
    codes = generate_recovery_codes()

    assert len(codes) == RECOVERY_CODE_COUNT
    assert len(set(codes)) == RECOVERY_CODE_COUNT
    for code in codes:
        assert len(code) == 11 and code[5] == "-"
        assert set(code.replace("-", "")) <= set(RECOVERY_CODE_ALPHABET)
        compact = code.replace("-", "")
        assert normalize_recovery_code(code) == compact
        assert normalize_recovery_code(f" {code.lower()} ") == compact
        assert normalize_recovery_code(compact) == compact

    assert normalize_recovery_code("ABCDE-FGHI") is None
    assert normalize_recovery_code("ABCDE-FGH10") is None
    assert normalize_recovery_code("") is None
