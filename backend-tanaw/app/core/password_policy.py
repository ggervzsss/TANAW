import json
import unicodedata
from pathlib import Path
from typing import cast


def _load_password_policy_data() -> dict[str, object]:
    raw_data = json.loads(
        Path(__file__).with_name("common_passwords.json").read_text(encoding="utf-8")
    )
    if not isinstance(raw_data, dict):
        raise RuntimeError("The password policy data must be an object.")
    return cast(dict[str, object], raw_data)


def _required_int(data: dict[str, object], key: str) -> int:
    value = data.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise RuntimeError(f"The password policy value {key!r} is invalid.")
    return value


def _required_string(data: dict[str, object], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"The password policy value {key!r} is invalid.")
    return value


def _required_strings(data: dict[str, object], key: str) -> tuple[str, ...]:
    values = data.get(key)
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        raise RuntimeError(f"The password policy values {key!r} are invalid.")
    return tuple(cast(list[str], values))


_PASSWORD_POLICY_DATA = _load_password_policy_data()
PASSWORD_MIN_LENGTH = _required_int(_PASSWORD_POLICY_DATA, "minimumLength")
PASSWORD_MAX_LENGTH = _required_int(_PASSWORD_POLICY_DATA, "maximumLength")
PASSWORD_TOO_SHORT_MESSAGE = _required_string(_PASSWORD_POLICY_DATA, "tooShortMessage")
PASSWORD_TOO_LONG_MESSAGE = _required_string(_PASSWORD_POLICY_DATA, "tooLongMessage")
PASSWORD_COMMON_MESSAGE = _required_string(_PASSWORD_POLICY_DATA, "commonMessage")
_COMMON_PASSWORD_STEMS = _required_strings(_PASSWORD_POLICY_DATA, "stems")
_COMMON_PASSWORD_EXACT = _required_strings(_PASSWORD_POLICY_DATA, "exact")
_COMMON_PASSWORD_SUFFIXES = _required_strings(_PASSWORD_POLICY_DATA, "suffixes")
_COMMON_PASSWORD_SEPARATORS = _required_strings(_PASSWORD_POLICY_DATA, "separators")


def normalize_password(value: str) -> str:
    return unicodedata.normalize("NFC", value)


def validate_password_policy(value: str) -> str:
    normalized = normalize_password(value)
    length = len(normalized)
    if length < PASSWORD_MIN_LENGTH:
        raise ValueError(PASSWORD_TOO_SHORT_MESSAGE)
    if length > PASSWORD_MAX_LENGTH:
        raise ValueError(PASSWORD_TOO_LONG_MESSAGE)
    if is_common_password(normalized):
        raise ValueError(PASSWORD_COMMON_MESSAGE)
    return normalized


def is_common_password(value: str) -> bool:
    normalized = normalize_password(value).casefold()
    return not normalized.strip() or normalized in COMMON_PASSWORD_BLOCKLIST


def _build_common_password_blocklist() -> frozenset[str]:
    candidates = {normalize_password(value).casefold() for value in _COMMON_PASSWORD_EXACT}
    for stem_value in _COMMON_PASSWORD_STEMS:
        stem = normalize_password(stem_value).casefold()
        for repeat_count in range(2, 5):
            for separator in _COMMON_PASSWORD_SEPARATORS:
                candidate = separator.join(stem for _ in range(repeat_count))
                if PASSWORD_MIN_LENGTH <= len(candidate) <= PASSWORD_MAX_LENGTH:
                    candidates.add(candidate)
        for suffix in _COMMON_PASSWORD_SUFFIXES:
            candidate = f"{stem}{suffix}"
            if PASSWORD_MIN_LENGTH <= len(candidate) <= PASSWORD_MAX_LENGTH:
                candidates.add(candidate)
    return frozenset(candidates)


COMMON_PASSWORD_BLOCKLIST = _build_common_password_blocklist()
