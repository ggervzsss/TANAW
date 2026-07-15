import json
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import and_, delete, false, or_, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.core.keyset_pagination import decode_cursor, encode_cursor, filter_fingerprint
from app.core.pagination_schemas import CursorPageInfo
from app.features.accounts.models import Account, AccountRole
from app.features.accounts.settings import get_system_settings, system_settings_values
from app.features.activity_logs.models import ActivityLog
from app.features.activity_logs.schemas import (
    ActivityLogCreate,
    ActivityLogPage,
    ActivityLogSummary,
)
from app.features.events.operational_resources import enqueue_operational_resource_event

ROLE_LABELS = {
    AccountRole.ADMIN: "Admin",
    AccountRole.IT: "IT Personnel",
    AccountRole.STAFF: "LGU Staff",
    AccountRole.ENTERPRISE: "Enterprise Account",
}
LOG_RETENTION_DAYS = 180
LOG_RETENTION_DAYS_SETTING_KEY = "logs.retentionDays"
ALLOWED_LOG_RETENTION_DAYS = frozenset({90, 180, 365})


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
    db: AsyncSession, account: Account, *, limit: int, cursor: str | None
) -> ActivityLogPage:
    retention_days = await get_activity_log_retention_days(db)
    cutoff = activity_log_retention_cutoff(retention_days)
    fingerprint = filter_fingerprint(
        {"accountId": str(account.id), "role": account.role.value, "classification": "official"}
    )
    role_scope: ColumnElement[bool] = false()
    if account.role == AccountRole.ADMIN:
        role_scope = ActivityLog.id.is_not(None)
    elif account.role == AccountRole.IT:
        role_scope = or_(
            ActivityLog.category.in_({"System", "IT Activity", "Enterprise Activity"}),
            ActivityLog.actor_role == "IT Personnel",
        )
    elif account.role == AccountRole.STAFF:
        role_scope = ActivityLog.category.in_({"Staff Submission", "Staff Operation"})
    statement = (
        select(ActivityLog)
        .where(
            ActivityLog.timestamp >= cutoff,
            ActivityLog.classification == "official",
            role_scope,
        )
        .order_by(ActivityLog.timestamp.desc(), ActivityLog.id.desc())
        .limit(limit + 1)
    )
    if cursor is not None:
        cursor_at, cursor_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            or_(
                ActivityLog.timestamp < cursor_at,
                and_(ActivityLog.timestamp == cursor_at, ActivityLog.id < cursor_id),
            )
        )
    rows = (await db.scalars(statement)).all()
    selected = rows[:limit]
    has_more = len(rows) > limit
    next_cursor = (
        encode_cursor(
            occurred_at=selected[-1].timestamp,
            resource_id=selected[-1].id,
            fingerprint=fingerprint,
        )
        if has_more and selected
        else None
    )
    items = [to_activity_log_summary(log) for log in selected]
    return ActivityLogPage(
        items=items,
        page=CursorPageInfo(
            limit=limit,
            returnedCount=len(items),
            hasMore=has_more,
            nextCursor=next_cursor,
        ),
    )


async def create_activity_log(
    db: AsyncSession,
    payload: ActivityLogCreate,
    *,
    actor_account_id: str | None = None,
) -> ActivityLogSummary:
    log = ActivityLog(
        category=payload.category,
        severity=payload.severity,
        actor=payload.actor,
        actor_account_id=actor_account_id,
        actor_role=payload.actorRole,
        action=payload.action,
        target=payload.target,
        summary=payload.summary,
        source_id=payload.sourceId,
        metadata_json=json.dumps(payload.metadata) if payload.metadata else None,
        classification="official",
        simulation_run_id=None,
    )
    db.add(log)
    await db.flush([log])
    await db.refresh(log)
    await enqueue_operational_resource_event(
        db,
        event_type="activity_log.created.v2",
        aggregate_type="activity_log",
        aggregate_id=log.id,
        aggregate_version=1,
        payload={
            "activityLogId": log.id,
            "category": log.category,
            "actorRole": log.actor_role,
        },
        actor_account_id=actor_account_id,
    )
    return to_activity_log_summary(log)


async def get_activity_log_retention_days(db: AsyncSession) -> int:
    return resolve_activity_log_retention_days(
        system_settings_values(await get_system_settings(db))
    )


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
