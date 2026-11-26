"""Today's desktop app check-ins, so IT's enterprise health screens show a real-looking day.

Each open place checks in every five minutes with its app version, computer name and the state
of each camera. One camera keeps dropping out for a few minutes at a time, the visitor history's
partial-camera place keeps one camera not counting, and the offline place stops checking in
when its desktop app went quiet. The check-ins carry no visitor counts, so the visitor insights
built from the visitor history stay as they are.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import PHILIPPINE_TIME_ZONE
from app.features.accounts.models import Account
from app.features.accounts.opening_hours import OpeningHours, is_open_at, parse_opening_hours
from app.features.monitoring.live_status import load_current_closures
from app.features.monitoring.models import EnterpriseTelemetrySnapshot
from app.features.sample_data.dataset import SAMPLE_CAMERA_PREFIX
from app.features.sample_data.helpers import sample_uuid
from app.features.sample_data.visitors import (
    PARTIAL_CAMERA_ENTERPRISE_INDEX,
    PARTIAL_CAMERA_OUTAGE,
    sample_app_info,
    sample_camera_monitoring,
    sample_silent_since,
)

CHECK_IN_EVERY = timedelta(minutes=5)
DROPOUT_CAMERA_ID = 2
DROPOUT_ERROR = "The camera stopped sending video."
# Each drop-out as (how long before generation it started, how long it lasted).
DROPOUTS = (
    (timedelta(hours=3, minutes=10), timedelta(minutes=10)),
    (timedelta(hours=2, minutes=5), timedelta(minutes=5)),
    (timedelta(minutes=55), timedelta(minutes=15)),
)
# Enterprises (by position) tried, in order, for the camera that drops out.
DROPOUT_CANDIDATES = (1, 0, 4, 5, 6, 7, 8, 2)


@dataclass(frozen=True)
class EnterpriseHealthScenario:
    telemetry: list[EnterpriseTelemetrySnapshot]
    dropout_enterprise: Account | None


async def create_enterprise_health_today(
    db: AsyncSession,
    range_end: datetime,
    enterprises: list[Account],
    target: Account,
) -> EnterpriseHealthScenario:
    local_now = range_end.astimezone(PHILIPPINE_TIME_ZONE)
    day_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    closures = await load_current_closures(
        db, [enterprise.id for enterprise in enterprises], local_now.date()
    )
    closed_today = {
        account_id
        for account_id, spans in closures.items()
        if any(span.start <= local_now.date() <= span.end for span in spans)
    }
    hours = {
        enterprise.id: parse_opening_hours(
            enterprise.enterprise_profile.opening_hours_json
            if enterprise.enterprise_profile
            else None
        )
        for enterprise in enterprises
    }
    dropout_index = choose_dropout_enterprise(enterprises, hours, closed_today, target, range_end)
    outage_since = local_now - PARTIAL_CAMERA_OUTAGE

    telemetry: list[EnterpriseTelemetrySnapshot] = []
    for index, enterprise in enumerate(enterprises):
        profile = enterprise.enterprise_profile
        if profile is None or enterprise.id in closed_today:
            continue
        silent_since = sample_silent_since(enterprise, target, range_end)
        moment = day_start
        while moment < local_now:
            captured_at = moment
            moment += CHECK_IN_EVERY
            if silent_since is not None and captured_at > silent_since:
                break
            if not is_open_at(hours[enterprise.id], captured_at):
                continue
            monitoring = sample_camera_monitoring(index, captured_at, outage_since)
            if index == dropout_index and in_dropout(captured_at, range_end):
                monitoring = with_camera_error(monitoring, DROPOUT_CAMERA_ID, DROPOUT_ERROR)
            at = captured_at.astimezone(UTC)
            snapshot = EnterpriseTelemetrySnapshot(
                id=sample_uuid("health-telemetry", profile.account_id, at.isoformat()),
                enterprise_profile_id=profile.account_id,
                enterprise_name=profile.enterprise_name,
                camera_id=f"{SAMPLE_CAMERA_PREFIX}health-{index + 1}",
                camera_name=f"{profile.enterprise_name} Main Entrance",
                captured_at=at,
                received_at=at,
                running=True,
                status="running",
                analytics_fps=11.0,
                payload_json=json.dumps(
                    {
                        "source": "desktop-camera",
                        "purpose": "enterprise-health",
                        "app": sample_app_info(index),
                        "monitoring": monitoring,
                    },
                    sort_keys=True,
                ),
            )
            db.add(snapshot)
            telemetry.append(snapshot)
    await db.flush()
    return EnterpriseHealthScenario(
        telemetry=telemetry,
        dropout_enterprise=enterprises[dropout_index] if dropout_index is not None else None,
    )


def in_dropout(captured_at: datetime, range_end: datetime) -> bool:
    return any(
        range_end - before <= captured_at < range_end - before + length
        for before, length in DROPOUTS
    )


def choose_dropout_enterprise(
    enterprises: list[Account],
    hours: dict[str, OpeningHours | None],
    closed_today: set[str],
    target: Account,
    range_end: datetime,
) -> int | None:
    """The first candidate open through every drop-out, with a second camera and no outage."""
    for index in DROPOUT_CANDIDATES:
        if index >= len(enterprises) or index == PARTIAL_CAMERA_ENTERPRISE_INDEX:
            continue
        enterprise = enterprises[index]
        if enterprise.id in closed_today or sample_silent_since(enterprise, target, range_end):
            continue
        moments = [
            range_end - before + offset
            for before, length in DROPOUTS
            for offset in (timedelta(0), length)
        ]
        if all(is_open_at(hours.get(enterprise.id), moment) for moment in moments):
            return index
    return None


def with_camera_error(monitoring: dict, camera_id: int, error: str) -> dict:
    """The desktop's camera summary with one more camera not counting."""
    cameras = [
        {**camera, "status": "error", "running": False, "error": error}
        if camera["cameraId"] == camera_id
        else camera
        for camera in monitoring["cameras"]
    ]
    failing = sum(1 for camera in cameras if camera["status"] == "error")
    return {
        **monitoring,
        "status": "partial" if failing else "running",
        "activeCameraCount": len(cameras) - failing,
        "healthyCameraCount": len(cameras) - failing,
        "errorCameraCount": failing,
        "cameras": cameras,
    }
