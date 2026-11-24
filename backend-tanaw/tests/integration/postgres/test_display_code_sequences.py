import asyncio
import re
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, or_, select, text

from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.monitoring.alerts import _next_alert_code, evaluate_camera_alerts
from app.features.monitoring.models import OperationalAlert
from app.features.monitoring.schemas import (
    DesktopCameraMonitoringItem,
    DesktopCameraMonitoringSummary,
    DesktopMetricsSummary,
    DesktopTelemetryIngest,
)
from app.features.realtime.models import RealtimeOutbox
from app.features.requests.models import Request
from app.features.requests.schemas import RequestCreate
from app.features.requests.service import create_request
from tests.support.postgres import PostgresRuntime, open_postgres_runtime

TEST_EMAIL_PATTERN = "tanaw-display-code-pg-%@example.com"
TEST_SUBJECT_PREFIX = "Display code sequence test"
TEST_ALERT_REQUESTER_PREFIX = "Display Code Sequence Test"
CONCURRENT_CREATIONS = 12


@pytest_asyncio.fixture
async def postgres_runtime() -> AsyncIterator[PostgresRuntime]:
    async with open_postgres_runtime(
        _clean_rows,
        jwt_secret_key="tanaw-display-code-postgres-jwt-secret-123456789",
    ) as runtime:
        yield runtime


async def _clean_rows(runtime: PostgresRuntime) -> None:
    async with runtime.sessions() as db:
        account_ids = list(
            await db.scalars(select(Account.id).where(Account.email.like(TEST_EMAIL_PATTERN)))
        )
        ticket_ids = list(
            await db.scalars(
                select(Request.id).where(Request.title.startswith(TEST_SUBJECT_PREFIX))
            )
        )
        alert_ids = list(
            await db.scalars(
                select(OperationalAlert.id).where(
                    OperationalAlert.enterprise.startswith(TEST_ALERT_REQUESTER_PREFIX)
                )
            )
        )
        outbox_conditions = []
        if ticket_ids:
            outbox_conditions.append(
                RealtimeOutbox.payload["request_id"].as_string().in_(ticket_ids)
            )
        if alert_ids:
            outbox_conditions.append(RealtimeOutbox.payload["alert_id"].as_string().in_(alert_ids))
        if outbox_conditions:
            await db.execute(delete(RealtimeOutbox).where(or_(*outbox_conditions)))
        if ticket_ids:
            await db.execute(delete(Request).where(Request.id.in_(ticket_ids)))
        if alert_ids:
            await db.execute(delete(OperationalAlert).where(OperationalAlert.id.in_(alert_ids)))
        if account_ids:
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_enterprise(runtime: PostgresRuntime, *, label: str) -> str:
    suffix = uuid4().hex[:12]
    account = Account(
        id=str(uuid4()),
        email=f"tanaw-display-code-pg-{label}-{suffix}@example.com",
        password_hash="unused-display-code-test-password-hash",
        role=AccountRole.ENTERPRISE,
        display_name=f"Display Code Test {label}",
        title="Enterprise Account",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        password_changed_at=datetime.now(UTC),
        enterprise_profile=EnterpriseProfile(
            enterprise_id=f"display-code-{label}-{suffix}",
            enterprise_name=f"Display Code Test {label}",
            attraction_code="411",
            manager_name=f"Display Code Test {label}",
            barangay="Poblacion",
        ),
    )
    async with runtime.sessions() as db:
        db.add(account)
        await db.commit()
    return account.id


def _ticket_payload(label: str) -> RequestCreate:
    return RequestCreate(
        group="Other",
        title=f"{TEST_SUBJECT_PREFIX} {label}",
        description="Verify PostgreSQL-backed request display code allocation.",
    )


def _code_number(code: str, prefix: str) -> int:
    assert re.fullmatch(rf"{prefix}-\d{{6,}}", code)
    return int(code.removeprefix(f"{prefix}-"))


async def _create_ticket(
    runtime: PostgresRuntime, *, account_id: str, label: str
) -> tuple[str, str]:
    async with runtime.sessions() as db:
        account = await db.get(Account, account_id)
        assert account is not None
        request = await create_request(db, account, _ticket_payload(label))
        await db.commit()
        return request.id, request.request_code


def _new_alert(code: str, label: str) -> OperationalAlert:
    return OperationalAlert(
        alert_code=code,
        alert_type="Camera Not Counting",
        severity="Critical",
        enterprise=f"{TEST_ALERT_REQUESTER_PREFIX} {label}",
        summary="Verify PostgreSQL-backed operational alert display code allocation.",
        status="Active",
        source_id=f"display-code-{uuid4()}",
        started_at=datetime.now(UTC),
    )


async def _create_alert(runtime: PostgresRuntime, *, label: str) -> tuple[str, str]:
    async with runtime.sessions() as db:
        alert = _new_alert(await _next_alert_code(db), label)
        db.add(alert)
        await db.commit()
        return alert.id, alert.alert_code


def _camera_error(camera_id: int) -> DesktopTelemetryIngest:
    return DesktopTelemetryIngest(
        metrics=DesktopMetricsSummary(),
        monitoring=DesktopCameraMonitoringSummary(
            status="error",
            configuredCameraCount=2,
            cameras=[
                DesktopCameraMonitoringItem(
                    cameraId=camera_id, cameraName=f"Camera {camera_id}", status="error"
                )
            ],
        ),
    )


@pytest.mark.asyncio
async def test_support_ticket_sequence_allocates_monotonic_formatted_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    account_id = await _create_enterprise(postgres_runtime, label="ticket-sequential")
    first_id, first_code = await _create_ticket(
        postgres_runtime, account_id=account_id, label="sequential-one"
    )
    second_id, second_code = await _create_ticket(
        postgres_runtime, account_id=account_id, label="sequential-two"
    )

    assert first_id != second_id
    assert _code_number(second_code, "REQ") == _code_number(first_code, "REQ") + 1
    async with postgres_runtime.sessions() as db:
        assert await db.scalar(text("SELECT to_regclass('request_code_sequence')")) == (
            "request_code_sequence"
        )


@pytest.mark.asyncio
async def test_concurrent_support_tickets_receive_unique_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    account_id = await _create_enterprise(postgres_runtime, label="ticket-concurrent")
    start = asyncio.Event()

    async def create_one(index: int) -> str:
        await start.wait()
        _, code = await _create_ticket(
            postgres_runtime,
            account_id=account_id,
            label=f"concurrent-{index}",
        )
        return code

    tasks = [asyncio.create_task(create_one(index)) for index in range(CONCURRENT_CREATIONS)]
    start.set()
    codes = await asyncio.gather(*tasks)

    assert len(codes) == CONCURRENT_CREATIONS
    assert len(set(codes)) == CONCURRENT_CREATIONS
    assert all(_code_number(code, "REQ") > 0 for code in codes)


@pytest.mark.asyncio
async def test_support_ticket_deletion_and_rollback_do_not_reuse_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    account_id = await _create_enterprise(postgres_runtime, label="ticket-gaps")
    deleted_id, deleted_code = await _create_ticket(
        postgres_runtime, account_id=account_id, label="deleted"
    )
    async with postgres_runtime.sessions() as db:
        await db.execute(delete(Request).where(Request.id == deleted_id))
        await db.commit()

    async with postgres_runtime.sessions() as db:
        account = await db.get(Account, account_id)
        assert account is not None
        rolled_back = await create_request(db, account, _ticket_payload("rolled-back"))
        rolled_back_code = rolled_back.request_code
        await db.rollback()

    _, next_code = await _create_ticket(postgres_runtime, account_id=account_id, label="after-gaps")
    assert _code_number(rolled_back_code, "REQ") > _code_number(deleted_code, "REQ")
    assert _code_number(next_code, "REQ") > _code_number(rolled_back_code, "REQ")


@pytest.mark.asyncio
async def test_operational_alert_sequence_allocates_only_for_new_formatted_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    account_id = await _create_enterprise(postgres_runtime, label="alert-reuse")
    now = datetime.now(UTC)
    async with postgres_runtime.sessions() as db:
        account = await db.get(Account, account_id)
        assert account is not None
        account.display_name = f"{TEST_ALERT_REQUESTER_PREFIX} reuse"
        assert account.enterprise_profile is not None
        account.enterprise_profile.enterprise_name = f"{TEST_ALERT_REQUESTER_PREFIX} reuse"
        [(_, first)] = await evaluate_camera_alerts(
            db, account, _camera_error(1), now=now, wait_minutes=0
        )
        await evaluate_camera_alerts(db, account, _camera_error(1), now=now, wait_minutes=0)
        reused = await db.scalar(
            select(OperationalAlert).where(OperationalAlert.source_id == first.source_id)
        )
        following = _new_alert(await _next_alert_code(db), "following")
        db.add(following)
        await db.commit()

    assert reused is not None
    assert reused.id == first.id
    assert reused.alert_code == first.alert_code
    assert _code_number(following.alert_code, "ALT") == _code_number(first.alert_code, "ALT") + 1
    async with postgres_runtime.sessions() as db:
        assert await db.scalar(text("SELECT to_regclass('operational_alert_code_sequence')")) == (
            "operational_alert_code_sequence"
        )


@pytest.mark.asyncio
async def test_concurrent_operational_alerts_receive_unique_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    start = asyncio.Event()

    async def create_one(index: int) -> str:
        await start.wait()
        _, code = await _create_alert(postgres_runtime, label=f"concurrent-{index}")
        return code

    tasks = [asyncio.create_task(create_one(index)) for index in range(CONCURRENT_CREATIONS)]
    start.set()
    codes = await asyncio.gather(*tasks)

    assert len(codes) == CONCURRENT_CREATIONS
    assert len(set(codes)) == CONCURRENT_CREATIONS
    assert all(_code_number(code, "ALT") > 0 for code in codes)


@pytest.mark.asyncio
async def test_operational_alert_deletion_and_rollback_do_not_reuse_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    deleted_id, deleted_code = await _create_alert(postgres_runtime, label="deleted")
    async with postgres_runtime.sessions() as db:
        await db.execute(delete(OperationalAlert).where(OperationalAlert.id == deleted_id))
        await db.commit()

    async with postgres_runtime.sessions() as db:
        rolled_back = _new_alert(await _next_alert_code(db), "rolled-back")
        db.add(rolled_back)
        await db.flush()
        rolled_back_code = rolled_back.alert_code
        await db.rollback()

    _, next_code = await _create_alert(postgres_runtime, label="after-gaps")
    assert _code_number(rolled_back_code, "ALT") > _code_number(deleted_code, "ALT")
    assert _code_number(next_code, "ALT") > _code_number(rolled_back_code, "ALT")
