"""The sample dataset gives IT's enterprise health screens a real-looking day."""

import json
import random
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.date_time import PHILIPPINE_TIME_ZONE
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.opening_hours import (
    WEEKDAYS,
    DayHours,
    OpeningHours,
    OpeningPeriod,
)
from app.features.monitoring.health import camera_samples, snapshot_facts
from app.features.monitoring.health_strip import build_camera_day, day_window, local_day_start
from app.features.monitoring.models import EnterpriseTelemetrySnapshot
from app.features.sample_data.health import (
    DROPOUT_CAMERA_ID,
    create_enterprise_health_today,
)
from app.features.sample_data.visitors import (
    OLDER_APP_ENTERPRISE_INDEX,
    PARTIAL_CAMERA_ENTERPRISE_INDEX,
    SAMPLE_OLDER_APP_VERSION,
    create_admin_visitor_history,
)

# 2:00 PM on Tuesday, Nov 24, 2026, in Manila.
GENERATED_AT = datetime(2026, 11, 24, 6, tzinfo=UTC)
SILENT_INDEX = 6


def _hours(index: int) -> OpeningHours:
    if index == 5:
        return OpeningHours(
            days=[
                DayHours(
                    day=day, mode="hours", periods=[OpeningPeriod(open="08:00", close="17:00")]
                )
                for day in WEEKDAYS
            ]
        )
    return OpeningHours(days=[DayHours(day=day, mode="open24h") for day in WEEKDAYS])


def _enterprise(index: int) -> Account:
    account = Account(
        id=f"enterprise-{index}",
        email=f"enterprise-{index}@example.com",
        password_hash="hash",
        role=AccountRole.ENTERPRISE,
        display_name=f"Enterprise {index}",
        title="Enterprise Account",
        status=AccountStatus.ACTIVE,
        created_at=GENERATED_AT - timedelta(days=400),
    )
    account.enterprise_profile = EnterpriseProfile(
        account_id=account.id,
        enterprise_id=f"ENT-{index}",
        enterprise_name=f"Enterprise {index}",
        attraction_code="411",
        manager_name="Test Manager",
        barangay="Nueva",
        building_capacity=250,
        opening_hours_json=_hours(index).model_dump_json(),
        last_check_in_at=GENERATED_AT
        - (timedelta(hours=2) if index == SILENT_INDEX else timedelta(seconds=20)),
    )
    return account


def _db() -> MagicMock:
    db = MagicMock()
    db.flush = AsyncMock()
    db.scalars = AsyncMock(return_value=[])
    return db


def _by_enterprise(
    snapshots: list[EnterpriseTelemetrySnapshot],
) -> dict[str, list[EnterpriseTelemetrySnapshot]]:
    grouped: dict[str, list[EnterpriseTelemetrySnapshot]] = {}
    for snapshot in sorted(snapshots, key=lambda item: item.captured_at):
        grouped.setdefault(snapshot.enterprise_profile_id, []).append(snapshot)
    return grouped


@pytest.mark.asyncio
async def test_open_places_check_in_every_five_minutes_with_their_app_and_cameras() -> None:
    enterprises = [_enterprise(index) for index in range(8)]

    scenario = await create_enterprise_health_today(
        _db(), GENERATED_AT, enterprises, enterprises[0]
    )

    grouped = _by_enterprise(scenario.telemetry)
    regular = grouped["enterprise-5"]
    local_times = [s.captured_at.astimezone(PHILIPPINE_TIME_ZONE) for s in regular]
    assert local_times[0].strftime("%H:%M") == "08:00"
    assert local_times[-1].strftime("%H:%M") == "13:55"
    assert all(
        b - a == timedelta(minutes=5) for a, b in zip(local_times, local_times[1:], strict=False)
    )
    assert all(s.captured_at < GENERATED_AT for s in scenario.telemetry)
    # The check-ins carry no visitor counts, so the visitor insights stay as they were.
    assert {s.current_occupancy for s in scenario.telemetry} == {None}
    assert {s.unique_count for s in scenario.telemetry} == {None}

    facts = snapshot_facts(grouped["enterprise-1"][-1])
    assert facts.app is not None and facts.app.version and facts.app.computerName
    assert [(camera.mode, camera.brand) for camera in facts.monitoring.cameras] == [
        ("entrance_exit", "tapo"),
        ("entrance_exit", "dahua"),
        ("open_space", "tenda"),
    ]
    older = snapshot_facts(grouped[f"enterprise-{OLDER_APP_ENTERPRISE_INDEX}"][-1])
    assert older.app is not None and older.app.version == SAMPLE_OLDER_APP_VERSION


@pytest.mark.asyncio
async def test_one_camera_drops_out_and_one_stops_counting() -> None:
    enterprises = [_enterprise(index) for index in range(8)]

    scenario = await create_enterprise_health_today(
        _db(), GENERATED_AT, enterprises, enterprises[0]
    )

    assert scenario.dropout_enterprise is enterprises[1]
    grouped = _by_enterprise(scenario.telemetry)
    window = day_window(_hours(1), GENERATED_AT.date(), closed_all_day=False)
    day_start = local_day_start(GENERATED_AT.astimezone(PHILIPPINE_TIME_ZONE).date())

    flaky = build_camera_day(
        str(DROPOUT_CAMERA_ID),
        camera_samples((s.captured_at, s.payload_json) for s in grouped["enterprise-1"]),
        window,
        day_start,
        GENERATED_AT,
    )
    assert flaky.drop_count == 3
    assert "gaps" in {state for _, state in flaky.slots}
    assert flaky.not_counting_since is None
    assert flaky.note.startswith("Dropped out 3 times since")

    partial = f"enterprise-{PARTIAL_CAMERA_ENTERPRISE_INDEX}"
    stopped = build_camera_day(
        "1",
        camera_samples((s.captured_at, s.payload_json) for s in grouped[partial]),
        window,
        day_start,
        GENERATED_AT,
    )
    assert stopped.not_counting_since is not None
    assert stopped.note.startswith("Not counting since")
    assert dict(stopped.slots)[13] in {"gaps", "down"}


@pytest.mark.asyncio
async def test_a_silent_place_stops_checking_in_when_its_app_went_quiet() -> None:
    enterprises = [_enterprise(index) for index in range(8)]
    silent = enterprises[SILENT_INDEX].enterprise_profile
    assert silent is not None and silent.last_check_in_at is not None

    health = await create_enterprise_health_today(_db(), GENERATED_AT, enterprises, enterprises[0])
    history = await create_admin_visitor_history(
        _db(), GENERATED_AT, "full-workflow", random.Random("health"), enterprises, enterprises[0]
    )

    for telemetry in (health.telemetry, history.telemetry):
        latest = max(
            s.captured_at for s in telemetry if s.enterprise_profile_id == silent.account_id
        )
        assert latest <= silent.last_check_in_at
    newest = max(history.telemetry, key=lambda snapshot: snapshot.captured_at)
    assert json.loads(newest.payload_json or "{}")["app"]["version"]


@pytest.mark.asyncio
async def test_a_place_closed_today_sends_nothing() -> None:
    enterprises = [_enterprise(index) for index in range(3)]
    db = _db()
    closure = MagicMock(
        enterprise_profile_id="enterprise-2",
        start_date=GENERATED_AT.date(),
        end_date=GENERATED_AT.date() + timedelta(days=2),
        reason="Renovation",
    )
    db.scalars = AsyncMock(return_value=[closure])

    scenario = await create_enterprise_health_today(db, GENERATED_AT, enterprises, enterprises[0])

    assert "enterprise-2" not in {s.enterprise_profile_id for s in scenario.telemetry}
