from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.accounts.models import Account, AccountRole, EnterpriseProfile
from app.features.accounts.opening_hours import (
    WEEKDAYS,
    DayHours,
    OpeningHours,
    OpeningPeriod,
    default_opening_hours,
    is_open_at,
    is_open_now,
)
from app.features.monitoring.alerts import (
    ALERT_BUSY,
    ALERT_CAMERA,
    CAMERA_WAIT_MINUTES,
    camera_problems,
    evaluate_camera_alerts,
    resolve_camera_wait_minutes,
    to_alert_summary,
)
from app.features.monitoring.live_status import Closure, place_status
from app.features.monitoring.models import OperationalAlert
from app.features.monitoring.schemas import (
    DesktopCameraMonitoringItem,
    DesktopCameraMonitoringSummary,
    DesktopMetricsSummary,
    DesktopSessionSummary,
    DesktopTelemetryIngest,
)

# Monday, Nov 23, 2026, 2:00 PM in Manila.
MONDAY_2PM = datetime(2026, 11, 23, 6, 0, tzinfo=UTC)


def payload(
    *cameras: DesktopCameraMonitoringItem, session_error: str | None = None
) -> DesktopTelemetryIngest:
    return DesktopTelemetryIngest(
        metrics=DesktopMetricsSummary(),
        session=DesktopSessionSummary(error=session_error),
        monitoring=DesktopCameraMonitoringSummary(
            status="partial",
            configuredCameraCount=len(cameras) or 1,
            healthyCameraCount=sum(1 for camera in cameras if camera.status == "running"),
            cameras=list(cameras),
        ),
    )


def camera(
    camera_id: int, name: str, status: str, error: str | None = None
) -> DesktopCameraMonitoringItem:
    return DesktopCameraMonitoringItem(
        cameraId=camera_id,
        cameraName=name,
        status=status,  # type: ignore[arg-type]
        running=status == "running",
        error=error,
    )


def enterprise() -> Account:
    account = Account(
        id="enterprise-1", role=AccountRole.ENTERPRISE, display_name="Sampaguita Gardens"
    )
    account.enterprise_profile = EnterpriseProfile(
        account_id="enterprise-1", enterprise_id="SG-001", enterprise_name="Sampaguita Gardens"
    )
    return account


def test_camera_problems_name_each_camera_that_is_not_counting() -> None:
    problems = camera_problems(
        payload(
            camera(1, "Gate A", "error", "The connection was refused."),
            camera(2, "Gate B", "running"),
        )
    )

    assert [(p.key, p.name, p.error) for p in problems] == [
        ("1", "Gate A", "The connection was refused.")
    ]


def test_a_service_error_without_camera_details_is_one_problem() -> None:
    problems = camera_problems(payload(session_error="The camera service stopped."))

    assert [(p.key, p.name) for p in problems] == [("service", None)]


@pytest.mark.parametrize(("stored", "expected"), [(30, 30), (7, CAMERA_WAIT_MINUTES), (True, 15)])
def test_camera_wait_uses_only_the_allowed_choices(stored: object, expected: int) -> None:
    assert resolve_camera_wait_minutes({"monitoring.cameraWaitMinutes": stored}) == expected


def fake_db(existing: OperationalAlert | None) -> MagicMock:
    db = MagicMock()
    db.scalar = AsyncMock(side_effect=[existing, 41])
    db.scalars = AsyncMock(return_value=[existing] if existing is not None else [])
    db.flush = AsyncMock()
    db.delete = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_a_new_camera_problem_waits_before_it_becomes_an_alert() -> None:
    db = fake_db(None)

    events = await evaluate_camera_alerts(
        db,
        enterprise(),
        payload(camera(1, "Gate A", "error"), camera(2, "Gate B", "running")),
        now=MONDAY_2PM,
        wait_minutes=15,
    )

    assert events == []
    added = db.add.call_args.args[0]
    assert added.status == "Pending"
    assert added.summary == (
        "The Gate A camera at Sampaguita Gardens is not counting. 1 of 2 cameras are counting."
    )


@pytest.mark.asyncio
async def test_a_camera_problem_that_lasts_the_wait_becomes_active() -> None:
    pending = OperationalAlert(
        alert_type=ALERT_CAMERA,
        status="Pending",
        source_id="camera:enterprise-1:1",
        started_at=MONDAY_2PM - timedelta(minutes=16),
    )
    db = fake_db(pending)

    events = await evaluate_camera_alerts(
        db, enterprise(), payload(camera(1, "Gate A", "error")), now=MONDAY_2PM, wait_minutes=15
    )

    assert events == [("started", pending)]
    assert pending.status == "Active"
    assert pending.active_at == MONDAY_2PM


@pytest.mark.asyncio
async def test_a_camera_that_counts_again_ends_its_alert() -> None:
    active = OperationalAlert(
        alert_type=ALERT_CAMERA,
        status="Active",
        source_id="camera:enterprise-1:1",
        started_at=MONDAY_2PM - timedelta(hours=1),
    )
    db = MagicMock()
    db.scalars = AsyncMock(return_value=[active])
    db.flush = AsyncMock()

    events = await evaluate_camera_alerts(
        db, enterprise(), payload(camera(1, "Gate A", "running")), now=MONDAY_2PM, wait_minutes=15
    )

    assert events == [("ended", active)]
    assert active.status == "Ended"
    assert active.ended_at == MONDAY_2PM


def test_alert_details_are_only_for_it() -> None:
    alert = OperationalAlert(
        alert_code="ALT-000001",
        alert_type=ALERT_CAMERA,
        severity="Critical",
        status="Active",
        enterprise="Sampaguita Gardens",
        camera="Gate A",
        summary="The Gate A camera at Sampaguita Gardens is not counting.",
        detail="Error: the connection was refused",
        started_at=MONDAY_2PM,
    )

    assert to_alert_summary(alert, enterprise_id="SG-001", include_detail=False).detail is None
    assert to_alert_summary(alert, enterprise_id="SG-001", include_detail=True).detail == (
        "Error: the connection was refused"
    )


def weekday_hours(opens: str, closes: str) -> OpeningHours:
    return OpeningHours(
        days=[
            DayHours(day=day, mode="hours", periods=[OpeningPeriod(open=opens, close=closes)])
            for day in WEEKDAYS
        ]
    )


def profile(hours: OpeningHours | None, last_check_in: datetime | None) -> EnterpriseProfile:
    return EnterpriseProfile(
        account_id="enterprise-1",
        enterprise_name="Sampaguita Gardens",
        opening_hours_json=hours.model_dump_json() if hours else None,
        last_check_in_at=last_check_in,
    )


def busy_alert() -> OperationalAlert:
    return OperationalAlert(alert_type=ALERT_BUSY, status="Active")


def camera_alert() -> OperationalAlert:
    return OperationalAlert(alert_type=ALERT_CAMERA, status="Active")


@pytest.mark.parametrize(
    ("last_check_in", "alerts", "expected"),
    [
        (MONDAY_2PM - timedelta(seconds=30), [], "normal"),
        (MONDAY_2PM - timedelta(seconds=30), [busy_alert()], "busy"),
        (MONDAY_2PM - timedelta(seconds=30), [busy_alert(), camera_alert()], "camera"),
        (MONDAY_2PM - timedelta(minutes=11), [busy_alert(), camera_alert()], "offline"),
        (None, [], "offline"),
    ],
)
def test_pin_state_shows_one_state_offline_first_then_camera_then_busy(
    last_check_in: datetime | None, alerts: list[OperationalAlert], expected: str
) -> None:
    status = place_status(
        profile(weekday_hours("08:00", "17:00"), last_check_in), [], alerts, MONDAY_2PM
    )

    assert status.pin_state == expected


def test_a_place_outside_its_hours_is_faded_not_offline() -> None:
    status = place_status(profile(weekday_hours("08:00", "12:00"), None), [], [], MONDAY_2PM)

    assert status.pin_state == "closed"
    assert status.closed_reason == "Outside opening hours"
    assert status.offline_since is None


def test_a_temporarily_closed_place_is_never_offline() -> None:
    closure = Closure(date(2026, 11, 22), date(2026, 11, 25), "Closed for renovation")

    status = place_status(profile(weekday_hours("08:00", "17:00"), None), [closure], [], MONDAY_2PM)

    assert status.pin_state == "closed"
    assert status.closed_reason == "Closed for renovation"


def test_offline_places_show_since_their_last_check_in() -> None:
    last = MONDAY_2PM - timedelta(minutes=45)

    status = place_status(profile(weekday_hours("08:00", "17:00"), last), [], [], MONDAY_2PM)

    assert status.offline_since == last


def test_opening_hours_support_a_midday_break_and_closed_days() -> None:
    hours = OpeningHours(
        days=[
            DayHours(day=day, mode="closed")
            if day == "sunday"
            else DayHours(
                day=day,
                mode="hours",
                periods=[
                    OpeningPeriod(open="13:00", close="18:00"),
                    OpeningPeriod(open="09:00", close="12:00"),
                ],
            )
            for day in WEEKDAYS
        ]
    )

    assert [p.open for p in hours.for_day("monday").periods] == ["09:00", "13:00"]
    assert is_open_at(hours, MONDAY_2PM)
    assert not is_open_at(hours, MONDAY_2PM - timedelta(hours=1, minutes=30))  # 12:30 PM
    assert not is_open_at(hours, MONDAY_2PM - timedelta(days=1))  # Sunday


def test_opening_hours_reject_overlapping_periods_and_missing_days() -> None:
    with pytest.raises(ValueError, match="overlap"):
        DayHours(
            day="monday",
            mode="hours",
            periods=[
                OpeningPeriod(open="08:00", close="12:00"),
                OpeningPeriod(open="11:00", close="15:00"),
            ],
        )
    with pytest.raises(ValueError, match="each day"):
        days = default_opening_hours().days
        OpeningHours(days=[*days[:6], days[0]])


def test_a_place_with_no_hours_on_record_counts_as_open() -> None:
    assert is_open_now(None, [], MONDAY_2PM)
    assert not is_open_now(None, [(date(2026, 11, 23), date(2026, 11, 23))], MONDAY_2PM)
