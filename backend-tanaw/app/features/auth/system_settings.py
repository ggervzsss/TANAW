import json

from app.features.accounts.models import SystemConfiguration


def load_system_settings_values(
    record: SystemConfiguration | None,
) -> dict[str, str | bool | int]:
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
