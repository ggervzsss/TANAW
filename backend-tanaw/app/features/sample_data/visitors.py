import json
import random
from datetime import UTC, datetime, timedelta
from math import ceil
from statistics import fmean

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import PHILIPPINE_TIME_ZONE, ensure_aware
from app.features.accounts.models import Account
from app.features.monitoring.models import EnterpriseTelemetrySnapshot
from app.features.sample_data.dataset import (
    SAMPLE_CAMERA_PREFIX,
)
from app.features.sample_data.definitions import (
    AdminVisitorScenario,
)
from app.features.sample_data.helpers import (
    sample_uuid,
)

# Camera locations shown on Enterprise Details; each enterprise has the first two or three.
SAMPLE_CAMERA_LOCATIONS = ("Main Entrance", "Side Entrance", "Parking Area")
# How each location's camera counts, and its brand, as the desktop's camera settings name them.
SAMPLE_CAMERA_SETUP = (
    ("entrance_exit", "tapo"),
    ("entrance_exit", "dahua"),
    ("open_space", "tenda"),
)
# The desktop app build and computer each enterprise (by position) checks in from; one place
# still runs an older version.
SAMPLE_LATEST_APP_VERSION = "0.1.3"
SAMPLE_OLDER_APP_VERSION = "0.1.2"
OLDER_APP_ENTERPRISE_INDEX = 4
SAMPLE_COMPUTER_NAMES = ("FRONT-DESK-PC", "OFFICE-PC", "TICKET-BOOTH", "ADMIN-LAPTOP")
# A place whose desktop app went quiet this long before generation shows as offline.
SAMPLE_SILENT_AFTER = timedelta(minutes=10)
# The enterprise (by position, the target first) whose main entrance camera stops reporting shortly
# before generation, so the portals show "1 camera not reporting" next to the IT alert about it.
PARTIAL_CAMERA_ENTERPRISE_INDEX = 3
PARTIAL_CAMERA_OUTAGE = timedelta(minutes=50)


def participating_enterprises(target: Account, generated: list[Account]) -> list[Account]:
    """Every sample place, the target first: the positions the indexes above refer to."""
    return list({enterprise.id: enterprise for enterprise in [target, *generated]}.values())


async def create_admin_visitor_history(
    db: AsyncSession,
    range_end: datetime,
    scenario: str,
    rng: random.Random,
    enterprises: list[Account],
    target: Account,
) -> AdminVisitorScenario:
    local_now = range_end.astimezone(PHILIPPINE_TIME_ZONE)
    first_day = (local_now - timedelta(days=34)).replace(hour=0, minute=0, second=0, microsecond=0)
    hours = sorted({8, 10, 12, 14, 16, 18, 20, local_now.hour})
    telemetry: list[EnterpriseTelemetrySnapshot] = []
    target_matching_values: list[int] = []
    current_visitors = 0
    camera_outage_since = local_now - PARTIAL_CAMERA_OUTAGE

    for day_offset in range(35):
        day = first_day + timedelta(days=day_offset)
        for hour in hours:
            local_captured_at = day.replace(hour=hour)
            if local_captured_at.date() == local_now.date() and hour == local_now.hour:
                local_captured_at = local_now
            if local_captured_at > local_now:
                continue

            for enterprise_index, enterprise in enumerate(enterprises):
                profile = enterprise.enterprise_profile
                if profile is None:
                    raise SystemExit("Sample visitor insights require enterprise profiles.")
                silent_since = sample_silent_since(enterprise, target, range_end)
                if silent_since is not None and local_captured_at > silent_since:
                    continue
                normal_level = sample_normal_visitor_level(enterprise_index, local_captured_at)
                occupancy = max(0, normal_level + rng.randint(-2, 2))
                is_matching_target_history = (
                    enterprise.id == target.id
                    and local_captured_at.weekday() == local_now.weekday()
                    and local_captured_at.hour == local_now.hour
                    and local_captured_at < local_now - timedelta(days=1)
                )
                if is_matching_target_history:
                    target_matching_values.append(occupancy)

                is_current = local_captured_at == local_now
                if is_current and enterprise.id == target.id:
                    typical = round(fmean(target_matching_values))
                    multiplier = 2.15 if scenario == "peak-traffic" else 1.75
                    minimum_busy_level = 84 if scenario == "peak-traffic" else 68
                    occupancy = max(
                        minimum_busy_level,
                        typical + 12,
                        ceil(typical * multiplier),
                    )
                    current_visitors = occupancy

                captured_at = local_captured_at.astimezone(UTC)
                entries = 180 + day_offset * 24 + enterprise_index * 31 + hour * 3
                exits = max(0, entries - occupancy)
                unique_count = max(occupancy, round(entries * 0.72))
                is_camera_error = enterprise_index == 2 and is_current
                snapshot = EnterpriseTelemetrySnapshot(
                    id=sample_uuid(
                        "visitor-insight-telemetry",
                        profile.account_id,
                        captured_at.isoformat(),
                    ),
                    enterprise_profile_id=profile.account_id,
                    enterprise_name=profile.enterprise_name,
                    camera_id=f"{SAMPLE_CAMERA_PREFIX}visitor-{enterprise_index + 1}",
                    camera_name=f"{profile.enterprise_name} Main Entrance",
                    captured_at=captured_at,
                    received_at=captured_at,
                    entries=entries,
                    exits=exits,
                    current_occupancy=0 if is_current else occupancy,
                    peak_occupancy=max(occupancy, normal_level + 8),
                    unique_count=unique_count,
                    confirmed_unique_count=round(unique_count * 0.86),
                    degraded_unique_count=unique_count - round(unique_count * 0.86),
                    total_events=entries + exits,
                    unsubmitted_events=0,
                    unsynced_events=8 if is_camera_error else 0,
                    running=is_current,
                    status="error" if is_camera_error else "running",
                    error="Desktop app updates delayed. Retrying automatically."
                    if is_camera_error
                    else None,
                    analytics_fps=10.0 + rng.random() * 2.0,
                    payload_json=json.dumps(
                        {
                            "source": "desktop-camera",
                            "purpose": "visitor-insights",
                            "app": sample_app_info(enterprise_index),
                            "monitoring": sample_camera_monitoring(
                                enterprise_index, local_captured_at, camera_outage_since
                            ),
                        },
                        sort_keys=True,
                    ),
                )
                db.add(snapshot)
                telemetry.append(snapshot)

    if len(target_matching_values) < 3 or current_visitors <= 0:
        raise SystemExit("The sample dataset could not build a visitor-activity baseline.")
    await db.flush()
    return AdminVisitorScenario(
        enterprise=target,
        current_visitors=current_visitors,
        typical_visitors=round(fmean(target_matching_values)),
        captured_at=range_end,
        telemetry=telemetry,
    )


def sample_camera_monitoring(
    enterprise_index: int, captured_at: datetime, outage_since: datetime
) -> dict:
    """The desktop's camera summary for one snapshot, in the shape telemetry ingestion stores."""
    names = SAMPLE_CAMERA_LOCATIONS[: 2 + enterprise_index % 2]
    outage = enterprise_index == PARTIAL_CAMERA_ENTERPRISE_INDEX and captured_at >= outage_since
    since = outage_since.strftime("%I:%M %p").lstrip("0")
    cameras = [
        {
            "cameraId": camera_id,
            "cameraName": name,
            "status": "error" if outage and camera_id == 1 else "running",
            "running": not (outage and camera_id == 1),
            "error": f"No visitor counts since {since}." if outage and camera_id == 1 else None,
            "mode": SAMPLE_CAMERA_SETUP[camera_id - 1][0],
            "brand": SAMPLE_CAMERA_SETUP[camera_id - 1][1],
        }
        for camera_id, name in enumerate(names, start=1)
    ]
    failing = sum(1 for camera in cameras if camera["status"] == "error")
    return {
        "status": "partial" if failing else "running",
        "configuredCameraCount": len(cameras),
        "activeCameraCount": len(cameras) - failing,
        "healthyCameraCount": len(cameras) - failing,
        "startingCameraCount": 0,
        "stoppedCameraCount": 0,
        "errorCameraCount": failing,
        "cameras": cameras,
    }


def sample_app_info(enterprise_index: int) -> dict[str, str]:
    """The desktop app build and computer name a sample enterprise checks in with."""
    return {
        "version": SAMPLE_OLDER_APP_VERSION
        if enterprise_index == OLDER_APP_ENTERPRISE_INDEX
        else SAMPLE_LATEST_APP_VERSION,
        "computerName": SAMPLE_COMPUTER_NAMES[enterprise_index % len(SAMPLE_COMPUTER_NAMES)],
    }


def sample_silent_since(
    enterprise: Account, target: Account, range_end: datetime
) -> datetime | None:
    """When a sample place's desktop app last checked in, if it has gone quiet since.

    The target enterprise always keeps checking in, since the busy-place scenario counts on it.
    """
    profile = enterprise.enterprise_profile
    if enterprise.id == target.id or profile is None or profile.last_check_in_at is None:
        return None
    last = ensure_aware(profile.last_check_in_at)
    return last if last < range_end - SAMPLE_SILENT_AFTER else None


def sample_normal_visitor_level(enterprise_index: int, captured_at: datetime) -> int:
    base = 14 + enterprise_index * 4
    hour_effect = max(0, 18 - abs(captured_at.hour - 14) * 3)
    weekend_effect = 9 if captured_at.weekday() >= 5 else 0
    return base + hour_effect + weekend_effect
