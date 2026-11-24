import json
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole, SystemConfiguration
from app.features.activity_logs.models import ActivityLog
from app.features.activity_logs.schemas import (
    ActivityGroup,
    ActivityLogActorRole,
    ActivityLogCreate,
    ActivityLogSummary,
)

ROLE_LABELS: dict[AccountRole, ActivityLogActorRole] = {
    AccountRole.ADMIN: "Admin",
    AccountRole.IT: "IT Personnel",
    AccountRole.STAFF: "LGU Staff",
    AccountRole.ENTERPRISE: "Enterprise Account",
}


SYSTEM_SETTINGS_ID = "default"
LOG_RETENTION_DAYS = 180
LOG_RETENTION_DAYS_SETTING_KEY = "logs.retentionDays"
ALLOWED_LOG_RETENTION_DAYS = frozenset({90, 180, 365})
ACTIVITY_READER_ROLES = frozenset({AccountRole.ADMIN, AccountRole.IT})


def get_actor_role_label_for_role(role: AccountRole) -> ActivityLogActorRole:
    return ROLE_LABELS[role]


def get_actor_role_label(account: Account) -> ActivityLogActorRole:
    return get_actor_role_label_for_role(account.role)


def can_role_view_activity(role: str) -> bool:
    """Admin and IT read every activity record; nobody else reads Activity."""
    return role in {AccountRole.ADMIN.value, AccountRole.IT.value}


def includes_it_detail(role: str) -> bool:
    return role == AccountRole.IT.value


async def list_activity_logs_for_account(
    db: AsyncSession, account: Account, limit: int = 250
) -> list[ActivityLogSummary]:
    if account.role not in ACTIVITY_READER_ROLES:
        return []
    retention_days = await get_activity_log_retention_days(db)
    cutoff = activity_log_retention_cutoff(retention_days)
    result = await db.scalars(
        select(ActivityLog)
        .where(ActivityLog.timestamp >= cutoff)
        .order_by(ActivityLog.timestamp.desc(), ActivityLog.id.desc())
        .limit(limit)
    )
    with_detail = includes_it_detail(account.role.value)
    return [to_activity_log_summary(log, include_it_detail=with_detail) for log in result]


async def create_activity_log(db: AsyncSession, payload: ActivityLogCreate) -> ActivityLogSummary:
    log = ActivityLog(
        activity_group=payload.group,
        severity=payload.severity,
        actor=payload.actor,
        actor_role=payload.actorRole,
        action=payload.action,
        target=payload.target,
        summary=payload.summary,
        source_id=payload.sourceId,
        it_detail=payload.itDetail,
        metadata_json=json.dumps(payload.metadata) if payload.metadata else None,
    )
    db.add(log)
    await db.flush()
    await db.refresh(log)
    return to_activity_log_summary(log, include_it_detail=True)


async def record_activity_log(
    db: AsyncSession,
    *,
    group: ActivityGroup,
    severity: str,
    actor: str,
    actor_role: str,
    action: str,
    target: str,
    summary: str,
    source_id: str | None,
    it_detail: str | None = None,
    metadata: dict[str, str | int | float | bool | None] | None = None,
) -> None:
    """Record one activity: a plain summary for everyone, plus optional details for IT."""
    await create_activity_log(
        db,
        ActivityLogCreate(
            group=group,
            severity=severity,  # type: ignore[arg-type]
            actor=actor,
            actorRole=actor_role,  # type: ignore[arg-type]
            action=action,
            target=target,
            summary=summary,
            itDetail=it_detail,
            sourceId=source_id,
            metadata=metadata,
        ),
    )


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


def to_activity_log_summary(log: ActivityLog, *, include_it_detail: bool) -> ActivityLogSummary:
    return ActivityLogSummary(
        id=log.id,
        timestamp=log.timestamp,
        group=log.activity_group,  # type: ignore[arg-type]
        severity=log.severity,  # type: ignore[arg-type]
        actor=log.actor,
        actorRole=log.actor_role,  # type: ignore[arg-type]
        action=log.action,
        target=log.target,
        summary=log.summary,
        itDetail=log.it_detail if include_it_detail else None,
        sourceId=log.source_id,
        metadata=json.loads(log.metadata_json) if log.metadata_json else None,
    )
