from datetime import UTC, datetime
from zoneinfo import ZoneInfo

PHILIPPINE_TIME_ZONE = ZoneInfo("Asia/Manila")
PHILIPPINE_TIME_LABEL = "Philippine Time"


def ensure_aware(value: datetime) -> datetime:
    """Return a timezone-aware instant, interpreting naive values as UTC."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def format_philippine_datetime(value: datetime) -> str:
    """Format an instant for user-facing TANAW messages."""
    aware_value = ensure_aware(value)
    local_value = aware_value.astimezone(PHILIPPINE_TIME_ZONE)
    hour = local_value.hour % 12 or 12
    meridiem = "AM" if local_value.hour < 12 else "PM"
    return (
        f"{local_value.strftime('%b')} {local_value.day}, {local_value.year} "
        f"at {hour}:{local_value.minute:02d} {meridiem} {PHILIPPINE_TIME_LABEL}"
    )
