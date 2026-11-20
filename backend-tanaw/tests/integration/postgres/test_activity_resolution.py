from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.models import ActivityLog
from app.features.activity_logs.service import (
    list_activity_logs_for_account,
    purge_expired_activity_logs,
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
