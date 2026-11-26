import json
from datetime import UTC, datetime, timedelta
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import request_context
from app.core.request_context import RequestContext
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.activity_logs import service
from app.features.activity_logs.models import ActivityLog
from app.features.activity_logs.router import get_cleanup_status
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import (
    CLEANUP_ACTION,
    get_activity_cleanup_status,
    purge_old_activity,
    run_scheduled_activity_cleanup,
    to_activity_log_summary,
)

NOW = datetime(2026, 11, 26, 4, tzinfo=UTC)


def account(role: AccountRole) -> Account:
    return Account(
        id=f"activity-{role.value}",
        email=f"activity-{role.value}@example.com",
        password_hash="unused-password-hash",
        role=role,
        display_name=f"Activity {role.value}",
        title=role.value,
        status=AccountStatus.ACTIVE,
        activated_at=NOW,
    )


def sign_in_log(**overrides: object) -> ActivityLog:
    values: dict[str, object] = {
        "id": "activity-log-1",
        "timestamp": NOW,
        "activity_group": "Login & Security",
        "severity": "Info",
        "actor": "Activity it",
        "actor_role": "IT Personnel",
        "action": "Login",
        "target": "activity-it@example.com",
        "summary": "Activity it signed in to TANAW.",
    }
    values.update(overrides)
    return ActivityLog(**values)


def cleanup_log(at: datetime, deleted: int) -> ActivityLog:
    return sign_in_log(
        timestamp=at,
        activity_group="Settings & Maintenance",
        action=CLEANUP_ACTION,
        metadata_json=json.dumps({"deletedCount": deleted, "retentionDays": 180}),
    )


def test_a_log_recorded_during_a_request_keeps_where_it_came_from() -> None:
    token = request_context._request_context.set(
        RequestContext(ip_address="203.0.113.7", user_agent="Firefox", session_id="abc123")
    )
    try:
        log = sign_in_log()
        given = sign_in_log(ip_address="198.51.100.1")
    finally:
        request_context._request_context.reset(token)
    outside = sign_in_log()

    assert (log.ip_address, log.user_agent, log.session_id) == (
        "203.0.113.7",
        "Firefox",
        "abc123",
    )
    assert given.ip_address == "198.51.100.1"
    assert (outside.ip_address, outside.user_agent, outside.session_id) == (None, None, None)


def test_only_it_reads_the_technical_detail() -> None:
    log = sign_in_log(ip_address="203.0.113.7", user_agent="Firefox", session_id="abc123")

    it_view = to_activity_log_summary(log, include_it_detail=True)
    admin_view = to_activity_log_summary(log, include_it_detail=False)

    assert it_view.technical is not None
    assert it_view.technical.model_dump() == {
        "ipAddress": "203.0.113.7",
        "userAgent": "Firefox",
        "sessionId": "abc123",
    }
    assert admin_view.technical is None
    assert to_activity_log_summary(sign_in_log(), include_it_detail=True).technical is None


def test_enterprise_events_have_their_own_group() -> None:
    payload = ActivityLogCreate(
        group="Enterprises",
        actor="IT",
        actorRole="IT Personnel",
        action="Create Enterprise Account",
        target="Sampaguita Gardens",
        summary="IT registered Sampaguita Gardens.",
    )

    assert payload.group == "Enterprises"


@pytest.mark.asyncio
async def test_the_cleanup_status_comes_from_the_newest_cleanup_record() -> None:
    db = MagicMock()
    db.scalar = AsyncMock(side_effect=[None, cleanup_log(NOW - timedelta(hours=3), 12)])

    result = await get_activity_cleanup_status(cast(AsyncSession, db))

    assert result.model_dump() == {
        "lastRunAt": NOW - timedelta(hours=3),
        "deletedCount": 12,
        "retentionDays": 180,
    }
    statement = db.scalar.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "activity_logs.action = 'Delete Old Activity'" in sql


@pytest.mark.asyncio
async def test_the_cleanup_status_is_empty_before_any_cleanup() -> None:
    db = MagicMock()
    db.scalar = AsyncMock(return_value=None)

    result = await get_activity_cleanup_status(cast(AsyncSession, db))

    assert (result.lastRunAt, result.deletedCount, result.retentionDays) == (None, None, 180)


@pytest.mark.asyncio
async def test_only_it_reads_the_cleanup_status() -> None:
    with pytest.raises(HTTPException) as raised:
        await get_cleanup_status(account(AccountRole.ADMIN), cast(AsyncSession, MagicMock()))

    assert raised.value.status_code == status.HTTP_403_FORBIDDEN


def purge_db(deleted: int, latest: ActivityLog | None) -> MagicMock:
    db = MagicMock()
    db.scalar = AsyncMock(side_effect=[None, latest])
    db.execute = AsyncMock(return_value=MagicMock(rowcount=deleted))
    return db


@pytest.mark.asyncio
async def test_the_scheduled_cleanup_records_what_it_removed_as_tanaw(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = AsyncMock()
    monkeypatch.setattr(service, "create_activity_log", record)

    deleted = await run_scheduled_activity_cleanup(cast(AsyncSession, purge_db(4, None)), NOW)

    assert deleted == 4
    assert record.await_args is not None
    payload = record.await_args.args[1]
    assert (payload.action, payload.actor, payload.actorRole, payload.group) == (
        CLEANUP_ACTION,
        "TANAW",
        "System",
        "Settings & Maintenance",
    )
    assert payload.metadata == {"deletedCount": 4, "retentionDays": 180}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("latest_age", "recorded"),
    [(timedelta(hours=2), False), (timedelta(days=2), True), (None, True)],
)
async def test_an_empty_scheduled_cleanup_is_recorded_at_most_once_a_day(
    monkeypatch: pytest.MonkeyPatch, latest_age: timedelta | None, recorded: bool
) -> None:
    record = AsyncMock()
    monkeypatch.setattr(service, "create_activity_log", record)
    latest = cleanup_log(NOW - latest_age, 0) if latest_age is not None else None

    await run_scheduled_activity_cleanup(cast(AsyncSession, purge_db(0, latest)), NOW)

    assert record.await_count == (1 if recorded else 0)


@pytest.mark.asyncio
async def test_it_removing_old_activity_is_recorded_under_its_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = AsyncMock()
    monkeypatch.setattr(service, "create_activity_log", record)
    db = MagicMock()
    db.scalar = AsyncMock(return_value=None)
    db.execute = AsyncMock(return_value=MagicMock(rowcount=2))

    result = await purge_old_activity(cast(AsyncSession, db), account(AccountRole.IT))

    assert result == (2, 180)
    assert record.await_args is not None
    payload = record.await_args.args[1]
    assert (payload.actor, payload.actorRole, payload.severity) == (
        "Activity it",
        "IT Personnel",
        "Warning",
    )
