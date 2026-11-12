"""Validate and retain the desktop's frozen establishment counting snapshot."""

import hashlib
import json
from collections.abc import Iterable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.features.reporting.periods import reporting_period_key

COUNTING_BASIS = "sum_of_daily_establishment_unique_visitors"


def snapshot_digest(value: dict[str, Any]) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, dict):
            return {key: normalize(part) for key, part in item.items() if key != "snapshot_version"}
        if isinstance(item, list):
            return [normalize(part) for part in item]
        if isinstance(item, float) and item.is_integer():
            return int(item)
        return item

    return hashlib.sha256(
        json.dumps(
            normalize(value), sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
    ).hexdigest()


def counting_metrics(
    snapshot: object, period: str
) -> tuple[int | None, int | None, int | None, int]:
    if not isinstance(snapshot, dict):
        raise ValueError("An establishment counting snapshot is required.")
    if (
        snapshot.get("counting_basis") != COUNTING_BASIS
        or snapshot.get("policy_version") != 1
        or snapshot.get("timezone") != "Asia/Manila"
        or not isinstance(snapshot.get("enterprise_id"), str)
        or not snapshot["enterprise_id"]
        or snapshot.get("snapshot_version") != snapshot_digest(snapshot)
    ):
        raise ValueError("The establishment counting snapshot is invalid or has changed.")
    try:
        begin = datetime.fromisoformat(snapshot["from_at"])
        end = datetime.fromisoformat(snapshot["to_at"])
        if begin.tzinfo is None or end.tzinfo is None:
            raise ValueError
        begin = begin.astimezone(ZoneInfo("Asia/Manila"))
        end = end.astimezone(ZoneInfo("Asia/Manila"))
        next_month = (begin.year + (begin.month == 12), 1 if begin.month == 12 else begin.month + 1)
        if (
            reporting_period_key(period) != begin.strftime("%Y-%m")
            or begin.day != 1
            or end.day != 1
            or (end.year, end.month) != next_month
            or any(
                (value.hour, value.minute, value.second, value.microsecond) != (0, 0, 0, 0)
                for value in (begin, end)
            )
        ):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(
            "The counting snapshot must cover the submitted Manila calendar month."
        ) from exc
    if snapshot.get("reconciliation_state") not in {"estimated", "partial"} or snapshot.get(
        "identification_state"
    ) not in {"available", "partial"}:
        raise ValueError("A collected establishment visitor estimate is required.")
    if snapshot.get("movement_state") not in {"available", "partial", "unavailable"}:
        raise ValueError("The movement measurement state is invalid.")
    for key in ("entries", "exits", "unique_count", "unresolved_observations"):
        value = snapshot.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError("Snapshot counts must be non-negative whole numbers.")
    peak = snapshot.get("peak_occupancy")
    if peak is not None and (isinstance(peak, bool) or not isinstance(peak, int) or peak < 0):
        raise ValueError("Peak occupancy must be measured or explicitly unavailable.")
    movement = snapshot["movement_state"] != "unavailable"
    return (
        snapshot["entries"] if movement else None,
        snapshot["exits"] if movement else None,
        peak,
        snapshot["unique_count"],
    )


def complete_sum(values: Iterable[int | None]) -> int | None:
    """An incomplete citywide movement total must not look like a measured zero."""
    items = list(values)
    return (
        None
        if any(item is None for item in items)
        else sum(item for item in items if item is not None)
    )
