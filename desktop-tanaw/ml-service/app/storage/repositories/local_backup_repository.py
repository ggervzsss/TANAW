"""The local data the desktop backs up to the server, and its restore after a reset.

The backup holds what cannot be rebuilt and is needed to finish a report: the
daily totals of reporting months not yet delivered to the server, the report
drafts, the reports still waiting to upload, and the camera settings that may
leave this computer (see ``backup_camera_policy``). Raw observations, visitor
appearance data, and camera credentials stay on this computer.

Recovery state
--------------
``server_backup_state`` records whether this database has been reconciled with
the server copy, and which server revision it last merged or saved. A new or
reset database starts unreconciled, so its desktop does not upload until it has
either merged the server copy or confirmed there is none. Local edits made while
recovery is unresolved (offline, or a failed restore) are kept, and the restore
that follows merges into them.

A restore only adds what this computer lacks and never overwrites a record
already here. The eligibility check, every restored record, and the new recovery
state are written in one transaction, so a failure leaves nothing behind and the
restore can simply run again.
"""

import json
from datetime import date, datetime, timedelta
from typing import Any

from app.analytics.restored_day import RESTORED_BASELINE_KEY, merge_restored_day
from app.config.report_config import reporting_period_key
from app.storage.backup_camera_policy import backup_camera_profile
from app.storage.local_data_serialization import _load_json_object
from app.storage.local_database import LocalDatabase
from app.storage.repositories.camera_repository import CameraRepository
from app.storage.repositories.establishment_report_repository import next_report_version
from app.storage.repositories.establishment_repository import TIMEZONE, timestamp

# Report drafts for an open month use ``period:<Month YYYY>``; revisions use ``report:<id>``.
BACKUP_DRAFT_PREFIXES = ("period:", "report:")
MAX_BACKUP_DRAFTS = 12
MAX_BACKUP_SUBMISSIONS = 12
PENDING_SYNC_STATUS = "pending_cloud_sync"


class BackupStateChangedError(ValueError):
    """Raised when the recovery state changed since the caller last read it."""


def backup_window_start(today: date) -> date:
    """The first day the backup covers: the start of the previous month.

    The previous month stays open for submission into the current one, so both
    months are covered until their reports are delivered.
    """
    return (today.replace(day=1) - timedelta(days=1)).replace(day=1)


def period_label(day: date) -> str:
    return day.strftime("%B %Y")


def backup_state(database: LocalDatabase) -> dict[str, Any]:
    with database.connection() as db:
        row = db.execute(
            "select reconciled, server_revision from server_backup_state where singleton_id=1"
        ).fetchone()
    if row is None:
        return {"reconciled": False, "server_revision": None}
    return {"reconciled": bool(row["reconciled"]), "server_revision": row["server_revision"]}


def record_server_revision(
    database: LocalDatabase,
    *,
    expected_revision: int | None,
    server_revision: int | None,
    now: datetime,
) -> dict[str, Any]:
    """Mark this database reconciled with ``server_revision``.

    Used when the server holds nothing new to merge, and after an upload is saved.
    Refused when another restore or upload changed the state since it was read.
    """
    with database.transaction() as db:
        _expect_revision(db, expected_revision)
        _write_state(db, server_revision, now)
    return {"reconciled": True, "server_revision": server_revision}


def export_local_backup(database: LocalDatabase, now: datetime) -> dict[str, Any]:
    today = now.astimezone(TIMEZONE).date()
    start = backup_window_start(today)
    with database.connection() as db:
        # Only a report the server confirmed is safe to leave out of the backup; a month
        # reopened for correction is still being worked on.
        delivered = {
            str(row["period"])
            for row in db.execute(
                "select period from report_submissions "
                "where sync_status='synced' and reopened_at is null"
            )
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
            if period_label(date.fromisoformat(str(row["business_date"]))) not in delivered
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
            if _backs_up_draft(str(row["draft_key"]), str(row["period"]), start, delivered)
        ][:MAX_BACKUP_DRAFTS]
        submissions = [
            {
                "report_id": str(row["report_id"]),
                "submission_id": str(row["submission_id"]),
                "period": str(row["period"]),
                "submitted_at": str(row["submitted_at"]),
                "entries": row["entries"],
                "exits": row["exits"],
                "peak_occupancy": row["peak_occupancy"],
                "unique_count": int(row["unique_count"] or 0),
                "notes": row["notes"],
                "payload": _load_json_object(row["payload_json"]),
                "camera_breakdown": [
                    {
                        "camera_id": total["camera_id"],
                        "camera_name": total["camera_name"],
                        "entries": int(total["entries"]),
                        "exits": int(total["exits"]),
                        "peak_occupancy": int(total["peak_occupancy"]),
                        "unique_count": int(total["unique_count"]),
                    }
                    for total in db.execute(
                        "select camera_id, camera_name, entries, exits, peak_occupancy, "
                        "unique_count from report_camera_totals where report_id=? "
                        "order by camera_id",
                        (row["report_id"],),
                    )
                ],
            }
            for row in db.execute(
                "select * from report_submissions where sync_status=? "
                "order by submitted_at desc limit ?",
                (PENDING_SYNC_STATUS, MAX_BACKUP_SUBMISSIONS),
            )
        ]
    cameras = [
        camera
        for profile in CameraRepository(database).list_profiles()
        if (camera := backup_camera_profile(profile)) is not None
    ]
    return {
        "days": days,
        "drafts": drafts,
        "submissions": submissions,
        "cameras": cameras,
        "state": backup_state(database),
    }


def _backs_up_draft(draft_key: str, period: str, start: date, delivered: set[str]) -> bool:
    if draft_key.startswith("report:"):
        return True
    if not draft_key.startswith("period:") or period in delivered:
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
    expected_revision: int | None,
    server_revision: int,
    days: list[dict[str, Any]],
    drafts: list[dict[str, Any]],
    submissions: list[dict[str, Any]] | None = None,
    cameras: list[dict[str, Any]] | None = None,
    max_cameras: int = 32,
    now: datetime,
) -> dict[str, Any]:
    """Merge a server backup into this computer's local data, in one transaction.

    Earlier days are restored as closed days. Today's totals become the day's
    restored baseline, so the counts recorded from now on are added to them. A
    record this computer already has is kept as it is.

    Returns ``restored: False`` when this database already merged ``server_revision``.
    """
    today = now.astimezone(TIMEZONE).date()
    with database.transaction() as db:
        state = _expect_revision(db, expected_revision)
        if state["reconciled"] and state["server_revision"] == server_revision:
            return {"restored": False, **dict.fromkeys(_COUNT_KEYS, 0)}
        restored_days = sum(_restore_day(db, day, today, now) for day in days)
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
        restored_submissions = sum(
            _restore_submission(db, submission) for submission in submissions or []
        )
        added_cameras = _restore_cameras(database, cameras or [], max_cameras)
        _write_state(db, server_revision, now)
    return {
        "restored": True,
        "days": restored_days,
        "drafts": restored_drafts,
        "submissions": restored_submissions,
        "cameras": len(added_cameras),
        "custom_cameras": sum(camera.get("cameraBrand") == "custom" for camera in added_cameras),
    }


_COUNT_KEYS = ("days", "drafts", "submissions", "cameras", "custom_cameras")


def _restore_day(db: Any, day: dict[str, Any], today: date, now: datetime) -> int:
    business_date = date.fromisoformat(str(day["business_date"]))
    if business_date > today:
        return 0
    metrics = {key: value for key, value in day["metrics"].items() if key != RESTORED_BASELINE_KEY}
    metrics["business_date"] = business_date.isoformat()
    finalized = business_date < today
    existing = db.execute(
        "select metrics_json, finalized from establishment_daily_summaries where business_date=?",
        (business_date.isoformat(),),
    ).fetchone()
    if existing is not None:
        # Today counted here while recovery was unresolved: the backup becomes its baseline.
        local = json.loads(existing["metrics_json"])
        if finalized or existing["finalized"] or RESTORED_BASELINE_KEY in local:
            return 0
        merged = merge_restored_day(local, metrics)
        db.execute(
            "update establishment_daily_summaries set metrics_json=?, updated_at=? "
            "where business_date=?",
            (json.dumps(merged, sort_keys=True), timestamp(now), business_date.isoformat()),
        )
        return 1
    if not finalized:
        metrics = {**metrics, RESTORED_BASELINE_KEY: dict(metrics)}
    db.execute(
        "insert into establishment_daily_summaries "
        "(business_date, metrics_json, policy_version, finalized, updated_at) "
        "values (?,?,?,?,?)",
        (
            business_date.isoformat(),
            json.dumps(metrics, sort_keys=True),
            int(metrics.get("policy_version") or 0),
            int(finalized),
            timestamp(now),
        ),
    )
    return 1


def _restore_submission(db: Any, submission: dict[str, Any]) -> int:
    """Restore a report still waiting to upload, with its original IDs."""
    clash = db.execute(
        "select 1 from report_submissions where report_id=? or submission_id=? "
        "or (period=? and reopened_at is null)",
        (submission["report_id"], submission["submission_id"], submission["period"]),
    ).fetchone()
    if clash is not None:
        return 0
    # A correction keeps the version after the month's latest version that Staff returned.
    latest = db.execute(
        "select version,reopen_reason from report_submissions where period=? "
        "order by version desc, submitted_at desc limit 1",
        (submission["period"],),
    ).fetchone()
    db.execute(
        "insert into report_submissions (report_id, submission_id, period, version, "
        "submitted_at, entries, exits, peak_occupancy, unique_count, notes, payload_json, "
        "sync_status) values (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            submission["report_id"],
            submission["submission_id"],
            submission["period"],
            next_report_version(latest),
            submission["submitted_at"],
            submission.get("entries"),
            submission.get("exits"),
            submission.get("peak_occupancy"),
            int(submission.get("unique_count") or 0),
            submission.get("notes"),
            json.dumps(submission["payload"], sort_keys=True),
            PENDING_SYNC_STATUS,
        ),
    )
    db.executemany(
        "insert into report_camera_totals (report_id, camera_id, camera_name, entries, exits, "
        "peak_occupancy, unique_count) values (?,?,?,?,?,?,?)",
        [
            (
                submission["report_id"],
                total.get("camera_id"),
                total.get("camera_name"),
                int(total.get("entries") or 0),
                int(total.get("exits") or 0),
                int(total.get("peak_occupancy") or 0),
                int(total.get("unique_count") or 0),
            )
            for total in submission.get("camera_breakdown") or []
        ],
    )
    return 1


def _restore_cameras(
    database: LocalDatabase, cameras: list[dict[str, Any]], max_cameras: int
) -> list[dict[str, Any]]:
    """Add the backed-up cameras this computer lacks; one set up here is kept as it is."""
    repository = CameraRepository(database)
    existing = repository.list_profiles()
    hosts = {str(camera.get("cameraHost")) for camera in existing}
    used_ids = {int(camera["id"]) for camera in existing}
    added: list[dict[str, Any]] = []
    for camera in cameras:
        # The restored copy passes the same allowlist as an export.
        allowed = backup_camera_profile(camera)
        if allowed is None or allowed["cameraHost"] in hosts:
            continue
        if len(existing) + len(added) >= max_cameras:
            break
        if allowed["id"] in used_ids:
            allowed["id"] = max(used_ids) + 1
        used_ids.add(allowed["id"])
        hosts.add(allowed["cameraHost"])
        # A restored camera has no saved password yet, so it is tested again.
        added.append({**allowed, "status": "untested"})
    if added:
        repository.replace_profiles([*existing, *added])
    return added


def _expect_revision(db: Any, expected_revision: int | None) -> dict[str, Any]:
    row = db.execute(
        "select reconciled, server_revision from server_backup_state where singleton_id=1"
    ).fetchone()
    state = (
        {"reconciled": bool(row["reconciled"]), "server_revision": row["server_revision"]}
        if row is not None
        else {"reconciled": False, "server_revision": None}
    )
    if state["server_revision"] != expected_revision:
        raise BackupStateChangedError(
            "The local backup state changed since it was read. Check the server backup again."
        )
    return state


def _write_state(db: Any, server_revision: int | None, now: datetime) -> None:
    db.execute(
        "insert into server_backup_state (singleton_id, reconciled, server_revision, updated_at) "
        "values (1, 1, ?, ?) on conflict(singleton_id) do update set reconciled=1, "
        "server_revision=excluded.server_revision, updated_at=excluded.updated_at",
        (server_revision, timestamp(now)),
    )
