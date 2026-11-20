from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.models import ActivityLog
from app.features.activity_logs.service import (
    can_role_view_log,
    list_activity_logs_for_account,
    purge_expired_activity_logs,
    role_visibility_clause,
)
from app.features.monitoring.models import OperationalAlert
from app.features.monitoring.router import update_alert_status
from app.features.monitoring.schemas import OperationalAlertStatusUpdate
from tests.support.postgres import postgres_test_database_url


@pytest.mark.asyncio
async def test_important_activity_tracks_it_resolution_without_rewriting_history() -> None:
    engine = create_async_engine(postgres_test_database_url())
    try:
        async with AsyncSession(engine) as db:
            issue = OperationalAlert(
                alert_code=f"ALT-{uuid4().hex[:12]}",
                alert_type="Maintenance Request",
                severity="Warning",
                requester="Test establishment",
                summary="The camera stopped reporting.",
                required_action="Check the connection.",
                resolution_mode="Remote Review",
                owner="IT",
            )
            db.add(issue)
            await db.flush()
            activity = ActivityLog(
                timestamp=datetime.now(UTC) - timedelta(days=400),
                category="Enterprise Activity",
                severity="Warning",
                actor="Test establishment",
                actor_role="Enterprise Account",
                action="Desktop Application Problem",
                target="Test establishment",
                summary=issue.summary,
                source_id=issue.id,
            )
            db.add(activity)
            await db.flush()
            admin = Account(role=AccountRole.ADMIN, display_name="Admin")
            it = Account(role=AccountRole.IT, display_name="IT")

            await purge_expired_activity_logs(db, 180)

            # An older open issue is returned independently of the history limit.
            pending = await list_activity_logs_for_account(db, admin, limit=0)
            assert (
                next(row for row in pending if row.id == activity.id).resolutionStatus
                == "Unresolved"
            )

            update = OperationalAlertStatusUpdate(status="Resolved")
            with pytest.raises(HTTPException) as denied:
                await update_alert_status(issue.alert_code, update, admin, db)
            assert denied.value.status_code == 403

            await update_alert_status(issue.alert_code, update, it, db)
            await purge_expired_activity_logs(db, 180)
            history = await list_activity_logs_for_account(db, admin, limit=1000)
            resolved = next(row for row in history if row.id == activity.id)
            assert resolved.resolutionStatus == "Resolved"
            assert resolved.timestamp == activity.timestamp
            assert resolved.summary == activity.summary
            assert not any(
                row.id == activity.id
                for row in await list_activity_logs_for_account(db, admin, limit=0)
            )
    finally:
        await engine.dispose()


VISIBILITY_CASES = [
    ("Staff Submission", "Info", "LGU Staff", "Submit Report"),
    ("Admin Operation", "Success", "Admin", "Update Account Status"),
    ("IT Activity", "Success", "IT Personnel", "Update System Settings"),
    ("IT Activity", "Success", "IT Personnel", "Alert Resolved"),
    ("IT Activity", "Success", "IT Personnel", "Retry Email Delivery"),
    ("System", "Warning", "System", "Camera Offline"),
    ("System", "Success", "System", "Alert Resolved"),
    ("System", "Info", "System", "Nightly Cleanup"),
    ("Enterprise Activity", "Warning", "Enterprise Account", "Submit Support Ticket"),
    ("Enterprise Activity", "Info", "Enterprise Account", "Submit Support Ticket"),
    ("Enterprise Activity", "Warning", "Enterprise Account", "Desktop Application Problem"),
    ("Enterprise Activity", "Info", "Enterprise Account", "Login"),
    ("Enterprise Activity", "Critical", "Enterprise Account", "Security Incident"),
]


def _log(marker: str, case: tuple[str, str, str, str], at: datetime) -> ActivityLog:
    category, severity, actor_role, action = case
    return ActivityLog(
        timestamp=at,
        category=category,
        severity=severity,
        actor="Test actor",
        actor_role=actor_role,
        action=action,
        target="Test target",
        summary=f"{action} ({category}, {severity})",
        source_id=f"{marker}:{uuid4().hex}",
    )


@pytest.mark.asyncio
async def test_sql_visibility_matches_the_role_rules() -> None:
    engine = create_async_engine(postgres_test_database_url())
    marker = f"visibility-{uuid4().hex}"
    try:
        async with AsyncSession(engine) as db:
            logs = [_log(marker, case, datetime.now(UTC)) for case in VISIBILITY_CASES]
            db.add_all(logs)
            await db.flush()
            for role in (AccountRole.ADMIN, AccountRole.IT, AccountRole.STAFF):
                visible = set(
                    await db.scalars(
                        select(ActivityLog.id).where(
                            ActivityLog.source_id.startswith(marker),
                            role_visibility_clause(role.value),
                        )
                    )
                )
                expected = {log.id for log in logs if can_role_view_log(role.value, log)}
                assert visible == expected, role
            await db.rollback()
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_listing_limit_counts_only_logs_the_role_can_see() -> None:
    engine = create_async_engine(postgres_test_database_url())
    marker = f"limit-{uuid4().hex}"
    soon = datetime.now(UTC) + timedelta(days=1)
    try:
        async with AsyncSession(engine) as db:
            hidden = ("Enterprise Activity", "Info", "Enterprise Account", "Login")
            shown = ("Staff Submission", "Info", "LGU Staff", "Submit Report")
            # Newer logs the admin cannot see must not use up the page.
            db.add_all([_log(marker, hidden, soon + timedelta(hours=hour)) for hour in range(3)])
            db.add_all([_log(marker, shown, soon - timedelta(hours=hour)) for hour in range(2)])
            await db.flush()
            admin = Account(role=AccountRole.ADMIN, display_name="Admin")

            page = await list_activity_logs_for_account(db, admin, limit=2)

            assert [log.action for log in page if (log.sourceId or "").startswith(marker)] == [
                "Submit Report",
                "Submit Report",
            ]
            await db.rollback()
    finally:
        await engine.dispose()
