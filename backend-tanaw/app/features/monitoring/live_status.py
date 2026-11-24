"""What each place's map pin shows right now.

Only one state shows at a time. Offline wins, because TANAW has no fresh counts from an
offline place; otherwise a camera that is not counting wins over busier than usual, because
it makes the visitor count incomplete. A place outside its opening hours, or temporarily
closed, is never offline: its pin is faded instead.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import ensure_aware
from app.features.accounts.models import EnterpriseClosure, EnterpriseProfile
from app.features.accounts.opening_hours import (
    is_closed_on,
    is_open_now,
    local_time,
    parse_opening_hours,
)
from app.features.monitoring.alerts import ALERT_BUSY, ALERT_CAMERA
from app.features.monitoring.models import OperationalAlert
from app.features.monitoring.schemas import MapPinState

OFFLINE_AFTER = timedelta(minutes=10)


@dataclass(frozen=True)
class Closure:
    start: date
    end: date
    reason: str | None


@dataclass(frozen=True)
class PlaceStatus:
    pin_state: MapPinState
    open_now: bool
    offline_since: datetime | None
    closed_reason: str | None


async def load_current_closures(
    db: AsyncSession, profile_ids: Sequence[str], today: date
) -> dict[str, list[Closure]]:
    if not profile_ids:
        return {}
    rows = await db.scalars(
        select(EnterpriseClosure).where(
            EnterpriseClosure.enterprise_profile_id.in_(profile_ids),
            EnterpriseClosure.end_date >= today,
        )
    )
    closures: dict[str, list[Closure]] = {}
    for row in rows:
        closures.setdefault(row.enterprise_profile_id, []).append(
            Closure(row.start_date, row.end_date, row.reason)
        )
    return closures


def is_desktop_offline(last_check_in_at: datetime | None, now: datetime) -> bool:
    return last_check_in_at is None or ensure_aware(last_check_in_at) + OFFLINE_AFTER <= now


def place_status(
    profile: EnterpriseProfile,
    closures: Sequence[Closure],
    alerts: Sequence[OperationalAlert],
    now: datetime,
) -> PlaceStatus:
    hours = parse_opening_hours(profile.opening_hours_json)
    spans = [(closure.start, closure.end) for closure in closures]
    open_now = is_open_now(hours, spans, now)
    today = local_time(now).date()
    closure_today = next((c for c in closures if c.start <= today <= c.end), None)
    closed_reason = None
    if closure_today is not None:
        closed_reason = closure_today.reason or "Temporarily closed"
    elif not open_now:
        closed_reason = "Outside opening hours"

    offline = open_now and is_desktop_offline(profile.last_check_in_at, now)
    alert_types = {alert.alert_type for alert in alerts}
    state: MapPinState
    if offline:
        state = "offline"
    elif ALERT_CAMERA in alert_types:
        state = "camera"
    elif ALERT_BUSY in alert_types:
        state = "busy"
    elif not open_now:
        state = "closed"
    else:
        state = "normal"
    return PlaceStatus(
        pin_state=state,
        open_now=open_now,
        offline_since=ensure_aware(profile.last_check_in_at)
        if offline and profile.last_check_in_at is not None
        else None,
        closed_reason=closed_reason,
    )


def closed_today(closures: Sequence[Closure], now: datetime) -> bool:
    return is_closed_on([(c.start, c.end) for c in closures], local_time(now).date())
