from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.features.final_reports.router as final_reports_router_module
import app.features.reporting.router as reporting_router_module
from app.core.pagination_schemas import CursorPageInfo
from app.db.session import get_db
from app.features.accounts.dependencies import get_current_account
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.final_reports.read_envelopes import FinalReportPage
from app.features.final_reports.router import router as final_reports_router
from app.features.reporting.period_envelopes import (
    ReportingPeriodLifecycleResult,
    ReportingPeriodPage,
)
from app.features.reporting.read_envelopes import EnterpriseReportPage
from app.features.reporting.router import router as reporting_router


@pytest.mark.parametrize("role", [AccountRole.ENTERPRISE, AccountRole.ADMIN])
def test_non_staff_principal_cannot_read_staff_report_resources(role: AccountRole) -> None:
    app = FastAPI()
    app.include_router(final_reports_router)
    app.include_router(reporting_router)
    account = Account(
        id=str(uuid4()),
        email=f"report-reader-{role.value}@example.test",
        password_hash="not-used",
        role=role,
        display_name="Unauthorized Report Reader",
        title="Unauthorized Reader",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )

    async def enterprise_account() -> Account:
        return account

    database = AsyncMock(spec=AsyncSession)

    async def unused_database() -> AsyncIterator[AsyncSession]:
        yield cast(AsyncSession, database)

    app.dependency_overrides[get_current_account] = enterprise_account
    app.dependency_overrides[get_db] = unused_database
    client = TestClient(app)
    resource_id = uuid4()

    for path in (
        "/operational/reporting-periods/v2",
        f"/operational/reporting-periods/{resource_id}/v2",
        "/operational/reports/v2",
        f"/operational/reports/{resource_id}/v2",
        "/operational/reports/finalizations/v2",
        f"/operational/reports/finalizations/{resource_id}/v2",
    ):
        response = client.get(path)
        assert response.status_code == 403, path
        assert response.json() == {"detail": "Insufficient account permissions."}

    lifecycle_response = client.post("/operational/reporting-periods/lifecycle/run/v2")
    assert lifecycle_response.status_code == 403
    assert lifecycle_response.json() == {"detail": "Insufficient account permissions."}


def test_staff_principal_can_reach_report_list_handlers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = FastAPI()
    app.include_router(final_reports_router)
    app.include_router(reporting_router)
    account = Account(
        id=str(uuid4()),
        email="report-reader-staff@example.test",
        password_hash="not-used",
        role=AccountRole.STAFF,
        display_name="Authorized Staff Reader",
        title="Tourism Staff",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )

    async def staff_account() -> Account:
        return account

    database = AsyncMock(spec=AsyncSession)

    async def unused_database() -> AsyncIterator[AsyncSession]:
        yield cast(AsyncSession, database)

    async def empty_report_page(*_args: object, **_kwargs: object) -> EnterpriseReportPage:
        return EnterpriseReportPage(
            items=[],
            page=CursorPageInfo(limit=50, returnedCount=0, hasMore=False, nextCursor=None),
        )

    async def empty_final_page(*_args: object, **_kwargs: object) -> FinalReportPage:
        return FinalReportPage(
            items=[],
            page=CursorPageInfo(limit=50, returnedCount=0, hasMore=False, nextCursor=None),
        )

    async def empty_period_page(*_args: object, **_kwargs: object) -> ReportingPeriodPage:
        return ReportingPeriodPage(
            items=[],
            page=CursorPageInfo(limit=50, returnedCount=0, hasMore=False, nextCursor=None),
        )

    async def empty_lifecycle(*_args: object, **_kwargs: object) -> ReportingPeriodLifecycleResult:
        return ReportingPeriodLifecycleResult(
            contractVersion=2,
            evaluatedAt=datetime.now(UTC),
            ensuredPeriodCount=0,
            createdCount=0,
            transitionedCount=0,
            frozenCount=0,
            periods=[],
        )

    monkeypatch.setattr(
        reporting_router_module,
        "list_official_enterprise_reports",
        empty_report_page,
    )
    monkeypatch.setattr(
        final_reports_router_module,
        "list_official_final_reports",
        empty_final_page,
    )
    monkeypatch.setattr(reporting_router_module, "list_reporting_periods", empty_period_page)
    monkeypatch.setattr(
        reporting_router_module,
        "run_reporting_period_lifecycle",
        empty_lifecycle,
    )
    app.dependency_overrides[get_current_account] = staff_account
    app.dependency_overrides[get_db] = unused_database
    client = TestClient(app)

    assert client.get("/operational/reports/v2").status_code == 200
    assert client.get("/operational/reports/finalizations/v2").status_code == 200
    assert client.get("/operational/reporting-periods/v2").status_code == 200
    assert client.post("/operational/reporting-periods/lifecycle/run/v2").status_code == 200
    database.commit.assert_awaited_once()


def test_enterprise_principal_reaches_only_its_scoped_history_handler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = FastAPI()
    app.include_router(reporting_router)
    account = Account(
        id=str(uuid4()),
        email="report-owner@example.test",
        password_hash="not-used",
        role=AccountRole.ENTERPRISE,
        display_name="Enterprise Report Owner",
        title="Enterprise Manager",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )

    async def current_account() -> Account:
        return account

    async def unused_database() -> AsyncIterator[AsyncSession]:
        yield cast(AsyncSession, AsyncMock(spec=AsyncSession))

    async def empty_owned_page(*_args: object, **_kwargs: object) -> EnterpriseReportPage:
        return EnterpriseReportPage(
            items=[],
            page=CursorPageInfo(limit=50, returnedCount=0, hasMore=False, nextCursor=None),
        )

    monkeypatch.setattr(
        reporting_router_module,
        "list_owned_enterprise_reports",
        empty_owned_page,
    )
    app.dependency_overrides[get_current_account] = current_account
    app.dependency_overrides[get_db] = unused_database
    client = TestClient(app)

    assert client.get("/operational/enterprise/reports/v2").status_code == 200
    assert client.get("/operational/reports/v2").status_code == 403

    account.role = AccountRole.STAFF
    assert client.get("/operational/enterprise/reports/v2").status_code == 403
