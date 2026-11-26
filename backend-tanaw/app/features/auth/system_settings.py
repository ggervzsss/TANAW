import json
from collections.abc import Mapping
from dataclasses import dataclass

from app.features.accounts.models import SystemConfiguration

SystemSettingValue = str | bool | int

DEFAULT_DATE_FORMAT = "MMM d, yyyy"


@dataclass(frozen=True)
class SystemSettingRule:
    """The values one system setting accepts, and the name people see in Activity."""

    label: str
    allowed_values: tuple[str | int, ...]


# Every key IT can save. Each consumer resolves its own default when a key is missing.
SYSTEM_SETTING_RULES: dict[str, SystemSettingRule] = {
    "security.loginAttemptLimit": SystemSettingRule("Failed sign-in limit", (3, 5, 10)),
    "security.loginLockMinutes": SystemSettingRule("Sign-in lock time", (5, 15, 30, 60)),
    "logs.retentionDays": SystemSettingRule("Keep activity", (90, 180, 365)),
    "display.timeFormat": SystemSettingRule("Time format", ("12-hour", "24-hour")),
    "display.dateFormat": SystemSettingRule(
        "Date format", (DEFAULT_DATE_FORMAT, "d MMM yyyy", "MM/dd/yyyy", "yyyy-MM-dd")
    ),
    "monitoring.cameraWaitMinutes": SystemSettingRule("Camera wait time", (5, 15, 30, 60)),
}


@dataclass(frozen=True)
class SystemSettingChange:
    key: str
    label: str
    previous: SystemSettingValue | None
    value: SystemSettingValue


def load_system_settings_values(
    record: SystemConfiguration | None,
) -> dict[str, SystemSettingValue]:
    if record is None:
        return {}
    try:
        values = json.loads(record.values_json)
    except json.JSONDecodeError:
        return {}
    if not isinstance(values, dict):
        return {}
    return {
        key: value
        for key, value in values.items()
        if isinstance(key, str) and isinstance(value, str | bool | int)
    }


def merge_system_settings_values(
    current: dict[str, SystemSettingValue], patch: dict[str, SystemSettingValue]
) -> dict[str, SystemSettingValue]:
    return {**current, **patch}


def system_settings_patch_errors(patch: Mapping[str, SystemSettingValue]) -> list[str]:
    """List why a settings patch cannot be saved; an empty list means every value is allowed."""
    errors: list[str] = []
    for key, value in patch.items():
        rule = SYSTEM_SETTING_RULES.get(key)
        if rule is None:
            errors.append(f"{key} is not a system setting.")
            continue
        if not _is_allowed_value(value, rule.allowed_values):
            choices = ", ".join(str(choice) for choice in rule.allowed_values)
            errors.append(f"{rule.label} must be one of: {choices}.")
    return errors


def changed_system_settings(
    current: Mapping[str, SystemSettingValue], patch: Mapping[str, SystemSettingValue]
) -> list[SystemSettingChange]:
    return [
        SystemSettingChange(
            key=key,
            label=SYSTEM_SETTING_RULES[key].label if key in SYSTEM_SETTING_RULES else key,
            previous=current.get(key),
            value=value,
        )
        for key, value in patch.items()
        if current.get(key) != value
    ]


def describe_system_settings_change(actor_name: str, changes: list[SystemSettingChange]) -> str:
    if not changes:
        return f"{actor_name} saved system settings without changing them."
    labels = [change.label for change in changes]
    named = labels[0] if len(labels) == 1 else f"{', '.join(labels[:-1])} and {labels[-1]}"
    return f"{actor_name} changed {named}."


def _is_allowed_value(value: object, allowed_values: tuple[str | int, ...]) -> bool:
    if isinstance(value, bool):
        return False
    return any(type(value) is type(choice) and value == choice for choice in allowed_values)
