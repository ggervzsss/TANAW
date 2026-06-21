import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.models import ActivityLog
from app.features.activity_logs.schemas import ActivityLogCreate, ActivityLogSummary

ROLE_LABELS = {
    AccountRole.ADMIN: "Admin",
    AccountRole.IT: "IT Personnel",
    AccountRole.STAFF: "LGU Staff",
    AccountRole.ENTERPRISE: "Enterprise Account",
}


def get_actor_role_label(account: Account) -> str:
    return ROLE_LABELS[account.role]


def can_role_view_log(role: str, log: ActivityLog | ActivityLogSummary) -> bool:
    category = log.category
    actor_role = log.actor_role if isinstance(log, ActivityLog) else log.actorRole

    if role == AccountRole.ADMIN.value:
        return True
    if role == AccountRole.IT.value:
        return (
            category in {"System", "IT Activity", "Enterprise Activity"}
            or actor_role == "IT Personnel"
        )
    if role == AccountRole.STAFF.value:
        return category in {"Staff Submission", "Staff Operation"}
    return False


async def list_activity_logs_for_account(
    db: AsyncSession, account: Account, limit: int = 250
) -> list[ActivityLogSummary]:
    result = await db.scalars(
        select(ActivityLog).order_by(ActivityLog.timestamp.desc()).limit(limit)
    )
    return [
        to_activity_log_summary(log) for log in result if can_role_view_log(account.role.value, log)
    ]


async def create_activity_log(db: AsyncSession, payload: ActivityLogCreate) -> ActivityLogSummary:
    log = ActivityLog(
        category=payload.category,
        severity=payload.severity,
        actor=payload.actor,
        actor_role=payload.actorRole,
        action=payload.action,
        target=payload.target,
        summary=payload.summary,
        source_id=payload.sourceId,
        metadata_json=json.dumps(payload.metadata) if payload.metadata else None,
        source_kind=payload.sourceKind,
        mock_run_id=payload.mockRunId,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return to_activity_log_summary(log)


def to_activity_log_summary(log: ActivityLog) -> ActivityLogSummary:
    return ActivityLogSummary(
        id=log.id,
        timestamp=log.timestamp,
        category=log.category,  # type: ignore[arg-type]
        severity=log.severity,  # type: ignore[arg-type]
        actor=log.actor,
        actorRole=log.actor_role,  # type: ignore[arg-type]
        action=log.action,
        target=log.target,
        summary=log.summary,
        sourceId=log.source_id,
        metadata=json.loads(log.metadata_json) if log.metadata_json else None,
    )
