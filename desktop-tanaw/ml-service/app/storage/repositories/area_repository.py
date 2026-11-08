"""Enterprise-scoped, idempotent visit storage. Never writes the doorway ledger."""

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from math import ceil
from typing import Any
from uuid import uuid4

from app.storage.local_database import LocalDatabase

BUCKET_EDGES = (60_000, 300_000, 900_000, 1_800_000)


def parse(value: str) -> datetime:
    result = datetime.fromisoformat(value)
    if result.tzinfo is None:
        raise ValueError("Analytics timestamps require a timezone.")
    return result.astimezone(UTC)


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def bucket_index(duration: int) -> int:
    return next((i for i, edge in enumerate(BUCKET_EDGES) if duration < edge), 4)


def covered_seconds(spans: list[tuple[datetime, datetime]]) -> float:
    """Union coverage when a backward wall-clock correction overlaps two runs."""
    total = 0.0
    previous_end: datetime | None = None
    for start, end in sorted(spans):
        effective_start = max(start, previous_end) if previous_end is not None else start
        total += max(0.0, (end - effective_start).total_seconds())
        previous_end = max(previous_end, end) if previous_end is not None else end
    return total


class AreaRepository:
    def __init__(self, database: LocalDatabase) -> None:
        self.database = database

    def start(
        self, run_id: str, camera_id: int, camera_name: str, config: dict[str, Any], at: str
    ) -> str:
        canonical = json.dumps(config, sort_keys=True, separators=(",", ":"))
        with self.database.connection() as db:
            db.execute("begin immediate")
            latest = db.execute(
                "select revision_id,config_json from camera_analysis_revisions where camera_id=? order by created_at desc,rowid desc limit 1",
                (camera_id,),
            ).fetchone()
            revision = (
                latest["revision_id"]
                if latest and latest["config_json"] == canonical
                else uuid4().hex
            )
            # Only the lifecycle owner starts a camera. Previous active runs are crash remnants.
            stale = db.execute(
                "select run_id from analysis_runs where camera_id=? and ended_at is null",
                (camera_id,),
            ).fetchall()
            for row in stale:
                self._end(db, row["run_id"], "process_interrupted", at)
            db.execute(
                "insert or ignore into camera_analysis_revisions values (?,?,?,?,?,?)",
                (revision, camera_id, camera_name, config["zone_name"], canonical, at),
            )
            db.execute(
                "insert into analysis_runs (run_id,revision_id,camera_id,started_at,last_checkpoint_at,ended_at,termination_reason) values (?,?,?,?,?,?,?)",
                (run_id, revision, camera_id, at, at, None, None),
            )
        self.cleanup(parse(at))
        return str(revision)

    def _save(self, db: sqlite3.Connection, run_id: str, record: dict[str, Any]) -> None:
        old = db.execute(
            "select status from area_visits where visit_id=?", (record["visit_id"],)
        ).fetchone()
        if old is not None and old["status"] != "active":
            return
        run = db.execute("select * from analysis_runs where run_id=?", (run_id,)).fetchone()
        if run is None:
            raise ValueError("Unknown analysis run.")
        db.execute(
            """insert into area_visits values (?,?,?,?,?,?,?,?,?,?)
            on conflict(visit_id) do update set status=excluded.status, ended_at=excluded.ended_at,
            qualified=excluded.qualified, estimated_dwell_ms=excluded.estimated_dwell_ms,
            payload_json=excluded.payload_json where area_visits.status='active'""",
            (
                record["visit_id"],
                run_id,
                run["revision_id"],
                run["camera_id"],
                record["status"],
                record["first_inside_at"],
                record["ended_at"],
                int(record["qualified"]),
                record["estimated_dwell_ms"],
                json.dumps(record, sort_keys=True),
            ),
        )
        if record["status"] not in {"completed", "incomplete"} or not record["qualified"]:
            return
        at = parse(record["ended_at"]).replace(minute=0, second=0, microsecond=0).isoformat()
        completed = int(record["status"] == "completed")
        self._ensure_bucket(db, run, at)
        current = db.execute(
            "select buckets_json from area_hourly_rollups where revision_id=? and bucket=?",
            (run["revision_id"], at),
        ).fetchone()
        buckets = json.loads(current["buckets_json"])
        if completed:
            buckets[bucket_index(record["estimated_dwell_ms"])] += 1
        db.execute(
            """update area_hourly_rollups set completed_count=completed_count+?,
            incomplete_count=incomplete_count+?, duration_sum_ms=duration_sum_ms+?, buckets_json=?
            where revision_id=? and bucket=?""",
            (
                completed,
                1 - completed,
                record["estimated_dwell_ms"] if completed else 0,
                json.dumps(buckets),
                run["revision_id"],
                at,
            ),
        )

    def _ensure_bucket(self, db: sqlite3.Connection, run: sqlite3.Row, at: str) -> None:
        db.execute(
            "insert or ignore into area_hourly_rollups (revision_id,camera_id,bucket) values (?,?,?)",
            (run["revision_id"], run["camera_id"], at),
        )

    def checkpoint(
        self,
        run_id: str,
        records: list[dict[str, Any]],
        finished: list[dict[str, Any]],
        snapshot: dict[str, Any],
        at: str,
    ) -> None:
        with self.database.connection() as db:
            db.execute("begin immediate")
            run = db.execute("select * from analysis_runs where run_id=?", (run_id,)).fetchone()
            if run is None or run["ended_at"] is not None:
                return
            for record in [*records, *finished]:
                self._save(db, run_id, record)
            previous = db.execute(
                "select * from area_presence_intervals where run_id=? order by interval_id desc limit 1",
                (run_id,),
            ).fetchone()
            available = bool(snapshot["available"] and snapshot["presence"] is not None)
            continuous = bool(
                previous and run["available"] and previous["end_at"] == run["last_checkpoint_at"]
            )
            if continuous and previous is not None:
                db.execute(
                    "update area_presence_intervals set end_at=? where interval_id=?",
                    (at, previous["interval_id"]),
                )
                start, end = parse(run["last_checkpoint_at"]), parse(at)
                while start < end:
                    hour = start.replace(minute=0, second=0, microsecond=0)
                    stop = min(end, hour + timedelta(hours=1))
                    self._ensure_bucket(db, run, hour.isoformat())
                    db.execute(
                        "update area_hourly_rollups set covered_ms=covered_ms+?, peak_presence=max(peak_presence,?) where revision_id=? and bucket=?",
                        (
                            round((stop - start).total_seconds() * 1000),
                            previous["presence"],
                            run["revision_id"],
                            hour.isoformat(),
                        ),
                    )
                    start = stop
            if available:
                presence, missing = snapshot["presence"], snapshot["temporarily_missing"]
                if not (
                    continuous
                    and previous is not None
                    and previous["presence"] == presence
                    and previous["missing"] == missing
                ):
                    db.execute(
                        "insert or ignore into area_presence_intervals (run_id,revision_id,camera_id,start_at,end_at,presence,missing) values (?,?,?,?,?,?,?)",
                        (run_id, run["revision_id"], run["camera_id"], at, at, presence, missing),
                    )
            db.execute(
                "update analysis_runs set last_checkpoint_at=?,available=? where run_id=?",
                (at, int(available), run_id),
            )

    def _end(self, db: sqlite3.Connection, run_id: str, reason: str, at: str) -> None:
        rows = db.execute(
            "select payload_json from area_visits where run_id=? and status='active'", (run_id,)
        ).fetchall()
        for row in rows:
            record = json.loads(row["payload_json"])
            record.update(
                status="incomplete" if record["qualified"] else "excluded",
                ended_at=record["last_inside_at"],
                finalized_at=at,
                termination_reason=reason,
            )
            self._save(db, run_id, record)
        db.execute(
            "update analysis_runs set ended_at=?,termination_reason=? where run_id=? and ended_at is null",
            (at, reason, run_id),
        )

    def recover(self) -> None:
        with self.database.connection() as db:
            db.execute("begin immediate")
            for run in db.execute(
                "select run_id,last_checkpoint_at from analysis_runs where ended_at is null"
            ).fetchall():
                self._end(db, run["run_id"], "process_interrupted", run["last_checkpoint_at"])

    def end(self, run_id: str, reason: str, at: str) -> None:
        with self.database.connection() as db:
            db.execute("begin immediate")
            self._end(db, run_id, reason, at)

    def revisions(self, camera_id: int) -> list[dict[str, Any]]:
        with self.database.connection() as db:
            return [
                dict(row)
                for row in db.execute(
                    "select revision_id,camera_id,camera_name,zone_name,created_at from camera_analysis_revisions where camera_id=? order by created_at desc,rowid desc",
                    (camera_id,),
                )
            ]

    def query(
        self,
        camera_id: int,
        start: datetime,
        end: datetime,
        revision_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        if start.tzinfo is None or end.tzinfo is None or not start < end:
            raise ValueError("Select a valid timezone-aware time range.")
        if end - start > timedelta(days=30):
            raise ValueError("Detailed analytics supports at most 30 days.")
        start, end = start.astimezone(UTC), end.astimezone(UTC)
        revisions = self.revisions(camera_id)
        selected = revision_id or (revisions[0]["revision_id"] if revisions else None)
        if revision_id is not None and not any(
            row["revision_id"] == revision_id for row in revisions
        ):
            raise ValueError("Select a configuration belonging to this camera and enterprise.")
        where = "camera_id=? and revision_id=? and coalesce(ended_at,first_inside_at)>=? and coalesce(ended_at,first_inside_at)<?"
        params = (camera_id, selected, start.isoformat(), end.isoformat())
        with self.database.connection() as db:
            db.execute("begin")
            last_observed = db.execute(
                "select max(end_at) from area_presence_intervals where camera_id=? and revision_id=?",
                (camera_id, selected),
            ).fetchone()[0]
            totals = db.execute(
                f"""select count(*) total_records,
                coalesce(sum(qualified),0) observed_visits,
                coalesce(sum(qualified and status='completed'),0) completed_count,
                coalesce(sum(qualified and status='incomplete'),0) incomplete_count,
                coalesce(sum(qualified and status='active'),0) active_count,
                coalesce(sum(qualified and json_extract(payload_json,'$.arrival_observed')),0) observed_arrivals,
                coalesce(sum(qualified and json_extract(payload_json,'$.departure_observed')),0) observed_departures
                from area_visits where {where}""",
                params,
            ).fetchone()
            completed_where = where + " and qualified=1 and status='completed'"
            count = totals["completed_count"]
            duration_sum = db.execute(
                f"select coalesce(sum(estimated_dwell_ms),0) from area_visits where {completed_where}",
                params,
            ).fetchone()[0]
            medians = (
                db.execute(
                    f"select estimated_dwell_ms from area_visits where {completed_where} order by estimated_dwell_ms limit ? offset ?",
                    (*params, 2 if count % 2 == 0 else 1, max(0, (count - 1) // 2)),
                ).fetchall()
                if count
                else []
            )
            p90 = (
                db.execute(
                    f"select estimated_dwell_ms from area_visits where {completed_where} order by estimated_dwell_ms limit 1 offset ?",
                    (*params, max(0, ceil(count * 0.9) - 1)),
                ).fetchone()[0]
                if count
                else None
            )
            groups = db.execute(
                f"""select case when estimated_dwell_ms<60000 then 0
                when estimated_dwell_ms<300000 then 1 when estimated_dwell_ms<900000 then 2
                when estimated_dwell_ms<1800000 then 3 else 4 end category,count(*) count
                from area_visits where {completed_where} group by category""",
                params,
            ).fetchall()
            buckets = [0] * 5
            for group in groups:
                buckets[group["category"]] = group["count"]
            rows = db.execute(
                f"select payload_json from area_visits where {where} order by coalesce(ended_at,first_inside_at) desc,visit_id desc limit ? offset ?",
                (*params, limit, offset),
            ).fetchall()
            intervals = db.execute(
                "select * from area_presence_intervals where camera_id=? and revision_id=? and start_at<? and end_at>? order by start_at",
                (camera_id, selected, end.isoformat(), start.isoformat()),
            ).fetchall()
            arrivals = db.execute(
                """select strftime('%Y-%m-%dT%H:00:00+00:00',first_inside_at) hour,count(*) count
                from area_visits where camera_id=? and revision_id=? and first_inside_at>=? and first_inside_at<?
                and qualified=1 and json_extract(payload_json,'$.arrival_observed')=1 group by hour""",
                params,
            ).fetchall()
            starts = db.execute(
                "select count(*) from area_visits where camera_id=? and revision_id=? and first_inside_at>=? and first_inside_at<? and qualified=1",
                params,
            ).fetchone()[0]
            completions = db.execute(
                f"select strftime('%Y-%m-%dT%H:00:00+00:00',ended_at) hour,count(*) count from area_visits where {completed_where} group by hour",
                params,
            ).fetchall()
        coverage = covered_seconds(
            [
                (max(start, parse(row["start_at"])), min(end, parse(row["end_at"])))
                for row in intervals
            ]
        )
        history: dict[str, dict[str, Any]] = {}
        hourly_spans: dict[str, list[tuple[datetime, datetime]]] = {}
        hour = start.replace(minute=0, second=0, microsecond=0)
        while hour < end:
            at = hour.isoformat()
            history[at] = {
                "at": at,
                "peak_presence": None,
                "covered_ms": 0,
                "completed_count": 0,
                "arrivals": 0,
            }
            hour += timedelta(hours=1)
        for row in intervals:
            a, b = max(start, parse(row["start_at"])), min(end, parse(row["end_at"]))
            while a < b:
                hour = a.replace(minute=0, second=0, microsecond=0)
                stop = min(b, hour + timedelta(hours=1))
                item = history[hour.isoformat()]
                hourly_spans.setdefault(hour.isoformat(), []).append((a, stop))
                item["peak_presence"] = max(item["peak_presence"] or 0, row["presence"])
                a = stop
        for at, spans in hourly_spans.items():
            history[at]["covered_ms"] = round(covered_seconds(spans) * 1000)
        for row in completions:
            if row["hour"] in history:
                history[row["hour"]]["completed_count"] = row["count"]
        for row in arrivals:
            if row["hour"] in history:
                history[row["hour"]]["arrivals"] = row["count"]
        return {
            **dict(totals),
            "observed_visits": starts,
            "observed_arrivals": sum(row["count"] for row in arrivals),
            "camera_id": camera_id,
            "revision_id": selected,
            "revisions": revisions,
            "from": start.isoformat(),
            "to": end.isoformat(),
            "timezone": "Asia/Manila",
            "average_dwell_ms": duration_sum / count if count else None,
            "median_dwell_ms": sum(row[0] for row in medians) / len(medians) if medians else None,
            "p90_dwell_ms": p90,
            "duration_buckets": buckets,
            "covered_ms": round(coverage * 1000),
            "coverage_ratio": min(1.0, coverage / (end - start).total_seconds()),
            "peak_presence": max((row["presence"] for row in intervals), default=None),
            "history": list(history.values()),
            "visits": [json.loads(row["payload_json"]) for row in rows],
            "algorithm_version": 1,
            "cohort": "completed_at",
            "raw_retention_days": 30,
            "last_observed_at": last_observed,
        }

    def cleanup(self, now: datetime) -> None:
        with self.database.connection() as db:
            cutoff = (now - timedelta(days=30)).isoformat()
            db.execute(
                "delete from area_visits where visit_id in (select visit_id from area_visits where status!='active' and ended_at<? limit 1000)",
                (cutoff,),
            )
            db.execute(
                "delete from area_presence_intervals where interval_id in (select interval_id from area_presence_intervals where end_at<? limit 1000)",
                (cutoff,),
            )
            db.execute(
                "delete from area_hourly_rollups where bucket<?",
                ((now - timedelta(days=180)).isoformat(),),
            )
