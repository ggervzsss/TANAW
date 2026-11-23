"""The local data the desktop backs up to the server, and its restore after a reset.

The backup holds what cannot be rebuilt and is needed to finish a report: the
daily totals of reporting months not yet submitted, the report drafts, and the
camera settings (camera settings never hold usernames or passwords). Raw
observations and visitor appearance data stay on this computer.

A restore only runs on an empty local database, so it can never overwrite data
recorded on this computer.
"""

import json
from datetime import date, datetime, timedelta
from typing import Any

from app.analytics.restored_day import RESTORED_BASELINE_KEY
from app.config.report_config import reporting_period_key
from app.storage.local_database import LocalDatabase
from app.storage.repositories.establishment_repository import TIMEZONE, timestamp

# Report drafts for an open month use ``period:<Month YYYY>``; revisions use ``report:<id>``.
BACKUP_DRAFT_PREFIXES = ("period:", "report:")
MAX_BACKUP_DRAFTS = 12


def backup_window_start(today: date) -> date:
    """The first day the backup covers: the start of the previous month.

    The previous month stays open for submission into the current one, so both
    months are covered until their reports are submitted.
    """
    return (today.replace(day=1) - timedelta(days=1)).replace(day=1)


def period_label(day: date) -> str:
    return day.strftime("%B %Y")


def export_local_backup(database: LocalDatabase, now: datetime) -> dict[str, Any]:
    today = now.astimezone(TIMEZONE).date()
    start = backup_window_start(today)
    with database.connection() as db:
        submitted = {
            str(row["period"]) for row in db.execute("select period from report_submissions")
        }
        days = [
            {
                "business_date": str(row["business_date"]),
                "finalized": bool(row["finalized"]),
                "metrics": json.loads(row["metrics_json"]),
            }
            for row in db.execute(
                "select business_date, metrics_json, finalized "
                "from establishment_daily_summaries "
                "where business_date>=? and business_date<=? order by business_date",
                (start.isoformat(), today.isoformat()),
            )
            if period_label(date.fromisoformat(str(row["business_date"]))) not in submitted
        ]
        drafts = [
            {
                "draft_key": str(row["draft_key"]),
                "period": str(row["period"]),
                "report_id": row["report_id"],
                "payload": json.loads(row["payload_json"]),
                "updated_at": str(row["updated_at"]),
            }
            for row in db.execute(
                "select draft_key, period, report_id, payload_json, updated_at "
                "from report_drafts order by updated_at desc"
            )
            if _backs_up_draft(str(row["draft_key"]), str(row["period"]), start, submitted)
        ][:MAX_BACKUP_DRAFTS]
    return {"days": days, "drafts": drafts}


def _backs_up_draft(draft_key: str, period: str, start: date, submitted: set[str]) -> bool:
    if draft_key.startswith("report:"):
        return True
    if not draft_key.startswith("period:") or period in submitted:
        return False
    # A month draft goes with the month's days, so it follows the same window.
    key = reporting_period_key(period)
    return key is not None and key >= (start.year, start.month)


def local_data_is_empty(database: LocalDatabase) -> bool:
    """Whether nothing has been recorded or set up on this computer yet."""
    with database.connection() as db:
        return not any(
            db.execute(f"select 1 from {table} limit 1").fetchone()
            for table in (
                "camera_profiles",
                "establishment_daily_summaries",
                "establishment_observations",
                "report_drafts",
                "report_submissions",
            )
        )


def restore_local_backup(
    database: LocalDatabase,
    *,
    days: list[dict[str, Any]],
    drafts: list[dict[str, Any]],
    now: datetime,
) -> dict[str, int]:
    """Write a backup's days and drafts into an empty local database.

    Earlier days are restored as closed days. Today's totals become the day's
    restored baseline, so the counts recorded from now on are added to them.
    """
    today = now.astimezone(TIMEZONE).date()
    restored_days = 0
    with database.transaction() as db:
        for day in days:
            business_date = date.fromisoformat(str(day["business_date"]))
            if business_date > today:
                continue
            metrics = {
                key: value for key, value in day["metrics"].items() if key != RESTORED_BASELINE_KEY
            }
            metrics["business_date"] = business_date.isoformat()
            finalized = business_date < today
            if not finalized:
                metrics = {**metrics, RESTORED_BASELINE_KEY: dict(metrics)}
            cursor = db.execute(
                "insert into establishment_daily_summaries "
                "(business_date, metrics_json, policy_version, finalized, updated_at) "
                "values (?,?,?,?,?) on conflict(business_date) do nothing",
                (
                    business_date.isoformat(),
                    json.dumps(metrics, sort_keys=True),
                    int(metrics.get("policy_version") or 0),
                    int(finalized),
                    timestamp(now),
                ),
            )
            restored_days += cursor.rowcount
        restored_drafts = 0
        for draft in drafts:
            if not str(draft["draft_key"]).startswith(BACKUP_DRAFT_PREFIXES):
                continue
            cursor = db.execute(
                "insert into report_drafts "
                "(draft_key, period, report_id, payload_json, updated_at) "
                "values (?,?,?,?,?) on conflict(draft_key) do nothing",
                (
                    str(draft["draft_key"]),
                    str(draft["period"]),
                    draft.get("report_id"),
                    json.dumps(draft["payload"], sort_keys=True),
                    str(draft["updated_at"]),
                ),
            )
            restored_drafts += cursor.rowcount
    return {"days": restored_days, "drafts": restored_drafts}
