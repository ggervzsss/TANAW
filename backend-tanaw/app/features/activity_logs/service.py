import json
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole, SystemConfiguration
from app.features.activity_logs.models import ActivityLog
from app.features.activity_logs.schemas import ActivityLogCreate, ActivityLogSummary

ROLE_LABELS = {
    AccountRole.ADMIN: "Admin",
    AccountRole.IT: "IT Personnel",
    AccountRole.STAFF: "LGU Staff",
    AccountRole.ENTERPRISE: "Enterprise Account",
}
SYSTEM_SETTINGS_ID = "default"
LOG_RETENTION_DAYS = 180
LOG_RETENTION_DAYS_SETTING_KEY = "logs.retentionDays"
ALLOWED_LOG_RETENTION_DAYS = frozenset({90, 180, 365})
ADMIN_ACTIVITY_CATEGORIES = frozenset({"Admin Operation", "Staff Submission", "Staff Operation"})
ADMIN_IT_ACTIVITY_ACTIONS = frozenset(
    {
        "Approve Enterprise Profile Change",
        "Approve Verified Email Change",
        "Create Enterprise Account",
        "Create LGU Account",
        "Decline Enterprise Profile Change",
        "Decline Verified Email Change",
        "Purge Expired Activity Logs",
        "Update Account Status",
        "Update Enterprise Account",
        "Update LGU Account",
        "Update Support Ticket Status",
        "Update System Settings",
    }
)


def get_actor_role_label(account: Account) -> str:
    return ROLE_LABELS[account.role]


def can_role_view_log(role: str, log: ActivityLog | ActivityLogSummary) -> bool:
    category = log.category
    actor_role = log.actor_role if isinstance(log, ActivityLog) else log.actorRole
    action = log.action
    severity = log.severity

    if role == AccountRole.ADMIN.value:
        return (
            category in ADMIN_ACTIVITY_CATEGORIES
            or (
                category == "IT Activity"
                and (action in ADMIN_IT_ACTIVITY_ACTIONS or action.startswith("Alert "))
            )
            or (category == "System" and severity in {"Warning", "Critical"})
            or severity == "Critical"
        )
    if role == AccountRole.IT.value:
        return (
            category in {"System", "IT Activity", "Enterprise Activity"}
            or actor_role == "IT Personnel"
        )
    return False


async def list_activity_logs_for_account(
    db: AsyncSession, account: Account, limit: int = 250
) -> list[ActivityLogSummary]:
    retention_days = await get_activity_log_retention_days(db)
    cutoff = activity_log_retention_cutoff(retention_days)
    result = await db.scalars(
        select(ActivityLog)
        .where(ActivityLog.timestamp >= cutoff)
        .order_by(ActivityLog.timestamp.desc())
        .limit(limit)
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
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return to_activity_log_summary(log)


async def get_activity_log_retention_days(db: AsyncSession) -> int:
    record = await db.scalar(
        select(SystemConfiguration).where(SystemConfiguration.id == SYSTEM_SETTINGS_ID)
    )
    return resolve_activity_log_retention_days(load_system_settings_values(record))


async def purge_expired_activity_logs(
    db: AsyncSession, retention_days: int, now: datetime | None = None
) -> int:
    cutoff = activity_log_retention_cutoff(retention_days, now)
    result = cast(
        CursorResult[Any],
        await db.execute(delete(ActivityLog).where(ActivityLog.timestamp < cutoff)),
    )
    await db.commit()
    return result.rowcount or 0


def resolve_activity_log_retention_days(values: Mapping[str, object] | None) -> int:
    values = values or {}
    stable_value = values.get(LOG_RETENTION_DAYS_SETTING_KEY)
    if isinstance(stable_value, int) and not isinstance(stable_value, bool):
        return stable_value if stable_value in ALLOWED_LOG_RETENTION_DAYS else LOG_RETENTION_DAYS

    return LOG_RETENTION_DAYS


def activity_log_retention_cutoff(retention_days: int, now: datetime | None = None) -> datetime:
    current = now or datetime.now(UTC)
    return current - timedelta(days=retention_days)


def load_system_settings_values(record: SystemConfiguration | None) -> dict[str, str | bool | int]:
    if record is None:
        return {}
    try:
        values = json.loads(record.values_json)
    except json.JSONDecodeError:
        return {}
    if not isinstance(values, dict):
        return {}
    return {
        key: value
        for key, value in values.items()
        if isinstance(key, str) and isinstance(value, str | bool | int)
    }


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
