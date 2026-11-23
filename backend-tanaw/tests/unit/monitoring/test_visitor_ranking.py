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
from app.features.monitoring.schemas import VisitorRankingSummary
from app.features.monitoring.visitor_insights import HourlyVisitorObservation
from app.features.monitoring.visitor_ranking import (
    EnterpriseIdentity,
    InvalidRankingRangeError,
    RankingPlan,
    ReportVisitors,
    daily_unique_by_enterprise,
    months_in_range,
    plan_visitor_ranking,
    rank_enterprise_visitors,
    validate_ranking_range,
)

TODAY = date(2026, 11, 24)
PLAZA = EnterpriseIdentity("ENT-1", "San Pedro Plaza", "Poblacion", "Park")
MARKET = EnterpriseIdentity("ENT-2", "Public Market", "Landayan", "Market")


def _observation(
    enterprise: EnterpriseIdentity, at: datetime, unique: int | None
) -> HourlyVisitorObservation:
    return HourlyVisitorObservation(
        enterprise_profile_id=f"profile-{enterprise.enterprise_id}",
        enterprise_id=enterprise.enterprise_id,
        enterprise_name=enterprise.name,
        barangay=enterprise.barangay,
        start_at=at,
        average_visitors=10,
        peak_visitors=12,
        estimated_unique_count=unique,
    )


def _hour(day: int, hour: int, month: int = 11) -> datetime:
    return datetime(2026, month, day, hour, tzinfo=PHILIPPINE_TIME_ZONE)


def test_a_reported_whole_past_month_counts_from_monthly_reports() -> None:
    plan = plan_visitor_ranking(date(2026, 10, 1), date(2026, 10, 31), TODAY, {"2026-10"})

    assert plan == RankingPlan(("2026-10",), (), False, 0)


def test_a_month_without_reports_falls_back_to_camera_history_and_older_days_are_uncovered() -> (
    None
):
    plan = plan_visitor_ranking(date(2026, 10, 1), date(2026, 10, 31), TODAY, set())

    # The camera history keeps 30 days: Oct 26 to Nov 24.
    assert plan.report_months == ()
    assert plan.camera_days == tuple(date(2026, 10, day) for day in range(26, 32))
    assert plan.uncovered_days == 25
    assert plan.includes_today is False


def test_this_month_so_far_uses_camera_days_and_today() -> None:
    plan = plan_visitor_ranking(date(2026, 11, 1), date(2026, 11, 24), TODAY, {"2026-11"})

    assert plan.report_months == ()
    assert plan.camera_days == tuple(date(2026, 11, day) for day in range(1, 24))
    assert plan.includes_today is True
    assert plan.uncovered_days == 0


def test_a_partly_covered_month_does_not_count_its_reports() -> None:
    plan = plan_visitor_ranking(date(2026, 10, 15), date(2026, 11, 24), TODAY, {"2026-10"})

    assert plan.report_months == ()
    assert plan.uncovered_days == 11  # Oct 15 to Oct 25
    assert plan.includes_today is True


def test_days_after_today_are_ignored() -> None:
    plan = plan_visitor_ranking(date(2026, 11, 20), date(2026, 12, 5), TODAY, set())

    assert plan.camera_days == tuple(date(2026, 11, day) for day in range(20, 24))
    assert plan.includes_today is True


def test_range_validation_and_month_listing() -> None:
    with pytest.raises(InvalidRankingRangeError):
        validate_ranking_range(date(2026, 11, 2), date(2026, 11, 1))
    with pytest.raises(InvalidRankingRangeError):
        validate_ranking_range(date(2010, 1, 1), date(2026, 11, 1))
    validate_ranking_range(date(2026, 1, 1), date(2026, 11, 24))

    assert months_in_range(date(2025, 12, 20), date(2026, 2, 1)) == [
        date(2025, 12, 1),
        date(2026, 1, 1),
        date(2026, 2, 1),
    ]


def test_each_day_takes_the_latest_unique_estimate_of_that_day() -> None:
    observations = [
        _observation(PLAZA, _hour(22, 9), 40),
        _observation(PLAZA, _hour(22, 17), 120),
        _observation(PLAZA, _hour(22, 12), 80),
        _observation(PLAZA, _hour(23, 10), None),
        _observation(MARKET, _hour(23, 11), 15),
    ]

    assert daily_unique_by_enterprise(observations) == {
        ("ENT-1", date(2026, 11, 22)): 120,
        ("ENT-2", date(2026, 11, 23)): 15,
    }


def test_ranking_adds_report_months_and_camera_days_per_enterprise() -> None:
    plan = RankingPlan(("2026-10",), (date(2026, 11, 22),), True, 0)
    reports = [
        ReportVisitors(PLAZA, "2026-10", 900),
        ReportVisitors(MARKET, "2026-10", 1200),
        ReportVisitors(MARKET, "2026-09", 5000),
    ]
    daily_unique = {
        ("ENT-1", date(2026, 11, 22)): 120,
        ("ENT-1", date(2026, 11, 24)): 300,
        ("ENT-1", date(2026, 11, 23)): 999,  # not a counted day
        ("ENT-3", date(2026, 11, 22)): 50,  # no profile found: left out
    }

    ranked = rank_enterprise_visitors(plan, TODAY, reports, daily_unique, {"ENT-1": PLAZA})

    assert [(item.enterpriseId, item.visitors) for item in ranked] == [
        ("ENT-1", 1320),
        ("ENT-2", 1200),
    ]
    assert ranked[1].barangay == "Landayan"
    assert ranked[1].category == "Market"


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [AccountRole.IT, AccountRole.STAFF, AccountRole.ENTERPRISE])
async def test_only_admins_can_read_the_ranking(role: AccountRole) -> None:
    response = await _request_ranking(role, "start=2026-11-01&end=2026-11-24")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_reads_the_ranking_and_bad_ranges_are_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    summary = VisitorRankingSummary(
        start=date(2026, 11, 1),
        end=date(2026, 11, 24),
        reportMonths=[],
        cameraDays=24,
        includesToday=True,
        uncoveredDays=0,
        enterprises=[],
    )
    ranking = AsyncMock(return_value=summary)
    monkeypatch.setattr(monitoring_router, "get_visitor_ranking", ranking)

    response = await _request_ranking(AccountRole.ADMIN, "start=2026-11-01&end=2026-11-24")
    assert response.status_code == 200
    assert response.json()["cameraDays"] == 24
    assert ranking.await_args is not None
    assert ranking.await_args.args[1:] == (date(2026, 11, 1), date(2026, 11, 24))

    ranking.side_effect = InvalidRankingRangeError(
        "The start date must be on or before the end date."
    )
    response = await _request_ranking(AccountRole.ADMIN, "start=2026-11-24&end=2026-11-01")
    assert response.status_code == 422
    assert response.json()["detail"] == "The start date must be on or before the end date."


async def _request_ranking(role: AccountRole, query: str):  # type: ignore[no-untyped-def]
    application = FastAPI()
    application.include_router(monitoring_router.router)

    async def current_account() -> Account:
        return Account(
            id=f"{role.value}-account",
            email=f"{role.value}@example.com",
            password_hash="hash",
            role=role,
            display_name="Ranking Tester",
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
        return await client.get(f"/operational/visitor-insights/ranking?{query}")
