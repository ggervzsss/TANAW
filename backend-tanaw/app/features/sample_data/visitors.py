import json
import random
from datetime import UTC, datetime, timedelta
from math import ceil
from statistics import fmean

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import PHILIPPINE_TIME_ZONE
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
                        {"source": "desktop-camera", "purpose": "visitor-insights"},
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


def sample_normal_visitor_level(enterprise_index: int, captured_at: datetime) -> int:
    base = 14 + enterprise_index * 4
    hour_effect = max(0, 18 - abs(captured_at.hour - 14) * 3)
    weekend_effect = 9 if captured_at.weekday() >= 5 else 0
    return base + hour_effect + weekend_effect
