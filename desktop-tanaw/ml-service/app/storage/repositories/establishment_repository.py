"""Anonymous camera observations and retained establishment daily summaries.

Counting is deliberately simple. Every Entry / Exit camera feeds one shared
establishment balance, Open Space cameras add the people inside their zones, and
a recognized visitor counts once per business day across all cameras.
"""

import hashlib
import json
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.analytics.establishment_movements import daily_movements
from app.analytics.visitor_sex import daily_sex_counts, recent_female_share
from app.storage.local_database import LocalDatabase

TIMEZONE = ZoneInfo("Asia/Manila")
POLICY_VERSION = 3
COUNTING_BASIS = "sum_of_daily_establishment_unique_visitors"


def snapshot_digest(value: dict[str, Any]) -> str:
    """Whole-valued floats survive a JSON round trip through browser number types."""

    def normalize(item: Any) -> Any:
        if isinstance(item, dict):
            return {key: normalize(part) for key, part in item.items() if key != "snapshot_version"}
        if isinstance(item, list):
            return [normalize(part) for part in item]
        if isinstance(item, float) and item.is_integer():
            return int(item)
        return item

    return hashlib.sha256(
        json.dumps(
            normalize(value), sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
    ).hexdigest()


def timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("Establishment observations require timezone-aware timestamps.")
    return value.astimezone(UTC).isoformat()


def business_date_for(value: datetime) -> str:
    return value.astimezone(TIMEZONE).date().isoformat()


class EstablishmentRepository:
    def __init__(self, database: LocalDatabase) -> None:
        self.database = database

    def save_observation(self, record: dict[str, Any]) -> bool:
        with self.database.connection() as db:
            existing = db.execute(
                "select * from establishment_observations "
                "where observation_id=? and business_date=?",
                (record["observation_id"], record["business_date"]),
            ).fetchone()
            if existing is not None and any(
                existing[key] != record[key] for key in ("camera_id", "track_key", "kind")
            ):
                raise ValueError("An observation ID cannot be reassigned to another source.")
            db.execute(
                """insert into establishment_observations values (
                    :observation_id,:business_date,:camera_id,:analysis_mode,:kind,:track_key,
                    :revision_id,:model_name,:visitor_id,:identity_confidence,:reid_decision,
                    :reid_score,:qualified,:first_at,:last_at,:ended_at,:arrival_observed,
                    :departure_observed,:payload_json,:sex_logit_sum,:sex_weight,:sex_model)
                on conflict(observation_id,business_date) do update set
                    visitor_id=coalesce(excluded.visitor_id,establishment_observations.visitor_id),
                    identity_confidence=case when excluded.visitor_id is null
                        and establishment_observations.visitor_id is not null
                        then establishment_observations.identity_confidence
                        else excluded.identity_confidence end,
                    reid_decision=excluded.reid_decision,reid_score=excluded.reid_score,
                    model_name=coalesce(establishment_observations.model_name,excluded.model_name),
                    qualified=max(establishment_observations.qualified,excluded.qualified),
                    last_at=max(establishment_observations.last_at,excluded.last_at),
                    ended_at=coalesce(excluded.ended_at,establishment_observations.ended_at),
                    departure_observed=max(establishment_observations.departure_observed,
                        excluded.departure_observed),payload_json=excluded.payload_json,
                    sex_logit_sum=case when excluded.sex_model is null
                        then establishment_observations.sex_logit_sum
                        else excluded.sex_logit_sum end,
                    sex_weight=case when excluded.sex_model is null
                        then establishment_observations.sex_weight
                        else excluded.sex_weight end,
                    sex_model=coalesce(excluded.sex_model,establishment_observations.sex_model)""",
                {"sex_logit_sum": None, "sex_weight": 0.0, "sex_model": None, **record},
            )
            return (
                existing is None
                or any(
                    existing[key] != record[key]
                    for key in (
                        "visitor_id",
                        "identity_confidence",
                        "qualified",
                        "ended_at",
                        "arrival_observed",
                        "departure_observed",
                    )
                    if record[key] is not None
                )
                or (
                    record.get("sex_model") is not None
                    and any(
                        existing[key] != record[key]
                        for key in ("sex_logit_sum", "sex_weight", "sex_model")
                    )
                )
            )

    def reconcile_identities(self, business_date: str) -> bool:
        """Resolve aliases before aggregation; no FK ties retained counts to embeddings."""
        with self.database.connection() as db:
            before = db.total_changes
            identities = {
                row["visitor_id"]: dict(row)
                for row in db.execute(
                    "select visitor_id,identity_status,canonical_visitor_id "
                    "from visitor_identities where business_date=?",
                    (business_date,),
                )
            }
            db.execute(
                "update establishment_observations set identity_confidence='high' "
                "where business_date=? and identity_confidence!='high' and visitor_id in "
                "(select visitor_id from visitor_identities where business_date=? "
                "and identity_status='confirmed')",
                (business_date, business_date),
            )
            for visitor_id, identity in identities.items():
                if identity["identity_status"] != "merged":
                    continue
                canonical = visitor_id
                seen: set[str] = set()
                while identities[canonical]["identity_status"] == "merged":
                    if canonical in seen:
                        raise ValueError("Circular visitor identity reconciliation.")
                    seen.add(canonical)
                    target = identities[canonical]["canonical_visitor_id"]
                    if target not in identities:
                        raise ValueError("Missing canonical visitor identity.")
                    canonical = target
                confidence = (
                    "high" if identities[canonical]["identity_status"] == "confirmed" else "low"
                )
                if canonical != visitor_id or identity["identity_status"] == "confirmed":
                    db.execute(
                        "update establishment_observations set visitor_id=?,identity_confidence=? "
                        "where business_date=? and visitor_id=? "
                        "and (visitor_id!=? or identity_confidence!=?)",
                        (canonical, confidence, business_date, visitor_id, canonical, confidence),
                    )

            return db.total_changes != before

    def _day_inputs(
        self, db: Any, business_date: str
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        begin, end = day_bounds(business_date)
        rows = [
            dict(row)
            for row in db.execute(
                "select * from establishment_observations where business_date=? and qualified=1 "
                "order by first_at,observation_id",
                (business_date,),
            )
        ]
        corrections = [
            dict(row)
            for row in db.execute(
                "select correction_id,camera_id,old_occupancy,new_occupancy,delta,reason,"
                "recorded_at from occupancy_corrections where recorded_at>=? and recorded_at<? "
                "order by recorded_at",
                (begin, end),
            )
        ]
        return rows, corrections

    def today_balance(self, now: datetime | None = None) -> int:
        """The shared Entry / Exit balance since the start of today's business day."""
        now = now or datetime.now(UTC)
        business_date = business_date_for(now)
        with self.database.connection() as db:
            rows, corrections = self._day_inputs(db, business_date)
        return int(daily_movements(rows, business_date, corrections, until=now)["balance"])

    def rebuild_day(self, business_date: str, now: datetime) -> dict[str, Any]:
        with self.database.connection() as db:
            rows, corrections = self._day_inputs(db, business_date)
            identities = {
                row["visitor_id"]
                for row in rows
                if row["visitor_id"] is not None and row["identity_confidence"] == "high"
            }
            unresolved = sum(
                row["visitor_id"] is None or row["identity_confidence"] != "high" for row in rows
            )
            movement = daily_movements(rows, business_date, corrections)
            begin, end = day_bounds(business_date)
            intervals = db.execute(
                "select * from establishment_occupancy_intervals where start_at<? and end_at>?",
                (end, begin),
            ).fetchall()
            covered_ms = sum(
                max(
                    0,
                    round(
                        (
                            min(datetime.fromisoformat(end), datetime.fromisoformat(row["end_at"]))
                            - max(
                                datetime.fromisoformat(begin),
                                datetime.fromisoformat(row["start_at"]),
                            )
                        ).total_seconds()
                        * 1000
                    ),
                )
                for row in intervals
                if row["occupancy"] is not None
            )
            peaks = [row["occupancy"] for row in intervals if row["occupancy"] is not None]
            live_evidence = [
                json.loads(row["sources_json"]) for row in intervals if row["occupancy"] is not None
            ]
            if movement["movement_state"] == "unavailable" and any(
                item.get("movement_available") for item in live_evidence
            ):
                movement["movement_state"] = "available"
            model_spaces = {row["model_name"] for row in rows if row["visitor_id"] is not None}
            identification_possible = (
                bool(identities)
                or any(row["model_name"] is not None for row in rows)
                or any(item.get("identification_available") for item in live_evidence)
            )
            names = {
                int(row["camera_id"]): row["name"]
                for row in db.execute("select camera_id,name from camera_profiles")
            }
            source_modes: dict[int, set[str]] = {}
            for row in rows:
                source_modes.setdefault(row["camera_id"], set()).add(row["analysis_mode"])
            for item in live_evidence:
                for source in item.get("measurement_sources", []):
                    source_modes.setdefault(source["camera_id"], set()).add(source["analysis_mode"])
                    names.setdefault(source["camera_id"], source.get("camera_name"))
            source_breakdown = []
            for camera_id in sorted(source_modes):
                source_rows = [row for row in rows if row["camera_id"] == camera_id]
                doorway = "entrance_exit" in source_modes[camera_id]
                source_movement = daily_movements(source_rows, business_date)
                source_breakdown.append(
                    {
                        "camera_id": camera_id,
                        "camera_name": names.get(camera_id) or f"Camera {camera_id}",
                        "analysis_modes": sorted(source_modes[camera_id]),
                        "observation_state": "observed",
                        "entries": source_movement["entries"] if doorway else None,
                        "exits": source_movement["exits"] if doorway else None,
                        "unique_count": len(
                            {
                                row["visitor_id"]
                                for row in source_rows
                                if row["visitor_id"] is not None
                                and row["identity_confidence"] == "high"
                            }
                        ),
                        "qualified_observations": len(source_rows),
                        "configuration_revisions": sorted(
                            {
                                row["revision_id"]
                                for row in source_rows
                                if row["revision_id"] is not None
                            }
                        ),
                        "embedding_spaces": sorted(
                            {
                                row["model_name"]
                                for row in source_rows
                                if row["model_name"] is not None
                            }
                        ),
                        "identity_confidence": dict(
                            Counter(row["identity_confidence"] for row in source_rows)
                        ),
                        "matching_decisions": dict(
                            Counter(row["reid_decision"] for row in source_rows)
                        ),
                        "additive": False,
                    }
                )
            earlier = [
                json.loads(row["metrics_json"])
                for row in db.execute(
                    "select metrics_json from establishment_daily_summaries "
                    "where business_date<? and business_date>=? order by business_date",
                    (
                        business_date,
                        (date.fromisoformat(business_date) - timedelta(days=30)).isoformat(),
                    ),
                )
            ]
            sex = daily_sex_counts(rows, identities, recent_female_share(earlier))
            metrics = {
                **sex.as_metrics(),
                "business_date": business_date,
                "unique_count": len(identities),
                "confirmed_unique_count": len(identities),
                "entries": movement["entries"],
                "exits": movement["exits"],
                "repeat_entry_count": movement["repeat_entry_count"],
                "movement_state": movement["movement_state"],
                "occupancy_corrections": corrections,
                "unresolved_observations": unresolved,
                "qualified_observations": len(rows),
                "identification_coverage": (len(rows) - unresolved) / len(rows) if rows else None,
                "identification_state": (
                    "unavailable"
                    if not identification_possible
                    else "partial"
                    if unresolved
                    else "available"
                ),
                "reconciliation_state": (
                    "partial" if unresolved or len(model_spaces) > 1 else "estimated"
                ),
                "incompatible_identity_models": len(model_spaces) > 1,
                "peak_occupancy": max(peaks) if peaks else None,
                "covered_ms": covered_ms,
                "coverage_ratio": covered_ms / 86_400_000,
                "counting_basis": COUNTING_BASIS,
                "policy_version": POLICY_VERSION,
                "first_event_at": min((row["first_at"] for row in rows), default=None),
                "last_event_at": max((row["last_at"] for row in rows), default=None),
                "sources": sorted(source_modes),
                "source_breakdown": source_breakdown,
            }
            db.execute(
                "insert into establishment_daily_summaries values (?,?,?,0,?) "
                "on conflict(business_date) do update set metrics_json=excluded.metrics_json,"
                "updated_at=excluded.updated_at where finalized=0",
                (
                    business_date,
                    json.dumps(metrics, sort_keys=True),
                    POLICY_VERSION,
                    timestamp(now),
                ),
            )
        return metrics

    def summary(self, start: datetime, end: datetime) -> dict[str, Any]:
        begin, stop = timestamp(start), timestamp(end)
        if begin >= stop or end - start > timedelta(days=180):
            raise ValueError("Select an increasing report range of at most 180 days.")
        start_day = start.astimezone(TIMEZONE).date().isoformat()
        # Date-based summaries require local midnight boundaries, avoiding partial-day overcounts.
        if (
            begin != day_bounds(start_day)[0]
            or stop != day_bounds(end.astimezone(TIMEZONE).date().isoformat())[0]
        ):
            raise ValueError("Daily summaries require Asia/Manila midnight boundaries.")
        with self.database.connection() as db:
            days = [
                {**json.loads(row["metrics_json"]), "finalized": bool(row["finalized"])}
                for row in db.execute(
                    "select * from establishment_daily_summaries where business_date>=? "
                    "and business_date<? order by business_date",
                    (start_day, end.astimezone(TIMEZONE).date().isoformat()),
                )
            ]
        result: dict[str, Any] = {
            key: sum(day[key] for day in days)
            for key in (
                "unique_count",
                "confirmed_unique_count",
                "entries",
                "exits",
                "repeat_entry_count",
                "unresolved_observations",
                "qualified_observations",
                "covered_ms",
            )
        }
        peaks = [day["peak_occupancy"] for day in days if day["peak_occupancy"] is not None]
        # Male and female split the unique visitors; a period total exists only when every
        # day with visitors has one.
        visited = [day for day in days if day["unique_count"] > 0]
        sexed = [day for day in visited if day.get("sex_estimation_state") == "estimated"]
        complete_sex = len(sexed) == len(visited)
        result.update(
            male_count=sum(day["male_count"] for day in sexed) if complete_sex else None,
            female_count=sum(day["female_count"] for day in sexed) if complete_sex else None,
            sex_estimation_state=(
                "estimated" if complete_sex else "partial" if sexed else "unavailable"
            ),
        )
        expected_days = (end.astimezone(TIMEZONE).date() - start.astimezone(TIMEZONE).date()).days
        result.update(
            enterprise_id=self.database.enterprise_id,
            from_at=begin,
            to_at=stop,
            timezone="Asia/Manila",
            days=days,
            peak_occupancy=max(peaks) if peaks else None,
            counting_basis=COUNTING_BASIS,
            policy_version=POLICY_VERSION,
            days_available=len(days),
            days_requested=expected_days,
            coverage_ratio=result["covered_ms"] / (expected_days * 86_400_000),
            reconciliation_state=(
                "not_collected"
                if not any(
                    day["covered_ms"] > 0 or day["qualified_observations"] > 0 for day in days
                )
                else "partial"
                if len(days) < expected_days
                or result["unresolved_observations"]
                or any(day["reconciliation_state"] == "partial" for day in days)
                else "estimated"
            ),
            movement_state=(
                "available"
                if len(days) == expected_days
                and all(day["movement_state"] == "available" for day in days)
                else "partial"
                if any(day["movement_state"] != "unavailable" for day in days)
                else "unavailable"
            ),
            identification_state=(
                "available"
                if len(days) == expected_days
                and all(day["identification_state"] == "available" for day in days)
                else "partial"
                if any(day["identification_state"] != "unavailable" for day in days)
                else "unavailable"
            ),
        )
        sources: dict[int, dict[str, Any]] = {}
        for day in days:
            for source in day.get("source_breakdown", []):
                camera_id = source["camera_id"]
                if camera_id not in sources:
                    sources[camera_id] = json.loads(json.dumps(source))
                    continue
                target = sources[camera_id]
                target["analysis_modes"] = sorted(
                    set(target["analysis_modes"]) | set(source["analysis_modes"])
                )
                for key in ("entries", "exits"):
                    target[key] = (
                        None
                        if target[key] is None and source[key] is None
                        else (target[key] or 0) + (source[key] or 0)
                    )
                target["unique_count"] += source["unique_count"]
                target["qualified_observations"] += source["qualified_observations"]
                for key in ("configuration_revisions", "embedding_spaces"):
                    target[key] = sorted(set(target.get(key, [])) | set(source.get(key, [])))
                for key in ("identity_confidence", "matching_decisions"):
                    target[key] = dict(Counter(target.get(key, {})) + Counter(source.get(key, {})))
        result["source_breakdown"] = [sources[key] for key in sorted(sources)]
        result["occupancy_corrections"] = [
            item for day in days for item in day.get("occupancy_corrections", [])
        ]
        result["snapshot_version"] = snapshot_digest(result)
        return result

    def cleanup(self, now: datetime) -> None:
        today = now.astimezone(TIMEZONE).date()
        with self.database.connection() as db:
            cutoff = (today - timedelta(days=180)).isoformat()
            # Give the previous day's pending work the existing two-hour grace window.
            final_before = (now.astimezone(TIMEZONE) - timedelta(hours=2)).date().isoformat()
            db.execute(
                "update establishment_daily_summaries set finalized=1 where business_date<? and finalized=0",
                (final_before,),
            )
            db.execute(
                "delete from establishment_observations where business_date<?",
                ((today - timedelta(days=30)).isoformat(),),
            )
            db.execute(
                "delete from establishment_daily_summaries where business_date<?",
                (cutoff,),
            )
            db.execute(
                "delete from establishment_occupancy_intervals where end_at<?",
                (timestamp(now - timedelta(days=30)),),
            )

    def record_occupancy_correction(
        self,
        *,
        new_occupancy: int,
        reason: str,
        camera_id: int | None = None,
        actor_id: str | None = None,
        actor_name: str | None = None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        """Set the shared Entry / Exit balance; later crossings continue from it."""
        now = now or datetime.now(UTC)
        with self.database.transaction() as db:
            old = self.today_balance(now)
            record = dict(
                correction_id=str(uuid4()),
                enterprise_id=self.database.enterprise_id,
                camera_id=camera_id,
                old_occupancy=old,
                new_occupancy=new_occupancy,
                delta=new_occupancy - old,
                reason=reason,
                actor_id=actor_id,
                actor_name=actor_name,
                recorded_at=timestamp(now),
            )
            db.execute(
                "insert into occupancy_corrections (correction_id,enterprise_id,camera_id,old_occupancy,new_occupancy,delta,reason,actor_id,actor_name,recorded_at,payload_json) values (:correction_id,:enterprise_id,:camera_id,:old_occupancy,:new_occupancy,:delta,:reason,:actor_id,:actor_name,:recorded_at,:payload_json)",
                {**record, "payload_json": json.dumps(record, sort_keys=True)},
            )
            self.rebuild_day(business_date_for(now), now)
            return record

    def checkpoint_occupancy(self, snapshot: dict[str, Any], now: datetime) -> None:
        if self.database.in_transaction:
            self._checkpoint_occupancy(snapshot, now)
        else:
            with self.database.transaction():
                self._checkpoint_occupancy(snapshot, now)

    def _checkpoint_occupancy(self, snapshot: dict[str, Any], now: datetime) -> None:
        at = timestamp(now)
        with self.database.connection() as db:
            previous = db.execute(
                "select * from establishment_occupancy_intervals order by interval_id desc limit 1"
            ).fetchone()
            if previous is not None and at <= previous["end_at"]:
                return
            sources = json.dumps(snapshot, sort_keys=True)

            def signature(value: str) -> dict[str, Any]:
                parsed: dict[str, Any] = json.loads(value)
                for item in parsed.get("measurement_sources", []):
                    item.pop("observed_at", None)
                return parsed

            same = previous is not None and signature(previous["sources_json"]) == signature(
                sources
            )
            continuous = (
                previous is not None
                and (
                    datetime.fromisoformat(at) - datetime.fromisoformat(previous["end_at"])
                ).total_seconds()
                <= 5
            )
            if continuous and previous is not None:
                db.execute(
                    "update establishment_occupancy_intervals set end_at=?,end_sources_json=? where interval_id=?",
                    (
                        at,
                        sources if same else previous["end_sources_json"],
                        previous["interval_id"],
                    ),
                )
            if not (continuous and previous is not None and same):
                db.execute(
                    "insert into establishment_occupancy_intervals "
                    "(start_at,end_at,occupancy,completeness,sources_json,end_sources_json) values (?,?,?,?,?,?)",
                    (at, at, snapshot["occupancy"], snapshot["state"], sources, sources),
                )
            day = now.astimezone(TIMEZONE).date()
            self.rebuild_day(day.isoformat(), now)
            if previous is not None and continuous:
                previous_day = (
                    datetime.fromisoformat(previous["end_at"]).astimezone(TIMEZONE).date()
                )
                if previous_day != day:
                    self.rebuild_day(previous_day.isoformat(), now)


def day_bounds(business_date: str) -> tuple[str, str]:
    local = datetime.fromisoformat(business_date).replace(tzinfo=TIMEZONE)
    return timestamp(local), timestamp(local + timedelta(days=1))
