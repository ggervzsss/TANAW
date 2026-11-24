from datetime import UTC, datetime
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.activity_logs.models import ActivityLog
from app.features.activity_logs.router import list_activity_logs
from app.features.activity_logs.service import (
    can_role_view_activity,
    list_activity_logs_for_account,
    to_activity_log_summary,
)


def account(role: AccountRole) -> Account:
    return Account(
        id=f"activity-{role.value}",
        email=f"activity-{role.value}@example.com",
        password_hash="unused-password-hash",
        role=role,
        display_name=f"Activity {role.value}",
        title=role.value,
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )


def camera_log() -> ActivityLog:
    return ActivityLog(
        id="activity-log-1",
        timestamp=datetime.now(UTC),
        activity_group="Monitoring",
        severity="Warning",
        actor="TANAW",
        actor_role="System",
        action="Camera Stopped Counting",
        target="Sampaguita Gardens",
        summary="The Gate A camera at Sampaguita Gardens is not counting.",
        it_detail="Camera: Gate A · Error: the connection was refused",
    )


@pytest.mark.asyncio
async def test_staff_cannot_list_activity_logs() -> None:
    with pytest.raises(HTTPException) as captured:
        await list_activity_logs(account(AccountRole.STAFF), cast(AsyncSession, MagicMock()))

    assert captured.value.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.parametrize(
    ("role", "expected"),
    [
        (AccountRole.ADMIN, True),
        (AccountRole.IT, True),
        (AccountRole.STAFF, False),
        (AccountRole.ENTERPRISE, False),
    ],
)
def test_admin_and_it_read_every_activity_record(role: AccountRole, expected: bool) -> None:
    assert can_role_view_activity(role.value) is expected


def test_the_admin_reads_plain_wording_and_it_also_gets_the_details() -> None:
    admin_view = to_activity_log_summary(camera_log(), include_it_detail=False)
    it_view = to_activity_log_summary(camera_log(), include_it_detail=True)

    assert admin_view.group == "Monitoring"
    assert admin_view.summary == it_view.summary
    assert admin_view.itDetail is None
    assert it_view.itDetail == "Camera: Gate A · Error: the connection was refused"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("role", "with_detail"), [(AccountRole.ADMIN, False), (AccountRole.IT, True)]
)
async def test_the_listing_is_not_filtered_by_role(role: AccountRole, with_detail: bool) -> None:
    db = MagicMock()
    db.scalar = AsyncMock(return_value=None)
    db.scalars = AsyncMock(return_value=[camera_log()])

    logs = await list_activity_logs_for_account(cast(AsyncSession, db), account(role))

    assert [log.action for log in logs] == ["Camera Stopped Counting"]
    assert (logs[0].itDetail is not None) is with_detail
    statement = db.scalars.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "activity_group" not in sql.split("WHERE", 1)[1]
