import json


def parse_json_object(value: str | None) -> dict | None:
    """Parse a persisted JSON object without leaking decode errors to callers."""
    if not value:
        return None
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None
