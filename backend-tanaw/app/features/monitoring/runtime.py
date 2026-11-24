"""A once-a-minute check that keeps live alerts and offline places up to date.

Telemetry check-ins handle most changes, but some depend only on time passing:
- a camera problem that has now lasted the camera wait time becomes an Active alert;
- a place whose desktop app went offline has its camera alerts ended, since TANAW no longer
  knows how its cameras are doing (the place shows as offline instead);
- a place that stayed offline for its whole opening day sends IT one informational notice.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime, time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
    SystemConfiguration,
)
from app.features.accounts.opening_hours import (
    first_open_on,
    last_close_on,
    local_time,
    parse_opening_hours,
)
from app.features.auth.system_settings import load_system_settings_values
from app.features.monitoring.alerts import (
    AlertEvent,
    end_camera_alerts_for,
    promote_pending_camera_alerts,
    record_alert_events,
    resolve_camera_wait_minutes,
    utc_now,
)
from app.features.monitoring.live_status import (
    closed_today,
    is_desktop_offline,
    load_current_closures,
)
from app.features.notifications.models import UserNotification
from app.features.notifications.service import create_role_notifications

logger = logging.getLogger("uvicorn.error")
CHECK_INTERVAL_SECONDS = 60
OFFLINE_DAY_SOURCE_TYPE = "enterprise.offline"
_worker_task: asyncio.Task[None] | None = None
_stop_event: asyncio.Event | None = None

SessionFactory = Callable[[], AsyncSession]


async def run_monitoring_check(db: AsyncSession, now: datetime | None = None) -> list[AlertEvent]:
    """One pass of the check. Returns the alert changes it made, for Activity."""
    current = now or utc_now()
    record = await db.scalar(select(SystemConfiguration).where(SystemConfiguration.id == "default"))
    wait = resolve_camera_wait_minutes(load_system_settings_values(record))
    events: list[AlertEvent] = [
        ("started", alert)
        for alert in await promote_pending_camera_alerts(db, now=current, wait_minutes=wait)
    ]

    accounts = list(
        (
            await db.scalars(
                select(Account)
                .join(Account.enterprise_profile)
                .where(
                    Account.role == AccountRole.ENTERPRISE,
                    Account.status == AccountStatus.ACTIVE,
                    Account.activated_at.is_not(None),
                )
            )
        ).all()
    )
    closures = await load_current_closures(
        db, [account.id for account in accounts], local_time(current).date()
    )
    for account in accounts:
        profile = account.enterprise_profile
        if profile is None or not is_desktop_offline(profile.last_check_in_at, current):
            continue
        events += await end_camera_alerts_for(db, account.id, now=current)
        if not closed_today(closures.get(account.id, []), current):
            await notify_offline_whole_day(db, profile, current)
    await record_alert_events(db, events)
    return events


async def notify_offline_whole_day(
    db: AsyncSession, profile: EnterpriseProfile, now: datetime
) -> None:
    hours = parse_opening_hours(profile.opening_hours_json)
    opens = first_open_on(hours, now)
    closes = last_close_on(hours, now)
    if opens is None or closes is None:
        return
    local_now = local_time(now)
    if local_now.time() < closes and closes != time.max:
        return
    opened_at = local_now.replace(hour=opens.hour, minute=opens.minute, second=0, microsecond=0)
    last = profile.last_check_in_at
    if last is not None and local_time(last) >= opened_at:
        return
    source_id = f"{profile.account_id}:{local_now.date().isoformat()}"
    already_sent = await db.scalar(
        select(UserNotification.id).where(
            UserNotification.source_type == OFFLINE_DAY_SOURCE_TYPE,
            UserNotification.source_id == source_id,
        )
    )
    if already_sent is not None:
        return
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.IT],
        title=f"{profile.enterprise_name} was offline all day.",
        message=(
            f"TANAW heard nothing from {profile.enterprise_name}'s desktop app during its "
            "opening hours today. You may want to check in with them."
        ),
        notification_type="Desktop App Offline",
        severity="Info",
        actor=None,
        source_type=OFFLINE_DAY_SOURCE_TYPE,
        source_id=source_id,
    )


async def _worker_loop(stop_event: asyncio.Event, session_factory: SessionFactory) -> None:
    while not stop_event.is_set():
        try:
            async with session_factory() as db:
                await run_monitoring_check(db)
                await db.commit()
        except Exception:
            logger.exception("Monitoring check failed.")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=CHECK_INTERVAL_SECONDS)
        except TimeoutError:
            pass


async def start_monitoring_worker(session_factory: SessionFactory = AsyncSessionLocal) -> None:
    global _stop_event, _worker_task
    await stop_monitoring_worker()
    _stop_event = asyncio.Event()
    _worker_task = asyncio.create_task(
        _worker_loop(_stop_event, session_factory), name="tanaw-monitoring-check"
    )


async def stop_monitoring_worker() -> None:
    global _stop_event, _worker_task
    stop_event, task = _stop_event, _worker_task
    _stop_event = None
    _worker_task = None
    if stop_event is not None:
        stop_event.set()
    if task is not None:
        await task
