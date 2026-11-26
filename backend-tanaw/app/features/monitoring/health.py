"""How each enterprise's desktop app and cameras are doing, for IT.

The desktop app counts as online while its last data is under two minutes old, delayed up to
ten minutes, and offline after that or when it reports an error. TANAW only expects data from
an active account while the place is open, so a closed place is never delayed or offline.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.date_time import ensure_aware
from app.core.json_values import parse_json_object
from app.features.accounts.attractions import attraction_category
from app.features.accounts.enterprise import require_enterprise_profile
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.opening_hours import local_time, parse_opening_hours
from app.features.auth.models import AccountActivationToken
from app.features.monitoring.alerts import ALERT_CAMERA
from app.features.monitoring.health_strip import (
    HOLD_SECONDS,
    CameraSample,
    build_camera_day,
    day_window,
    local_day_start,
)
from app.features.monitoring.live_status import Closure, load_current_closures, place_status
from app.features.monitoring.models import EnterpriseTelemetrySnapshot, OperationalAlert
from app.features.monitoring.schemas import (
    CameraDayStrip,
    CameraHealth,
    CameraHealthStatus,
    CameraHourSlot,
    DesktopAppStatus,
    DesktopAppSummary,
    DesktopCameraMonitoringItem,
    DesktopCameraMonitoringSummary,
    EnterpriseAccountState,
    EnterpriseAppHealth,
    EnterpriseCameraHealth,
    EnterpriseHealthSummary,
    EnterpriseHealthToday,
)
from app.features.monitoring.telemetry import OFFLINE_GATEWAY_SECONDS, STALE_GATEWAY_SECONDS

STOPPED_WITH_APP_NOTE = "Stopped with the desktop app."


@dataclass(frozen=True)
class SnapshotFacts:
    """What the newest check-in says about the app and its cameras."""

    received_at: datetime | None
    has_error: bool
    app: DesktopAppSummary | None
    monitoring: DesktopCameraMonitoringSummary


def account_state(
    account: Account, newest_token: AccountActivationToken | None, now: datetime
) -> EnterpriseAccountState:
    if account.status == AccountStatus.INACTIVE:
        return "deactivated"
    if account.activated_at is not None:
        return "active"
    if (
        newest_token is None
        or newest_token.consumed_at is not None
        or newest_token.invalidated_at is not None
        or ensure_aware(newest_token.expires_at) <= now
    ):
        return "expired"
    return "invited"


def app_status(
    last_data_at: datetime | None, *, has_error: bool, expects_data: bool, now: datetime
) -> DesktopAppStatus:
    if last_data_at is None:
        return "not_set_up"
    if not expects_data:
        return "online"
    age = (now - ensure_aware(last_data_at)).total_seconds()
    if has_error or age > OFFLINE_GATEWAY_SECONDS:
        return "offline"
    if age >= STALE_GATEWAY_SECONDS:
        return "delayed"
    return "online"


def _camera_status(camera: DesktopCameraMonitoringItem) -> CameraHealthStatus:
    if camera.status == "error" or camera.error:
        return "not_counting"
    if camera.status == "running":
        return "counting"
    return camera.status


def camera_health(
    monitoring: DesktopCameraMonitoringSummary,
    *,
    last_data_at: datetime | None,
    expects_data: bool,
    now: datetime,
    since_by_camera: Mapping[str, datetime],
) -> list[CameraHealth]:
    """Each camera's state from the newest check-in. Cameras stop with a silent desktop app."""
    silent = (
        last_data_at is not None
        and (now - ensure_aware(last_data_at)).total_seconds() > OFFLINE_GATEWAY_SECONDS
    )
    cameras: list[CameraHealth] = []
    for camera in monitoring.cameras:
        key = str(camera.cameraId)
        status: CameraHealthStatus = "stopped" if silent else _camera_status(camera)
        note = camera.error if status == "not_counting" else None
        if silent:
            note = STOPPED_WITH_APP_NOTE if expects_data else None
        cameras.append(
            CameraHealth(
                id=key,
                name=camera.cameraName,
                mode=camera.mode,
                brand=camera.brand,
                status=status,
                since=last_data_at if silent else since_by_camera.get(key),
                note=note,
            )
        )
    return cameras


def snapshot_facts(snapshot: EnterpriseTelemetrySnapshot | None) -> SnapshotFacts:
    if snapshot is None:
        return SnapshotFacts(None, False, None, DesktopCameraMonitoringSummary())
    payload = parse_json_object(snapshot.payload_json) or {}
    app = payload.get("app")
    monitoring = payload.get("monitoring")
    return SnapshotFacts(
        received_at=snapshot.received_at,
        has_error=bool(snapshot.error) or snapshot.status == "error",
        app=_parse_app(app),
        monitoring=_parse_monitoring(monitoring),
    )


def _parse_app(value: object) -> DesktopAppSummary | None:
    if not isinstance(value, dict):
        return None
    try:
        return DesktopAppSummary.model_validate(value)
    except ValueError:
        return None


def _parse_monitoring(value: object) -> DesktopCameraMonitoringSummary:
    if not isinstance(value, dict):
        return DesktopCameraMonitoringSummary()
    try:
        return DesktopCameraMonitoringSummary.model_validate(value)
    except ValueError:
        return DesktopCameraMonitoringSummary()


def build_health_summary(
    account: Account,
    *,
    snapshot: EnterpriseTelemetrySnapshot | None,
    closures: Sequence[Closure],
    newest_token: AccountActivationToken | None,
    camera_alert_since: Mapping[str, datetime],
    now: datetime,
) -> EnterpriseHealthSummary:
    profile = require_enterprise_profile(account)
    facts = snapshot_facts(snapshot)
    state = account_state(account, newest_token, now)
    live = place_status(profile, closures, [], now)
    hours_known = parse_opening_hours(profile.opening_hours_json) is not None
    closed_today = live.closed_reason is not None and live.closed_reason != "Outside opening hours"
    expects_data = state == "active" and live.open_now
    last_data_at = facts.received_at or profile.last_check_in_at
    cameras = camera_health(
        facts.monitoring,
        last_data_at=last_data_at,
        expects_data=expects_data,
        now=now,
        since_by_camera=camera_alert_since,
    )
    return EnterpriseHealthSummary(
        accountId=account.id,
        enterpriseId=profile.enterprise_id,
        name=profile.enterprise_name,
        barangay=profile.barangay,
        category=attraction_category(profile.attraction_code, profile.attraction_description),
        accountState=state,
        app=EnterpriseAppHealth(
            status=app_status(
                last_data_at, has_error=facts.has_error, expects_data=expects_data, now=now
            ),
            lastDataAt=ensure_aware(last_data_at) if last_data_at is not None else None,
            version=facts.app.version if facts.app else None,
            latestVersion=get_settings().desktop_latest_app_version,
            computerName=facts.app.computerName if facts.app else None,
        ),
        openNow=live.open_now if hours_known or closed_today else None,
        closedReason=live.closed_reason,
        cameras=EnterpriseCameraHealth(
            total=len(cameras),
            counting=sum(1 for camera in cameras if camera.status == "counting"),
            list=cameras,
        ),
    )


def _enterprise_statement() -> Select[tuple[Account]]:
    return (
        select(Account)
        .join(Account.enterprise_profile)
        .where(Account.role == AccountRole.ENTERPRISE)
        .order_by(EnterpriseProfile.enterprise_name.asc(), Account.id.asc())
    )


async def find_enterprise(db: AsyncSession, identifier: str) -> Account | None:
    """An enterprise account by its enterprise ID or its account ID."""
    statement = _enterprise_statement().where(
        or_(EnterpriseProfile.enterprise_id == identifier, Account.id == identifier)
    )
    return (await db.scalars(statement)).first()


async def latest_snapshots(
    db: AsyncSession, account_ids: Sequence[str]
) -> dict[str, EnterpriseTelemetrySnapshot]:
    if not account_ids:
        return {}
    ranked = (
        select(
            EnterpriseTelemetrySnapshot.id.label("snapshot_id"),
            func.row_number()
            .over(
                partition_by=EnterpriseTelemetrySnapshot.enterprise_profile_id,
                order_by=(
                    EnterpriseTelemetrySnapshot.received_at.desc(),
                    EnterpriseTelemetrySnapshot.id.desc(),
                ),
            )
            .label("snapshot_rank"),
        )
        .where(EnterpriseTelemetrySnapshot.enterprise_profile_id.in_(account_ids))
        .subquery()
    )
    snapshots = await db.scalars(
        select(EnterpriseTelemetrySnapshot)
        .join(ranked, EnterpriseTelemetrySnapshot.id == ranked.c.snapshot_id)
        .where(ranked.c.snapshot_rank == 1)
    )
    return {snapshot.enterprise_profile_id: snapshot for snapshot in snapshots}


async def newest_activation_tokens(
    db: AsyncSession, account_ids: Sequence[str]
) -> dict[str, AccountActivationToken]:
    if not account_ids:
        return {}
    tokens = await db.scalars(
        select(AccountActivationToken)
        .where(AccountActivationToken.account_id.in_(account_ids))
        .order_by(AccountActivationToken.created_at.desc(), AccountActivationToken.id.desc())
    )
    newest: dict[str, AccountActivationToken] = {}
    for token in tokens:
        newest.setdefault(token.account_id, token)
    return newest


async def camera_alert_starts(
    db: AsyncSession, account_ids: Sequence[str]
) -> dict[str, dict[str, datetime]]:
    """When each open camera alert began, by enterprise account and camera ID."""
    if not account_ids:
        return {}
    alerts = await db.scalars(
        select(OperationalAlert).where(
            OperationalAlert.alert_type == ALERT_CAMERA,
            OperationalAlert.status.in_({"Pending", "Active"}),
            OperationalAlert.enterprise_profile_id.in_(account_ids),
        )
    )
    starts: dict[str, dict[str, datetime]] = {}
    for alert in alerts:
        if alert.enterprise_profile_id is None or alert.source_id is None:
            continue
        camera_id = alert.source_id.rsplit(":", 1)[-1]
        starts.setdefault(alert.enterprise_profile_id, {})[camera_id] = ensure_aware(
            alert.started_at
        )
    return starts


async def _summaries(
    db: AsyncSession, accounts: Sequence[Account], now: datetime
) -> list[EnterpriseHealthSummary]:
    ids = [account.id for account in accounts]
    snapshots = await latest_snapshots(db, ids)
    closures = await load_current_closures(db, ids, local_time(now).date())
    tokens = await newest_activation_tokens(
        db, [account.id for account in accounts if account.activated_at is None]
    )
    alert_starts = await camera_alert_starts(db, ids)
    return [
        build_health_summary(
            account,
            snapshot=snapshots.get(account.id),
            closures=closures.get(account.id, []),
            newest_token=tokens.get(account.id),
            camera_alert_since=alert_starts.get(account.id, {}),
            now=now,
        )
        for account in accounts
    ]


async def list_enterprise_health(db: AsyncSession, now: datetime) -> list[EnterpriseHealthSummary]:
    accounts = list((await db.scalars(_enterprise_statement())).all())
    return await _summaries(db, accounts, now)


async def get_enterprise_health(
    db: AsyncSession, account: Account, now: datetime
) -> EnterpriseHealthSummary:
    """One enterprise, with each not-counting camera's start filled in from today's check-ins."""
    (summary,) = await _summaries(db, [account], now)
    missing = [
        camera
        for camera in summary.cameras.list
        if camera.status == "not_counting" and camera.since is None
    ]
    if missing:
        _, since = await load_today(db, account, now)
        for camera in missing:
            camera.since = since.get(camera.id)
    return summary


def camera_samples(snapshots: Iterable[tuple[datetime, str | None]]) -> list[CameraSample]:
    """Check-ins that name their cameras, as camera samples sorted by capture time."""
    samples: list[CameraSample] = []
    for captured_at, payload_json in snapshots:
        monitoring = _parse_monitoring((parse_json_object(payload_json) or {}).get("monitoring"))
        if not monitoring.cameras:
            continue
        samples.append(
            CameraSample(
                at=ensure_aware(captured_at),
                counting={
                    str(camera.cameraId): _camera_status(camera) == "counting"
                    for camera in monitoring.cameras
                },
            )
        )
    return sorted(samples, key=lambda sample: sample.at)


async def get_enterprise_health_today(
    db: AsyncSession, account: Account, now: datetime
) -> EnterpriseHealthToday:
    today, _ = await load_today(db, account, now)
    return today


async def load_today(
    db: AsyncSession, account: Account, now: datetime
) -> tuple[EnterpriseHealthToday, dict[str, datetime]]:
    """Today's strip, and since when each camera that is not counting now has not counted."""
    profile = require_enterprise_profile(account)
    today = local_time(now).date()
    day_start = local_day_start(today)
    closures = (await load_current_closures(db, [account.id], today)).get(account.id, [])
    window = day_window(
        parse_opening_hours(profile.opening_hours_json),
        today,
        closed_all_day=any(closure.start <= today <= closure.end for closure in closures),
    )
    rows = [
        (row[0], row[1])
        for row in await db.execute(
            select(
                EnterpriseTelemetrySnapshot.captured_at,
                EnterpriseTelemetrySnapshot.payload_json,
            )
            .where(
                EnterpriseTelemetrySnapshot.enterprise_profile_id == account.id,
                EnterpriseTelemetrySnapshot.captured_at
                >= day_start - timedelta(seconds=HOLD_SECONDS),
                EnterpriseTelemetrySnapshot.captured_at <= now,
            )
            .order_by(EnterpriseTelemetrySnapshot.captured_at.asc())
        )
    ]
    samples = camera_samples(rows)
    strips: list[CameraDayStrip] = []
    since: dict[str, datetime] = {}
    for camera in await _strip_cameras(db, account.id, rows):
        camera_id = str(camera.cameraId)
        day = build_camera_day(camera_id, samples, window, day_start, now)
        if day.not_counting_since is not None:
            since[camera_id] = day.not_counting_since
        strips.append(
            CameraDayStrip(
                id=camera_id,
                name=camera.cameraName,
                mode=camera.mode,
                brand=camera.brand,
                slots=[CameraHourSlot(hour=hour, state=state) for hour, state in day.slots],
                dropCount=day.drop_count,
                note=day.note,
            )
        )
    response = EnterpriseHealthToday(
        date=today,
        openFrom=window.open_from,
        openTo=window.open_to,
        hours=list(window.hours),
        cameras=strips,
    )
    return response, since


async def _strip_cameras(
    db: AsyncSession, account_id: str, rows: Sequence[tuple[datetime, str | None]]
) -> list[DesktopCameraMonitoringItem]:
    """The cameras the place has now: from today's newest check-in that names them."""
    for _, payload_json in reversed(rows):
        monitoring = _parse_monitoring((parse_json_object(payload_json) or {}).get("monitoring"))
        if monitoring.cameras:
            return monitoring.cameras
    snapshot = (await latest_snapshots(db, [account_id])).get(account_id)
    return snapshot_facts(snapshot).monitoring.cameras
