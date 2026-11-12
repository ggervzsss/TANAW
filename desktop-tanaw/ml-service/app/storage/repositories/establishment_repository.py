"""Anonymous source contributions and retained establishment daily summaries."""

import hashlib
import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.analytics.establishment_movements import apply_flow, reconcile_movements
from app.analytics.establishment_populations import population_contexts
from app.config.camera_coverage import CameraCoverage, camera_relation_in_graph
from app.storage.local_database import LocalDatabase

TIMEZONE = ZoneInfo("Asia/Manila")
POLICY_VERSION = 1
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


class EstablishmentRepository:
    def __init__(self, database: LocalDatabase) -> None:
        self.database = database

    def coverage_graph(self, camera_id: int, coverage: CameraCoverage) -> dict[int, CameraCoverage]:
        with self.database.connection() as db:
            profiles = [
                json.loads(row[0]) for row in db.execute("select payload_json from camera_profiles")
            ]
            coverages = {
                int(profile["id"]): CameraCoverage.model_validate(profile.get("coverage") or {})
                for profile in profiles
            }
            if not profiles:
                # Replays can provide source records without runtime profiles.
                for row in db.execute(
                    "select camera_id,coverage_json from establishment_observations order by last_at"
                ):
                    coverages[row["camera_id"]] = CameraCoverage.model_validate_json(
                        row["coverage_json"]
                    )
            coverages[camera_id] = coverage
            return coverages

    def population_context(self, camera_id: int, coverage: CameraCoverage) -> dict[str, Any]:
        return population_contexts(self.coverage_graph(camera_id, coverage))[camera_id]

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
                    :departure_observed,:coverage_json,:population_key,:population_context_json,:payload_json)
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
                        excluded.departure_observed),payload_json=excluded.payload_json""",
                record,
            )
            return existing is None or any(
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

    def reconcile_occupancy_day(self, business_date: str, now: datetime) -> None:
        """Re-evaluate recorded frames after identity resolution, without filling gaps."""
        from bisect import bisect_left, bisect_right
        from dataclasses import replace

        from app.analytics.establishment_occupancy import OccupancyMeasurement, reconcile_occupancy
        from app.analytics.establishment_populations import direct_population_anchors

        begin, end = day_bounds(business_date)
        with self.database.connection() as db:
            closed = db.execute(
                "select finalized from establishment_daily_summaries where business_date=?",
                (business_date,),
            ).fetchone()
            if closed is not None and closed["finalized"]:
                return
            intervals = [
                dict(row)
                for row in db.execute(
                    "select * from establishment_occupancy_intervals where start_at<? and end_at>?",
                    (end, begin),
                )
            ]
            if not intervals:
                return
            rows = [
                dict(row)
                for row in db.execute(
                    "select * from establishment_observations where business_date=? and qualified=1",
                    (business_date,),
                )
            ]
            identities = {
                row["track_key"]: row["visitor_id"]
                for row in rows
                if row["visitor_id"] is not None and row["identity_confidence"] == "high"
            }
            corrections = [
                dict(row)
                for row in db.execute(
                    "select * from occupancy_corrections where population_key is not null and recorded_at>=? and recorded_at<?",
                    (begin, end),
                )
            ]

            def measurements(snapshot):
                result = []
                for source in snapshot.get("measurement_sources", []):
                    direct = source["analysis_mode"] == "open_space"
                    result.append(
                        OccupancyMeasurement(
                            source["camera_id"],
                            CameraCoverage.model_validate(source["coverage"]),
                            source["available"],
                            source.get("occupancy") if direct else 0,
                            frozenset(
                                identities[key]
                                for key in source.get("track_keys", [])
                                if key in identities
                            ),
                            not direct,
                            observed_at=datetime.fromisoformat(source["observed_at"])
                            if source.get("observed_at")
                            else None,
                            population_key=source["population_key"],
                        )
                    )
                return result

            inferred = []
            for interval in intervals:
                for name in ("sources_json", "end_sources_json"):
                    inferred.extend(
                        direct_population_anchors(measurements(json.loads(interval[name])))
                    )
            # This updates only aggregate headcounts and does not create arrivals.
            # A late appearance update retains its original observation time.
            # Reconciliation may use frames already recorded after that event,
            # but must never introduce an observation beyond the recorded horizon.
            replay_horizon = max(
                now, *(datetime.fromisoformat(item["end_at"]) for item in intervals)
            )
            self.record_population_anchors(inferred, replay_horizon)
            anchors = [
                dict(row)
                for row in db.execute(
                    "select * from establishment_population_anchors where business_date=?",
                    (business_date,),
                )
            ]
            anchors += [
                dict(
                    population_key=item["population_key"],
                    observed_at=item["observed_at"],
                    occupancy=item["occupancy"],
                )
                for item in inferred
            ]
            opening = self.population_states(before_date=business_date)
            candidates = {datetime.fromisoformat(item["observed_at"]) for item in anchors}
            candidates.update(datetime.fromisoformat(item["recorded_at"]) for item in corrections)
            for row in rows:
                candidates.add(datetime.fromisoformat(row["first_at"]))
                candidates.add(datetime.fromisoformat(row["ended_at"] or row["last_at"]))
            candidate_times = sorted(candidates)
            operations = reconcile_movements(
                rows, business_date, corrections, anchors, include_population_timeline=True
            )["population_timeline"]
            operation_times = []
            operation_states = []
            balances = {key: dict(value) for key, value in opening.items()}
            for operation in operations:
                key = operation["population_key"]
                state = balances.setdefault(key, dict(occupancy=0, partial=False, anchored=False))
                state["occupancy"] = (
                    operation["value"]
                    if operation["reset"]
                    else max(0, state["occupancy"] + operation["value"])
                )
                state["partial"] = bool(operation["partial"]) or (
                    not operation["reset"] and state["partial"]
                )
                state["anchored"] |= operation["reset"]
                operation_times.append(datetime.fromisoformat(operation["at"]))
                operation_states.append({key: dict(value) for key, value in balances.items()})
            for interval in intervals:
                first, last = (
                    json.loads(interval["sources_json"]),
                    json.loads(interval["end_sources_json"]),
                )
                if not first.get("measurement_sources"):
                    continue
                start = max(
                    datetime.fromisoformat(interval["start_at"]), datetime.fromisoformat(begin)
                )
                stop = min(
                    datetime.fromisoformat(interval["end_at"]),
                    datetime.fromisoformat(end) - timedelta(microseconds=1),
                )
                values = []
                states_seen = set()
                inside = candidate_times[
                    bisect_left(candidate_times, start) : bisect_right(candidate_times, stop)
                ]
                for instant in sorted({start, stop, *inside}):
                    source = last if instant == stop else first
                    items = measurements(source)
                    if not items:
                        continue
                    position = bisect_right(operation_times, instant) - 1
                    balances = operation_states[position] if position >= 0 else opening
                    items = [
                        item
                        if not item.boundary_balance
                        else replace(
                            item,
                            occupancy=balances.get(item.population_key or "", {}).get(
                                "occupancy", 0
                            ),
                            partial=bool(
                                balances.get(item.population_key or "", {}).get("partial")
                            ),
                        )
                        for item in items
                    ]
                    value = reconcile_occupancy(items)
                    for contribution in value["contributions"]:
                        keys = contribution["population_keys"]
                        if (
                            len(keys) == 1
                            and contribution["basis"] == "observed_presence"
                            and contribution["state"] == "estimated"
                        ):
                            balance = balances.get(keys[0], {})
                            if balance.get("anchored"):
                                contribution["occupancy"] = balance["occupancy"]
                                if balance.get("partial"):
                                    contribution["state"] = "partial"
                    if value["occupancy"] is not None:
                        values.append(sum(item["occupancy"] for item in value["contributions"]))
                    states_seen.add(
                        "partial"
                        if any(item["state"] == "partial" for item in value["contributions"])
                        else value["state"]
                    )
                # Occupancy stores the highest reconciled simultaneous observation
                # in this already-recorded interval, not a sum of camera peaks.
                state = (
                    "configuration_required"
                    if "configuration_required" in states_seen
                    else "partial"
                    if "partial" in states_seen
                    else "estimated"
                    if values
                    else "unavailable"
                )
                db.execute(
                    "update establishment_occupancy_intervals set occupancy=?,completeness=? where interval_id=?",
                    (max(values) if values else None, state, interval["interval_id"]),
                )

    def rebuild_day(self, business_date: str, now: datetime) -> dict[str, Any]:
        with self.database.connection() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    "select * from establishment_observations where business_date=? and qualified=1 "
                    "order by first_at,observation_id",
                    (business_date,),
                )
            ]
            identities = {
                row["visitor_id"]
                for row in rows
                if row["visitor_id"] is not None and row["identity_confidence"] == "high"
            }
            unresolved = sum(
                row["visitor_id"] is None or row["identity_confidence"] != "high" for row in rows
            )
            configured = all(
                (coverage := CameraCoverage.model_validate_json(row["coverage_json"])).role
                != "unconfigured"
                and coverage.relationship != "unknown"
                for row in rows
            )
            source_coverages = {
                row["camera_id"]: CameraCoverage.model_validate_json(row["coverage_json"])
                for row in rows
            }
            begin, end = day_bounds(business_date)
            corrections = [
                dict(row)
                for row in db.execute(
                    "select correction_id,camera_id,population_key,old_occupancy,new_occupancy,delta,reason,recorded_at from occupancy_corrections where population_key is not null and recorded_at>=? and recorded_at<? order by recorded_at",
                    (begin, end),
                )
            ]
            anchors = [
                dict(row)
                for row in db.execute(
                    "select * from establishment_population_anchors where business_date=?",
                    (business_date,),
                )
            ]
            movement = reconcile_movements(rows, business_date, corrections, anchors)
            movement["occupancy_corrections"] = corrections
            movement["population_measurements"] = [
                dict(
                    population_key=item["population_key"],
                    observed_at=item["observed_at"],
                    occupancy=item["occupancy"],
                    camera_ids=json.loads(item["source_camera_ids_json"]),
                    additive=False,
                )
                for item in anchors
            ]
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
            peak = max(peaks) if peaks else None
            interval_states = {row["completeness"] for row in intervals}
            configured = configured and "configuration_required" not in interval_states
            live_evidence = [
                json.loads(row["sources_json"]) for row in intervals if row["occupancy"] is not None
            ]
            if movement["movement_state"] == "unavailable" and any(
                item.get("movement_available") for item in live_evidence
            ):
                movement["movement_state"] = "available"
            source_metadata: dict[int, list[dict[str, Any]]] = {}
            for interval in intervals:
                for item in json.loads(interval["sources_json"]).get("measurement_sources", []):
                    source_metadata.setdefault(item["camera_id"], []).append(item)
                    source_coverages.setdefault(
                        item["camera_id"], CameraCoverage.model_validate(item["coverage"])
                    )
            relation_graph = {
                int(item["id"]): CameraCoverage.model_validate(item.get("coverage") or {})
                for item in (
                    json.loads(row[0])
                    for row in db.execute("select payload_json from camera_profiles")
                )
            }
            relation_graph.update(source_coverages)
            unknown_pairs = [
                [first_id, second_id]
                for first_id in source_coverages
                for second_id in source_coverages
                if first_id < second_id
                and camera_relation_in_graph(first_id, second_id, relation_graph)[0] == "unknown"
            ]
            configured = configured and not unknown_pairs
            model_spaces = {row["model_name"] for row in rows if row["visitor_id"] is not None}
            missing_measurements = bool(interval_states & {"partial", "unavailable"})
            if missing_measurements and movement["movement_state"] == "available":
                movement["movement_state"] = "partial"
            identification_possible = (
                bool(identities)
                or any(row["model_name"] is not None for row in rows)
                or any(item.get("identification_available") for item in live_evidence)
            )
            source_breakdown = []
            coverage_changed = False
            for camera_id in sorted(source_coverages):
                source_rows = [row for row in rows if row["camera_id"] == camera_id]
                evidence = source_metadata.get(camera_id, [])
                coverage_changed |= (
                    len(
                        {
                            CameraCoverage.model_validate_json(
                                row["coverage_json"]
                            ).model_dump_json(exclude={"area_name"})
                            for row in source_rows
                        }
                    )
                    > 1
                )
                profile = db.execute(
                    "select name from camera_profiles where camera_id=?", (camera_id,)
                ).fetchone()
                source_movement = reconcile_movements(source_rows, business_date)
                measured = source_movement["movement_state"] != "unavailable" or any(
                    item["available"] and item["coverage"]["role"] == "external_boundary"
                    for item in evidence
                )
                source_breakdown.append(
                    {
                        "camera_id": camera_id,
                        "camera_name": profile["name"] if profile else f"Camera {camera_id}",
                        "analysis_modes": sorted(
                            {row["analysis_mode"] for row in source_rows}
                            | {item["analysis_mode"] for item in evidence}
                        ),
                        "observation_state": "observed"
                        if source_rows or any(item["available"] for item in evidence)
                        else "unavailable",
                        "entries": source_movement["entries"] if measured else None,
                        "exits": source_movement["exits"] if measured else None,
                        "unique_count": len(
                            {
                                row["visitor_id"]
                                for row in source_rows
                                if row["visitor_id"] is not None
                                and row["identity_confidence"] == "high"
                            }
                        ),
                        "qualified_observations": len(source_rows),
                        "coverage_configurations": [
                            json.loads(value)
                            for value in sorted(
                                {
                                    json.dumps(json.loads(row["coverage_json"]), sort_keys=True)
                                    for row in source_rows
                                }
                                | {
                                    json.dumps(item["coverage"], sort_keys=True)
                                    for item in evidence
                                }
                            )
                        ],
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
            metrics = {
                "business_date": business_date,
                "unique_count": len(identities),
                "confirmed_unique_count": len(identities),
                **movement,
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
                    "configuration_required"
                    if not configured
                    else "partial"
                    if unresolved
                    or len(model_spaces) > 1
                    or missing_measurements
                    or coverage_changed
                    else "estimated"
                ),
                "incompatible_identity_models": len(model_spaces) > 1,
                "unconfigured_camera_pairs": unknown_pairs,
                "peak_occupancy": peak,
                "covered_ms": covered_ms,
                "coverage_ratio": covered_ms / 86_400_000,
                "counting_basis": COUNTING_BASIS,
                "policy_version": POLICY_VERSION,
                "first_event_at": min((row["first_at"] for row in rows), default=None),
                "last_event_at": max((row["last_at"] for row in rows), default=None),
                "sources": sorted(source_coverages),
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
                {
                    **{
                        key: value
                        for key, value in json.loads(row["metrics_json"]).items()
                        if key != "population_flows"
                    },
                    "finalized": bool(row["finalized"]),
                }
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
                else "configuration_required"
                if any(day["reconciliation_state"] == "configuration_required" for day in days)
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
                configurations = {
                    json.dumps(value, sort_keys=True)
                    for value in target.get("coverage_configurations", [])
                    + source.get("coverage_configurations", [])
                }
                target["coverage_configurations"] = [
                    json.loads(value) for value in sorted(configurations)
                ]
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
            expired_days = db.execute(
                "select business_date,metrics_json from establishment_daily_summaries "
                "where business_date<? order by business_date",
                (cutoff,),
            ).fetchall()
            for day in expired_days:
                for key, flow in (
                    json.loads(day["metrics_json"]).get("population_flows", {}).items()
                ):
                    old = db.execute(
                        "select * from establishment_population_openings where population_key=?",
                        (key,),
                    ).fetchone()
                    if old is not None and old["through_date"] >= day["business_date"]:
                        continue
                    balance = apply_flow(old["opening_occupancy"] if old else 0, flow)
                    db.execute(
                        "insert into establishment_population_openings values (?,?,?,?,?) "
                        "on conflict(population_key) do update set opening_occupancy=excluded.opening_occupancy,"
                        "partial=excluded.partial,anchored=excluded.anchored,through_date=excluded.through_date",
                        (
                            key,
                            balance,
                            int(
                                bool(flow.get("partial"))
                                or (not flow.get("reset") and bool(old and old["partial"]))
                            ),
                            int(bool(flow.get("reset")) or bool(old and old["anchored"])),
                            day["business_date"],
                        ),
                    )
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
                "delete from establishment_population_anchors where business_date<?", (cutoff,)
            )
            db.execute(
                "delete from establishment_occupancy_intervals where end_at<?",
                (timestamp(now - timedelta(days=30)),),
            )

    def population_states(self, before_date: str | None = None) -> dict[str, dict[str, Any]]:
        """Replay compact day transforms, including direct-presence handoff anchors."""
        with self.database.connection() as db:
            states = {
                row["population_key"]: dict(
                    occupancy=row["opening_occupancy"],
                    partial=bool(row["partial"]),
                    anchored=bool(row["anchored"]),
                )
                for row in db.execute("select * from establishment_population_openings")
            }
            for row in db.execute(
                "select metrics_json from establishment_daily_summaries where (? is null or business_date<?) order by business_date",
                (before_date, before_date),
            ):
                for key, flow in json.loads(row["metrics_json"])["population_flows"].items():
                    state = states.setdefault(key, dict(occupancy=0, partial=False, anchored=False))
                    state["occupancy"] = apply_flow(state["occupancy"], flow)
                    state["partial"] = bool(flow.get("partial")) or (
                        not flow.get("reset") and state["partial"]
                    )
                    state["anchored"] |= bool(flow.get("reset"))
        return states

    def population_balances(self) -> dict[str, int]:
        return {key: state["occupancy"] for key, state in self.population_states().items()}

    def record_population_anchors(self, anchors: list[dict[str, Any]], now: datetime) -> None:
        if not anchors:
            return
        if self.database.in_transaction:
            self._record_population_anchors(anchors, now)
        else:
            with self.database.transaction():
                self._record_population_anchors(anchors, now)

    def _record_population_anchors(self, anchors: list[dict[str, Any]], now: datetime) -> None:
        changed_days: set[str] = set()
        with self.database.connection() as db:
            for anchor in anchors:
                observed = datetime.fromisoformat(anchor["observed_at"])
                at = timestamp(observed)
                if (
                    observed > now
                    or not isinstance(anchor["occupancy"], int)
                    or anchor["occupancy"] < 0
                ):
                    raise ValueError(
                        "Population anchors require an observed time and non-negative headcount."
                    )
                day = observed.astimezone(TIMEZONE).date().isoformat()
                closed = db.execute(
                    "select finalized from establishment_daily_summaries where business_date=?",
                    (day,),
                ).fetchone()
                if closed is not None and closed["finalized"]:
                    continue
                existing = db.execute(
                    "select observed_at,occupancy,evidence_json from establishment_population_anchors where population_key=? and business_date=?",
                    (anchor["population_key"], day),
                ).fetchone()
                evidence = anchor["evidence"]
                if existing is not None and existing["observed_at"] >= at:
                    previous_evidence = json.loads(existing["evidence_json"])
                    improves = (
                        existing["observed_at"] == at
                        and set(previous_evidence) == set(evidence)
                        and evidence != previous_evidence
                        and all(
                            evidence[source] >= previous_evidence[source] for source in evidence
                        )
                    )
                    improves |= (
                        existing["observed_at"] == at
                        and evidence == previous_evidence
                        and existing["occupancy"] != anchor["occupancy"]
                        and len(anchor["camera_ids"]) > 1
                    )
                    if not improves:
                        if (
                            evidence == previous_evidence
                            and existing["observed_at"] == at
                            and existing["occupancy"] != anchor["occupancy"]
                        ):
                            raise ValueError(
                                "The same direct frames cannot have two different population counts."
                            )
                        continue
                db.execute(
                    "insert into establishment_population_anchors values (?,?,?,?,?,?) on conflict(population_key,business_date) do update set observed_at=excluded.observed_at,occupancy=excluded.occupancy,source_camera_ids_json=excluded.source_camera_ids_json,evidence_json=excluded.evidence_json",
                    (
                        anchor["population_key"],
                        day,
                        at,
                        anchor["occupancy"],
                        json.dumps(anchor["camera_ids"]),
                        json.dumps(evidence, sort_keys=True),
                    ),
                )
                changed_days.add(day)
            for day in sorted(changed_days):
                self.rebuild_day(day, now)

    def record_population_correction(
        self,
        *,
        population_key: str,
        camera_id: int,
        new_occupancy: int,
        reason: str,
        actor_id: str | None = None,
        actor_name: str | None = None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        now = now or datetime.now(UTC)
        with self.database.transaction() as db:
            old = self.population_balances().get(population_key, 0)
            record = dict(
                correction_id=str(uuid4()),
                enterprise_id=self.database.enterprise_id,
                camera_id=camera_id,
                population_key=population_key,
                old_occupancy=old,
                new_occupancy=new_occupancy,
                delta=new_occupancy - old,
                reason=reason,
                actor_id=actor_id,
                actor_name=actor_name,
                recorded_at=timestamp(now),
            )
            db.execute(
                "insert into occupancy_corrections (correction_id,enterprise_id,camera_id,population_key,old_occupancy,new_occupancy,delta,reason,actor_id,actor_name,recorded_at,payload_json) values (:correction_id,:enterprise_id,:camera_id,:population_key,:old_occupancy,:new_occupancy,:delta,:reason,:actor_id,:actor_name,:recorded_at,:payload_json)",
                {**record, "payload_json": json.dumps(record, sort_keys=True)},
            )
            self.rebuild_day(now.astimezone(TIMEZONE).date().isoformat(), now)
            self.checkpoint_boundary_change(camera_id, now)
            return record

    def checkpoint_boundary_change(self, camera_id: int, now: datetime) -> None:
        """Retain short population changes without replaying an old direct frame."""
        from app.analytics.establishment_occupancy import OccupancyMeasurement, reconcile_occupancy

        with self.database.connection() as db:
            profiles = [
                json.loads(row[0]) for row in db.execute("select payload_json from camera_profiles")
            ]
            coverages = {
                int(item["id"]): CameraCoverage.model_validate(item.get("coverage") or {})
                for item in profiles
            }
            if camera_id not in coverages or coverages[camera_id].role == "unconfigured":
                return
            contexts = population_contexts(coverages)
            key = contexts[camera_id]["population_key"]
            states = self.population_states()
            previous = db.execute(
                "select * from establishment_occupancy_intervals where end_at<=? order by end_at desc limit 1",
                (timestamp(now),),
            ).fetchone()
            recent = (
                json.loads(previous["sources_json"])
                if previous is not None
                and (now - datetime.fromisoformat(previous["end_at"])).total_seconds() <= 5
                else None
            )
            if recent is not None and all(
                "population_keys" in item for item in recent.get("contributions", [])
            ):
                snapshot = recent
                for contribution in snapshot.get("contributions", []):
                    if contribution["population_keys"] == [key] and key in states:
                        contribution["occupancy"] = states[key]["occupancy"]
                        if contribution["basis"].startswith("observed_presence"):
                            contribution["basis"] = "observed_presence_and_later_movements"
                        if states[key]["partial"]:
                            contribution["state"] = "partial"
                snapshot["partial_occupancy"] = sum(
                    item["occupancy"] for item in snapshot.get("contributions", [])
                )
                if snapshot["occupancy"] is not None:
                    snapshot["occupancy"] = snapshot["partial_occupancy"]
                if (
                    any(item["state"] == "partial" for item in snapshot.get("contributions", []))
                    and snapshot["state"] == "estimated"
                ):
                    snapshot["state"] = "partial"
            else:
                measurements = []
                for profile in profiles:
                    source = int(profile["id"])
                    balance = profile.get("analysisMode") != "open_space"
                    population = states.get(contexts[source]["population_key"], {})
                    measurements.append(
                        OccupancyMeasurement(
                            source,
                            coverages[source],
                            source == camera_id and balance,
                            population.get("occupancy", 0) if balance else None,
                            boundary_balance=balance,
                            partial=bool(population.get("partial")),
                            population_key=contexts[source]["population_key"],
                        )
                    )
                snapshot = reconcile_occupancy(measurements)
                snapshot.update(
                    enterprise_id=self.database.enterprise_id,
                    movement_available=coverages[camera_id].role == "external_boundary",
                    identification_available=False,
                )
            snapshot["event_checkpoint"] = True
            self.checkpoint_occupancy(snapshot, now)

    def identities_for_tracks(self, track_keys: set[str], business_date: str) -> set[str]:
        if not track_keys:
            return set()
        with self.database.connection() as db:
            placeholders = ",".join("?" for _ in track_keys)
            return {
                row[0]
                for row in db.execute(
                    "select distinct visitor_id from establishment_observations where "
                    "business_date=? and qualified=1 and identity_confidence='high' "
                    f"and track_key in ({placeholders}) and visitor_id is not null",
                    (business_date, *sorted(track_keys)),
                )
            }

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

            def signature(value):
                value = json.loads(value)
                value.pop("population_anchors", None)
                for item in value.get("measurement_sources", []):
                    item.pop("observed_at", None)
                return value

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
