from datetime import UTC, datetime
from typing import cast
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.activity_logs.router import list_activity_logs
from app.features.activity_logs.schemas import ActivityLogSummary
from app.features.activity_logs.service import can_role_view_log


def staff_account() -> Account:
    return Account(
        id="activity-log-staff-1",
        email="activity-log-staff@example.com",
        password_hash="unused-password-hash",
        role=AccountRole.STAFF,
        display_name="Activity Log Staff",
        title="LGU Staff",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )


def staff_submission_log() -> ActivityLogSummary:
    return ActivityLogSummary(
        id="activity-log-1",
        timestamp=datetime.now(UTC),
        category="Staff Submission",
        severity="Info",
        actor="Activity Log Staff",
        actorRole="LGU Staff",
        action="Submit Report",
        target="Report REP-001",
        summary="A staff report was submitted.",
    )


@pytest.mark.asyncio
async def test_staff_cannot_list_activity_logs() -> None:
    with pytest.raises(HTTPException) as captured:
        await list_activity_logs(
            staff_account(),
            cast(AsyncSession, MagicMock()),
        )

    assert captured.value.status_code == status.HTTP_403_FORBIDDEN
    assert captured.value.detail == "Admin or IT Personnel access required."


def test_staff_cannot_receive_activity_log_broadcasts() -> None:
    assert not can_role_view_log(AccountRole.STAFF.value, staff_submission_log())
    assert can_role_view_log(AccountRole.ADMIN.value, staff_submission_log())
