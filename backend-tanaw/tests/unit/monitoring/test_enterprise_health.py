"""Enterprise health for IT: app status rules, today's camera strip, and who may read them."""

import json
from collections.abc import AsyncIterator, Iterable
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.db.session import get_db
from app.features.accounts.dependencies import get_current_account
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.opening_hours import (
    WEEKDAYS,
    DayHours,
    OpeningHours,
    OpeningPeriod,
)
from app.features.auth.models import AccountActivationToken
from app.features.monitoring import router as monitoring_router
from app.features.monitoring.health import (
    account_state,
    app_status,
    build_health_summary,
    camera_health,
    camera_samples,
)
from app.features.monitoring.health_strip import (
    CameraSample,
    build_camera_day,
    day_window,
    local_day_start,
)
from app.features.monitoring.live_status import Closure
from app.features.monitoring.models import EnterpriseTelemetrySnapshot
from app.features.monitoring.schemas import (
    CameraHealth,
    DesktopCameraMonitoringItem,
    DesktopCameraMonitoringSummary,
    EnterpriseAppHealth,
    EnterpriseCameraHealth,
    EnterpriseHealthSummary,
    EnterpriseHealthToday,
)

MONDAY = date(2026, 11, 23)
DAY_START = local_day_start(MONDAY)


def at(clock: str) -> datetime:
    hours, minutes = clock.split(":")
    return DAY_START + timedelta(hours=int(hours), minutes=int(minutes))


def hours_8_to_5() -> OpeningHours:
    return OpeningHours(
        days=[
            DayHours(day=day, mode="hours", periods=[OpeningPeriod(open="08:00", close="17:00")])
            for day in WEEKDAYS
        ]
    )


def every_five_minutes(start: str, end: str) -> list[datetime]:
    moments: list[datetime] = []
    moment = at(start)
    while moment <= at(end):
        moments.append(moment)
        moment += timedelta(minutes=5)
    return moments


def samples(moments: Iterable[datetime], down: Iterable[datetime] = ()) -> list[CameraSample]:
    not_counting = set(down)
    return [
        CameraSample(at=moment, counting={"1": True, "2": moment not in not_counting})
        for moment in moments
    ]


# Today's strip


def test_the_strip_covers_the_opening_window_rounded_out_to_whole_hours() -> None:
    regular = day_window(hours_8_to_5(), MONDAY, closed_all_day=False)
    assert (regular.open_from, regular.open_to) == ("08:00", "17:00")
    assert regular.hours == tuple(range(8, 17))

    half_past = OpeningHours(
        days=[
            DayHours(day=day, mode="hours", periods=[OpeningPeriod(open="08:30", close="17:30")])
            for day in WEEKDAYS
        ]
    )
    assert day_window(half_past, MONDAY, closed_all_day=False).hours == tuple(range(8, 18))

    always = OpeningHours(days=[DayHours(day=day, mode="open24h") for day in WEEKDAYS])
    window = day_window(always, MONDAY, closed_all_day=False)
    assert (window.open_from, window.open_to, window.hours) == ("00:00", "24:00", tuple(range(24)))

    unknown = day_window(None, MONDAY, closed_all_day=False)
    assert (unknown.open_from, unknown.open_to, unknown.hours) == (None, None, tuple(range(6, 18)))

    closure = day_window(hours_8_to_5(), MONDAY, closed_all_day=True)
    assert (closure.open_from, closure.hours, closure.open_intervals) == (
        None,
        tuple(range(6, 18)),
        (),
    )


def test_each_hour_is_counting_gaps_down_or_still_to_come() -> None:
    down = {at("09:10"), *every_five_minutes("11:00", "11:40"), at("14:20"), at("14:25")}
    checks = samples(every_five_minutes("08:00", "14:25"), down)
    window = day_window(hours_8_to_5(), MONDAY, closed_all_day=False)
    now = at("14:30")

    healthy = build_camera_day("1", checks, window, DAY_START, now)
    flaky = build_camera_day("2", checks, window, DAY_START, now)

    assert dict(healthy.slots) == {
        **dict.fromkeys(range(8, 15), "counting"),
        15: "future",
        16: "future",
    }
    assert (healthy.drop_count, healthy.note, healthy.not_counting_since) == (
        0,
        "No problems today.",
        None,
    )
    assert dict(flaky.slots) == {
        8: "counting",
        9: "gaps",
        10: "counting",
        11: "down",
        12: "counting",
        13: "counting",
        14: "gaps",
        15: "future",
        16: "future",
    }
    assert flaky.drop_count == 3
    assert flaky.note == "Dropped out 2 times since 9 AM, then stopped at 2:20 PM."
    assert flaky.not_counting_since == at("14:20")


def test_notes_describe_drop_outs_once_the_camera_counts_again() -> None:
    window = day_window(hours_8_to_5(), MONDAY, closed_all_day=False)
    checks = every_five_minutes("08:00", "14:25")

    once = build_camera_day("2", samples(checks, {at("09:10")}), window, DAY_START, at("14:30"))
    twice = build_camera_day(
        "2", samples(checks, {at("09:10"), at("12:40")}), window, DAY_START, at("14:30")
    )

    assert once.note == "Dropped out for 5 minutes at 9:10 AM."
    assert twice.note == "Dropped out 2 times since 9 AM."
    assert once.not_counting_since is None


def test_a_silent_desktop_app_leaves_its_cameras_down() -> None:
    window = day_window(hours_8_to_5(), MONDAY, closed_all_day=False)

    day = build_camera_day(
        "1", samples(every_five_minutes("08:00", "10:00")), window, DAY_START, at("12:00")
    )

    assert dict(day.slots) == {
        8: "counting",
        9: "counting",
        10: "down",
        11: "down",
        **dict.fromkeys(range(12, 17), "future"),
    }
    assert day.drop_count == 1
    assert day.note == "Not counting since 10:10 AM."
    assert day.not_counting_since == at("10:10")


def test_a_camera_without_check_ins_today_has_no_counts() -> None:
    window = day_window(hours_8_to_5(), MONDAY, closed_all_day=False)

    day = build_camera_day("1", [], window, DAY_START, at("09:30"))

    assert dict(day.slots)[8] == "down"
    assert dict(day.slots)[9] == "down"
    assert day.note == "No counts today."
    assert day.not_counting_since == at("08:00")


def test_closed_hours_breaks_and_closed_days_are_never_judged() -> None:
    with_break = OpeningHours(
        days=[
            DayHours(
                day=day,
                mode="hours",
                periods=[
                    OpeningPeriod(open="09:00", close="12:00"),
                    OpeningPeriod(open="13:00", close="18:00"),
                ],
            )
            for day in WEEKDAYS
        ]
    )
    window = day_window(with_break, MONDAY, closed_all_day=False)
    checks = samples(every_five_minutes("09:00", "11:55") + every_five_minutes("13:00", "14:55"))

    day = build_camera_day("1", checks, window, DAY_START, at("15:00"))

    assert dict(day.slots)[12] == "closed"
    assert dict(day.slots)[11] == "counting"
    assert dict(day.slots)[13] == "counting"
    assert day.drop_count == 0

    before_opening = build_camera_day("1", [], window, DAY_START, at("07:00"))
    assert {state for _, state in before_opening.slots} == {"future", "closed"}
    assert before_opening.note == "Not open yet today."

    closed = day_window(with_break, MONDAY, closed_all_day=True)
    closed_day = build_camera_day("1", [], closed, DAY_START, at("10:00"))
    assert {state for _, state in closed_day.slots} == {"closed"}
    assert closed_day.note == "Closed today."


def test_check_ins_without_cameras_are_left_out_of_the_strip() -> None:
    camera_payload = json.dumps(
        {
            "monitoring": {
                "cameras": [
                    {"cameraId": 1, "cameraName": "Gate", "status": "running"},
                    {"cameraId": 2, "cameraName": "Deck", "status": "error"},
                ]
            }
        }
    )

    parsed = camera_samples(
        [(at("09:05"), camera_payload), (at("09:00"), "{}"), (at("09:10"), None)]
    )

    assert [(sample.at, dict(sample.counting)) for sample in parsed] == [
        (at("09:05"), {"1": True, "2": False})
    ]


# App and account status rules

NOW = datetime(2026, 11, 23, 6, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("age", "has_error", "expected"),
    [
        (30, False, "online"),
        (119, False, "online"),
        (120, False, "delayed"),
        (600, False, "delayed"),
        (601, False, "offline"),
        (10, True, "offline"),
    ],
)
def test_app_status_follows_the_age_of_its_last_data(
    age: int, has_error: bool, expected: str
) -> None:
    last = NOW - timedelta(seconds=age)
    assert app_status(last, has_error=has_error, expects_data=True, now=NOW) == expected


def test_an_app_that_never_sent_data_is_not_set_up_and_a_closed_place_is_never_offline() -> None:
    assert app_status(None, has_error=False, expects_data=True, now=NOW) == "not_set_up"
    stale = NOW - timedelta(hours=10)
    assert app_status(stale, has_error=True, expects_data=False, now=NOW) == "online"


def _token(*, expires_in: timedelta, invalidated: bool = False) -> AccountActivationToken:
    return AccountActivationToken(
        id="token",
        account_id="enterprise-1",
        token_hash="hash",
        expires_at=NOW + expires_in,
        invalidated_at=NOW if invalidated else None,
        created_at=NOW - timedelta(hours=1),
    )


def test_account_state_comes_from_status_activation_and_the_newest_invitation() -> None:
    account = enterprise_account()
    assert account_state(account, None, NOW) == "active"

    account.activated_at = None
    assert account_state(account, _token(expires_in=timedelta(hours=2)), NOW) == "invited"
    assert account_state(account, _token(expires_in=-timedelta(minutes=1)), NOW) == "expired"
    assert (
        account_state(account, _token(expires_in=timedelta(hours=2), invalidated=True), NOW)
        == "expired"
    )
    assert account_state(account, None, NOW) == "expired"

    account.status = AccountStatus.INACTIVE
    assert account_state(account, _token(expires_in=timedelta(hours=2)), NOW) == "deactivated"


def _monitoring() -> DesktopCameraMonitoringSummary:
    return DesktopCameraMonitoringSummary(
        status="partial",
        configuredCameraCount=3,
        cameras=[
            DesktopCameraMonitoringItem(
                cameraId=1, cameraName="Gate", status="running", mode="entrance_exit", brand="tapo"
            ),
            DesktopCameraMonitoringItem(
                cameraId=2, cameraName="Deck", status="error", error="Lost the picture."
            ),
            DesktopCameraMonitoringItem(cameraId=3, cameraName="Park", status="starting"),
        ],
    )


def test_cameras_report_their_own_state_while_the_app_sends_data() -> None:
    since = NOW - timedelta(minutes=20)

    cameras = camera_health(
        _monitoring(),
        last_data_at=NOW - timedelta(seconds=30),
        expects_data=True,
        now=NOW,
        since_by_camera={"2": since},
    )

    assert [(c.id, c.status, c.since, c.note) for c in cameras] == [
        ("1", "counting", None, None),
        ("2", "not_counting", since, "Lost the picture."),
        ("3", "starting", None, None),
    ]
    assert (cameras[0].mode, cameras[0].brand) == ("entrance_exit", "tapo")


def test_cameras_stop_with_a_silent_desktop_app() -> None:
    last = NOW - timedelta(minutes=30)

    cameras = camera_health(
        _monitoring(), last_data_at=last, expects_data=True, now=NOW, since_by_camera={}
    )

    assert {(c.status, c.since, c.note) for c in cameras} == {
        ("stopped", last, "Stopped with the desktop app.")
    }


def enterprise_account(hours: OpeningHours | None = None) -> Account:
    account = Account(
        id="enterprise-1",
        email="place@example.com",
        password_hash="hash",
        role=AccountRole.ENTERPRISE,
        display_name="Lakeside Park",
        title="Enterprise Account",
        status=AccountStatus.ACTIVE,
        activated_at=NOW - timedelta(days=30),
    )
    account.enterprise_profile = EnterpriseProfile(
        account_id="enterprise-1",
        enterprise_id="LAKESIDE-PARK",
        enterprise_name="Lakeside Park",
        attraction_code="411",
        manager_name="Manager",
        barangay="Nueva",
        building_capacity=100,
        opening_hours_json=hours.model_dump_json() if hours else None,
    )
    return account


def _snapshot(received_at: datetime, *, error: str | None = None) -> EnterpriseTelemetrySnapshot:
    return EnterpriseTelemetrySnapshot(
        id="snapshot-1",
        enterprise_profile_id="enterprise-1",
        enterprise_name="Lakeside Park",
        captured_at=received_at,
        received_at=received_at,
        status="running",
        error=error,
        payload_json=json.dumps(
            {
                "app": {"version": "0.1.2", "computerName": "OFFICE-PC"},
                "monitoring": _monitoring().model_dump(mode="json"),
            }
        ),
    )


def test_the_summary_reads_the_app_and_cameras_from_the_newest_check_in() -> None:
    # 2:00 PM on a Monday in Manila, inside 8 AM to 5 PM.
    summary = build_health_summary(
        enterprise_account(hours_8_to_5()),
        snapshot=_snapshot(NOW - timedelta(minutes=3)),
        closures=[],
        newest_token=None,
        camera_alert_since={},
        now=NOW,
    )

    assert summary.enterpriseId == "LAKESIDE-PARK"
    assert summary.accountState == "active"
    assert summary.app.status == "delayed"
    assert (summary.app.version, summary.app.latestVersion, summary.app.computerName) == (
        "0.1.2",
        "0.1.3",
        "OFFICE-PC",
    )
    assert (summary.openNow, summary.closedReason) == (True, None)
    assert (summary.cameras.total, summary.cameras.counting) == (3, 1)


def test_a_closed_place_with_an_old_check_in_is_not_offline() -> None:
    closure = Closure(MONDAY, MONDAY, "Town fiesta")

    summary = build_health_summary(
        enterprise_account(hours_8_to_5()),
        snapshot=_snapshot(NOW - timedelta(hours=5), error="Stopped."),
        closures=[closure],
        newest_token=None,
        camera_alert_since={},
        now=NOW,
    )

    assert summary.app.status == "online"
    assert (summary.openNow, summary.closedReason) == (False, "Town fiesta")
    assert {camera.status for camera in summary.cameras.list} == {"stopped"}
    assert {camera.note for camera in summary.cameras.list} == {None}


def test_a_place_without_check_ins_or_hours_is_not_set_up() -> None:
    summary = build_health_summary(
        enterprise_account(),
        snapshot=None,
        closures=[],
        newest_token=None,
        camera_alert_since={},
        now=NOW,
    )

    assert summary.app.status == "not_set_up"
    assert summary.app.lastDataAt is None
    assert summary.openNow is None
    assert summary.cameras == EnterpriseCameraHealth(total=0, counting=0, list=[])


# Who may read enterprise health


def _summary() -> EnterpriseHealthSummary:
    return EnterpriseHealthSummary(
        accountId="enterprise-1",
        enterpriseId="LAKESIDE-PARK",
        name="Lakeside Park",
        barangay="Nueva",
        category="Park",
        accountState="active",
        app=EnterpriseAppHealth(status="online"),
        openNow=True,
        cameras=EnterpriseCameraHealth(
            total=1,
            counting=1,
            list=[CameraHealth(id="1", name="Gate", status="counting")],
        ),
    )


HEALTH_PATHS = (
    "/operational/enterprise-health",
    "/operational/enterprise-health/LAKESIDE-PARK",
    "/operational/enterprise-health/LAKESIDE-PARK/today",
)


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [AccountRole.STAFF, AccountRole.ENTERPRISE])
@pytest.mark.parametrize("path", HEALTH_PATHS)
async def test_only_it_and_admins_read_enterprise_health(role: AccountRole, path: str) -> None:
    response = await _request(role, path)

    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [AccountRole.IT, AccountRole.ADMIN])
async def test_it_and_admins_read_the_list_one_place_and_its_day(
    role: AccountRole, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = enterprise_account()
    find = AsyncMock(return_value=account)
    today = EnterpriseHealthToday(
        date=MONDAY, openFrom="08:00", openTo="17:00", hours=[8], cameras=[]
    )
    monkeypatch.setattr(monitoring_router, "find_enterprise", find)
    monkeypatch.setattr(
        monitoring_router, "list_enterprise_health", AsyncMock(return_value=[_summary()])
    )
    monkeypatch.setattr(
        monitoring_router, "get_enterprise_health", AsyncMock(return_value=_summary())
    )
    monkeypatch.setattr(
        monitoring_router, "get_enterprise_health_today", AsyncMock(return_value=today)
    )

    listed, one, day = [await _request(role, path) for path in HEALTH_PATHS]

    assert listed.status_code == one.status_code == day.status_code == 200
    assert listed.json()[0]["cameras"]["list"][0]["status"] == "counting"
    assert one.json()["app"]["status"] == "online"
    assert day.json() == {
        "date": "2026-11-23",
        "openFrom": "08:00",
        "openTo": "17:00",
        "hours": [8],
        "cameras": [],
    }
    assert find.await_args is not None
    assert find.await_args.args[1] == "LAKESIDE-PARK"


@pytest.mark.asyncio
async def test_an_unknown_enterprise_is_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(monitoring_router, "find_enterprise", AsyncMock(return_value=None))

    for path in HEALTH_PATHS[1:]:
        response = await _request(AccountRole.IT, path)
        assert response.status_code == 404


async def _request(role: AccountRole, path: str):  # type: ignore[no-untyped-def]
    application = FastAPI()
    application.include_router(monitoring_router.router)

    async def current_account() -> Account:
        return Account(
            id=f"{role.value}-account",
            email=f"{role.value}@example.com",
            password_hash="hash",
            role=role,
            display_name="Health Tester",
            title=role.value.title(),
            status=AccountStatus.ACTIVE,
            activated_at=datetime.now(UTC),
        )

    async def test_db() -> AsyncIterator[MagicMock]:
        yield MagicMock()

    application.dependency_overrides[get_current_account] = current_account
    application.dependency_overrides[get_db] = test_db
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://testserver"
    ) as client:
        return await client.get(path)
