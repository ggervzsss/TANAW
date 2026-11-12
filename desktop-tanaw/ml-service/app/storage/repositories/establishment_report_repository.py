"""One authoritative, immutable metric snapshot per report submission operation."""

import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.config.report_config import reporting_period_key, reporting_period_submission_error
from app.storage.local_database import LocalDatabase
from app.storage.repositories.establishment_repository import (
    TIMEZONE,
    EstablishmentRepository,
)

DEMO_FIELDS = (
    "thisProvMale",
    "thisProvFemale",
    "otherProvMale",
    "otherProvFemale",
    "foreignMale",
    "foreignFemale",
)


def period_bounds(period: str) -> tuple[datetime, datetime]:
    key = reporting_period_key(period)
    if key is None:
        raise ValueError("Reporting period must use Month YYYY.")
    year, month = key
    return (
        datetime(year, month, 1, tzinfo=TIMEZONE),
        datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=TIMEZONE),
    )


def report_metrics(snapshot: dict[str, Any]) -> dict[str, int | None]:
    measured = snapshot["movement_state"] != "unavailable"
    return {
        "entries": snapshot["entries"] if measured else None,
        "exits": snapshot["exits"] if measured else None,
        "peak_occupancy": snapshot["peak_occupancy"],
        "unique_count": snapshot["unique_count"],
    }


class EstablishmentReportRepository:
    def __init__(self, database: LocalDatabase) -> None:
        self.database = database
        self.establishment = EstablishmentRepository(database)

    def periods(self) -> list[dict[str, Any]]:
        with self.database.connection() as db:
            months = [
                row[0]
                for row in db.execute(
                    "select distinct substr(business_date,1,7) from establishment_daily_summaries "
                    "where json_extract(metrics_json,'$.covered_ms')>0 "
                    "or json_extract(metrics_json,'$.qualified_observations')>0 order by 1 desc"
                )
            ]
        return [
            self.period_summary(datetime.strptime(month, "%Y-%m").strftime("%B %Y"))
            for month in months
        ]

    def period_summary(self, period: str) -> dict[str, Any]:
        begin, end = period_bounds(period)
        snapshot = self.establishment.summary(begin, end)
        return {
            "period": begin.strftime("%B %Y"),
            "metrics": report_metrics(snapshot),
            "counting": snapshot,
        }

    def submit(
        self,
        report_id: str,
        period: str,
        notes: str | None = None,
        payload: dict[str, Any] | None = None,
        metrics: dict[str, Any] | None = None,
        *,
        request_id: str | None = None,
        expected_snapshot_version: str | None = None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        now = now or datetime.now(UTC)
        error = reporting_period_submission_error(period, now)
        if error:
            raise ValueError(error)
        begin, end = period_bounds(period)
        period = begin.strftime("%B %Y")
        request_id = request_id or str(uuid4())
        supplied = json.loads(json.dumps(payload or {}))
        status = supplied.get("status", "Submitted")
        if status not in {"Submitted", "Resubmitted"}:
            raise ValueError("Choose a valid report submission action.")
        digest = hashlib.sha256(
            json.dumps(
                {
                    "report_id": report_id,
                    "period": period,
                    "notes": notes,
                    "payload": supplied,
                    "metrics": metrics,
                    "expected_snapshot_version": expected_snapshot_version,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()

        with self.database.transaction() as db:
            retried = db.execute(
                "select request_digest,response_json from report_submission_snapshots where submission_id=?",
                (request_id,),
            ).fetchone()
            if retried is not None:
                if retried["request_digest"] != digest:
                    raise ValueError(
                        "This submission operation was already used for different report data."
                    )
                return json.loads(retried["response_json"])
            existing = db.execute(
                "select * from report_submissions where report_id=?", (report_id,)
            ).fetchone()
            duplicate = db.execute(
                "select report_id from report_submissions where period=?", (period,)
            ).fetchone()
            if duplicate is not None and duplicate["report_id"] != report_id:
                raise ValueError(f"A report for {period} has already been submitted.")
            if existing is not None and existing["period"] != period:
                raise ValueError("A saved report cannot be moved to another reporting period.")
            if (existing is not None) != (status == "Resubmitted"):
                raise ValueError("Use the revision workflow to change a saved report.")

            frozen = json.loads(existing["payload_json"]).get("counting") if existing else None
            if frozen and expected_snapshot_version == frozen.get("snapshot_version"):
                snapshot = frozen
            else:
                snapshot = self.establishment.summary(begin, end)
            if snapshot["reconciliation_state"] in {"not_collected", "configuration_required"}:
                raise ValueError(
                    "Collect observations and complete camera counting setup before submitting this period."
                )
            if snapshot["identification_state"] == "unavailable":
                raise ValueError("A visitor estimate is unavailable for this period.")
            if (
                expected_snapshot_version
                and expected_snapshot_version != snapshot["snapshot_version"]
            ):
                raise ValueError(
                    "The reconciled counts changed. Refresh the period before submitting."
                )
            authoritative = report_metrics(snapshot)
            if metrics is not None and metrics != authoritative:
                raise ValueError(
                    "Report metrics do not match the reconciled snapshot. Refresh the period."
                )
            demo = supplied.get("demo")
            if isinstance(demo, dict):
                demo = {
                    field: "0" if demo.get(field) == "" else demo.get(field)
                    for field in DEMO_FIELDS
                }
            if not isinstance(demo, dict) or any(
                not isinstance(demo.get(field), str | int)
                or isinstance(demo.get(field), bool)
                or not str(demo[field]).strip().isdigit()
                for field in DEMO_FIELDS
            ):
                raise ValueError("All demographic fields must contain non-negative whole numbers.")
            if sum(int(str(demo[field])) for field in DEMO_FIELDS) != authoritative["unique_count"]:
                raise ValueError("Demographic totals must match the reconciled visitor estimate.")
            supplied["demo"] = demo
            supplied.update(
                counting=snapshot,
                metrics={
                    "entries": authoritative["entries"],
                    "exits": authoritative["exits"],
                    "peak": authoritative["peak_occupancy"],
                    "unique": authoritative["unique_count"],
                },
                notes=notes or "",
                period=period,
                status=status,
            )
            submitted_at = now.astimezone(UTC).isoformat()
            db.execute(
                """insert into report_submissions (
                    report_id,submission_id,period,submitted_at,entries,exits,peak_occupancy,
                    unique_count,notes,payload_json,sync_status)
                    values (?,?,?,?,?,?,?,?,?,?,'pending_cloud_sync')
                on conflict(report_id) do update set submission_id=excluded.submission_id,
                    submitted_at=excluded.submitted_at,entries=excluded.entries,exits=excluded.exits,
                    peak_occupancy=excluded.peak_occupancy,unique_count=excluded.unique_count,
                    notes=excluded.notes,payload_json=excluded.payload_json,
                    sync_status='pending_cloud_sync',synced_at=null""",
                (
                    report_id,
                    request_id,
                    period,
                    submitted_at,
                    authoritative["entries"],
                    authoritative["exits"],
                    authoritative["peak_occupancy"],
                    authoritative["unique_count"],
                    notes,
                    json.dumps(supplied, sort_keys=True),
                ),
            )
            # Raw doorway events are supporting evidence, not the reporting baseline.
            # Consume only the selected local calendar month; area records remain separate.
            db.execute(
                "update count_events set submitted_report_id=? where submitted_report_id is null "
                "and recorded_at>=? and recorded_at<?",
                (report_id, begin.astimezone(UTC).isoformat(), end.astimezone(UTC).isoformat()),
            )
            response = {
                **authoritative,
                "report_id": report_id,
                "submission_id": request_id,
                "period": period,
                "submitted_at": submitted_at,
                "sync_status": "pending_cloud_sync",
                "payload": supplied,
                "counting": snapshot,
                "camera_breakdown": [],
            }
            db.execute(
                "insert into report_submission_snapshots values (?,?,?,?,?)",
                (request_id, report_id, digest, json.dumps(response, sort_keys=True), submitted_at),
            )
            return response
