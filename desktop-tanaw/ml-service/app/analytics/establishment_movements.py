"""One establishment-wide Entry / Exit balance for a business day.

Every Entry / Exit camera feeds the same balance: a visitor may enter through one
doorway and leave through another. The balance starts at zero each business day
and never goes below zero, so a missed exit cannot accumulate across days.
"""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

TIMEZONE = ZoneInfo("Asia/Manila")


def daily_movements(
    rows: list[dict[str, Any]],
    business_date: str,
    corrections: list[dict[str, Any]] | None = None,
    until: datetime | None = None,
) -> dict[str, Any]:
    """Count entries and exits, and replay the shared balance in time order.

    ``rows`` are qualified establishment observations for the day. A correction
    sets the balance to its ``new_occupancy`` at ``recorded_at``.
    """
    events: list[tuple[str, int, str, str | None]] = []
    measured = False
    for row in rows:
        if row["analysis_mode"] != "entrance_exit":
            continue
        measured = True
        identity = (
            str(row["visitor_id"])
            if row["visitor_id"] is not None and row["identity_confidence"] == "high"
            else None
        )
        for direction, supported, at in (
            ("entry", row["kind"] == "entry" or row["arrival_observed"], row["first_at"]),
            (
                "exit",
                row["kind"] == "exit" or row["departure_observed"],
                row["ended_at"] or row["last_at"],
            ),
        ):
            if supported and _within(at, business_date, until):
                events.append((at, 0, direction, identity))
    for item in corrections or []:
        if _within(item["recorded_at"], business_date, until):
            events.append((item["recorded_at"], 1, "correction", str(item["new_occupancy"])))

    entries = exits = returns = balance = 0
    departed: set[str] = set()
    for _at, _rank, kind, value in sorted(events, key=lambda item: item[:3]):
        if kind == "correction":
            balance = int(value or 0)
        elif kind == "entry":
            entries += 1
            balance += 1
            if value is not None and value in departed:
                returns += 1
            departed.discard(value or "")
        else:
            exits += 1
            balance = max(0, balance - 1)
            if value is not None:
                departed.add(value)
    return {
        "entries": entries,
        "exits": exits,
        "repeat_entry_count": returns,
        "balance": balance,
        "movement_state": "available" if measured else "unavailable",
    }


def _within(at: str, business_date: str, until: datetime | None) -> bool:
    instant = datetime.fromisoformat(at)
    return (until is None or instant <= until) and instant.astimezone(
        TIMEZONE
    ).date().isoformat() == business_date
