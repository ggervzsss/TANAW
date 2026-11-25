from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.date_time import PHILIPPINE_TIME_ZONE
from app.db.session import get_db
from app.features.accounts.dependencies import get_current_account
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.monitoring import router as monitoring_router
from app.features.monitoring.schemas import VisitorInsightsSummary
from app.features.monitoring.visitor_insights import (
    HourlyVisitorObservation,
    InvalidInsightRangeError,
    camera_history_days,
    validate_insight_days,
    visitor_insight_series,
    visitor_insight_series_between,
)

# 2:00 PM on Tuesday, Nov 24, 2026 in Manila.
LOCAL_NOW = datetime(2026, 11, 24, 14, tzinfo=PHILIPPINE_TIME_ZONE)
TODAY = LOCAL_NOW.date()


def _observation(
    at: datetime, peak: int, unique: int | None = None, enterprise_id: str = "ENT-1"
) -> HourlyVisitorObservation:
    return HourlyVisitorObservation(
        enterprise_profile_id=f"profile-{enterprise_id}",
        enterprise_id=enterprise_id,
        enterprise_name="San Pedro Plaza",
        barangay="Poblacion",
        start_at=at,
        average_visitors=peak / 2,
        peak_visitors=peak,
        estimated_unique_count=unique,
    )


def _hour(day: int, hour: int, month: int = 11) -> datetime:
    return datetime(2026, month, day, hour, tzinfo=PHILIPPINE_TIME_ZONE)


OBSERVATIONS = [
    _observation(_hour(3, 9), 40, 120),
    _observation(_hour(3, 18), 96, 410),
    _observation(_hour(10, 12), 30, 200),
    _observation(_hour(23, 15), 50, 300),
    _observation(_hour(24, 9), 20, 80),
    _observation(_hour(24, 13), 64, 150),
]


def test_one_past_day_gives_its_hours() -> None:
    points = visitor_insight_series_between(
        OBSERVATIONS, date(2026, 11, 3), date(2026, 11, 3), LOCAL_NOW
    )

    assert [(point.label, point.peakVisitors) for point in points] == [("9 AM", 40), ("6 PM", 96)]
    assert points[1].startAt == _hour(3, 18)
    assert points[1].estimatedUniqueCount == 410


def test_today_by_date_matches_the_today_range() -> None:
    by_date = visitor_insight_series_between(OBSERVATIONS, TODAY, TODAY, LOCAL_NOW)

    assert by_date == visitor_insight_series(OBSERVATIONS, "today", LOCAL_NOW)
    assert [point.peakVisitors for point in by_date] == [20, 64]


def test_several_days_give_one_point_per_day_inside_the_range() -> None:
    points = visitor_insight_series_between(
        OBSERVATIONS, date(2026, 11, 3), date(2026, 11, 23), LOCAL_NOW
    )

    assert [(point.startAt.date(), point.estimatedUniqueCount) for point in points] == [
        (date(2026, 11, 3), 410),
        (date(2026, 11, 10), 200),
        (date(2026, 11, 23), 300),
    ]
    assert points[0].startAt == _hour(3, 0)
    assert points[0].label == "Tue, Nov 3"


def test_the_last_seven_days_by_date_match_the_7d_range() -> None:
    by_date = visitor_insight_series_between(OBSERVATIONS, date(2026, 11, 18), TODAY, LOCAL_NOW)

    assert by_date == visitor_insight_series(OBSERVATIONS, "7d", LOCAL_NOW)


def test_days_outside_the_camera_history_are_left_out() -> None:
    older = [*OBSERVATIONS, _observation(_hour(20, 12, month=10), 70, 500)]

    # Oct 26 is the first day of the 30-day camera history that ends on Nov 24.
    assert camera_history_days(date(2026, 10, 1), date(2026, 11, 30), TODAY) == (
        date(2026, 10, 26),
        TODAY,
    )
    assert camera_history_days(date(2026, 9, 1), date(2026, 10, 25), TODAY) is None
    assert camera_history_days(date(2026, 11, 25), date(2026, 11, 30), TODAY) is None

    points = visitor_insight_series_between(older, date(2026, 10, 1), date(2026, 11, 5), LOCAL_NOW)
    assert [point.startAt.date() for point in points] == [date(2026, 11, 3)]
    assert (
        visitor_insight_series_between(older, date(2026, 10, 20), date(2026, 10, 20), LOCAL_NOW)
        == []
    )


def test_start_and_end_come_together_in_order() -> None:
    validate_insight_days(None, None)
    validate_insight_days(TODAY, TODAY)
    with pytest.raises(InvalidInsightRangeError, match="both a start and an end"):
        validate_insight_days(TODAY, None)
    with pytest.raises(InvalidInsightRangeError, match="on or before"):
        validate_insight_days(date(2026, 11, 24), date(2026, 11, 1))


@pytest.mark.asyncio
async def test_admin_reads_insights_by_date_and_presets_keep_working(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    summary = VisitorInsightsSummary(
        range=None,
        start=date(2026, 11, 3),
        end=date(2026, 11, 3),
        scopeType="enterprise",
        scopeId="ENT-1",
        scopeName="San Pedro Plaza",
        currentVisitors=None,
        comparisonMessage="",
    )
    insights = AsyncMock(return_value=summary)
    monkeypatch.setattr(monitoring_router, "get_visitor_insights", insights)

    response = await _request_insights("enterpriseId=ENT-1&start=2026-11-03&end=2026-11-03")
    assert response.status_code == 200
    assert response.json()["range"] is None
    assert response.json()["start"] == "2026-11-03"
    assert insights.await_args is not None
    assert insights.await_args.kwargs["start"] == date(2026, 11, 3)
    assert insights.await_args.kwargs["end"] == date(2026, 11, 3)

    await _request_insights("enterpriseId=ENT-1&range=30d")
    assert insights.await_args.args[1] == "30d"
    assert insights.await_args.kwargs["start"] is None
    assert insights.await_args.kwargs["end"] is None

    insights.side_effect = InvalidInsightRangeError("Give both a start and an end date.")
    response = await _request_insights("enterpriseId=ENT-1&start=2026-11-03")
    assert response.status_code == 422
    assert response.json()["detail"] == "Give both a start and an end date."


async def _request_insights(query: str):  # type: ignore[no-untyped-def]
    application = FastAPI()
    application.include_router(monitoring_router.router)

    async def current_account() -> Account:
        return Account(
            id="admin-account",
            email="admin@example.com",
            password_hash="hash",
            role=AccountRole.ADMIN,
            display_name="Insights Tester",
            title="Admin",
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
        return await client.get(f"/operational/visitor-insights?{query}")
