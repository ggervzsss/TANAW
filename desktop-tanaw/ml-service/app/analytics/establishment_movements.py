"""Boundary movement reconciliation and compact, composable occupancy balances."""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.config.camera_coverage import CameraCoverage

TIMEZONE = ZoneInfo("Asia/Manila")


def population_roots(coverages: dict[int, CameraCoverage]) -> dict[int, int]:
    roots: dict[int, int] = {}
    for camera_id in coverages:
        root = camera_id
        seen: set[int] = set()
        while root in coverages and coverages[root].relationship in {"contained", "alternative"}:
            if root in seen:
                raise ValueError("Camera coverage cannot contain cycles.")
            seen.add(root)
            target = coverages[root].related_camera_id
            if target is None:
                break
            root = target
        roots[camera_id] = root
    groups = {root: {root} for root in roots.values()}
    for camera_id, coverage in coverages.items():
        target = coverage.related_camera_id
        if coverage.relationship != "overlapping" or target is None:
            continue
        first = roots[camera_id]
        target = roots.get(target, target)
        groups.setdefault(target, {target})
        union = groups[first] | groups[target]
        for member in union:
            groups[member] = union
    return {camera_id: min(groups[root]) for camera_id, root in roots.items()}


def reconcile_movements(
    rows: list[dict[str, Any]],
    business_date: str,
    corrections: list[dict[str, Any]] | None = None,
    anchors: list[dict[str, Any]] | None = None,
    until: datetime | None = None,
    include_population_timeline: bool = False,
) -> dict[str, Any]:
    """Reconcile transitions separately from physical population balances.

    Source population scopes are captured when observations are created; a later
    camera-role or coverage edit cannot reassign old movements to another area.
    Direct-presence anchors replace a population at their observation time, then
    only later reconciled transitions change that balance.
    """
    events: list[dict[str, Any]] = []
    boundary_sources: dict[str, set[int]] = {}
    unresolved: set[str] = set()
    for row in rows:
        if row["analysis_mode"] != "entrance_exit":
            continue
        coverage = CameraCoverage.model_validate_json(row["coverage_json"])
        if coverage.role == "unconfigured":
            continue
        key = row["population_key"]
        external = coverage.role == "external_boundary"
        if external:
            boundary_sources.setdefault(key, set()).add(row["camera_id"])
        identified = row["visitor_id"] is not None and row["identity_confidence"] == "high"
        identity = str(row["visitor_id"]) if identified else f"unresolved:{row['observation_id']}"
        if external and not identified:
            unresolved.add(key)
        for direction, supported, at in (
            ("entry", row["kind"] == "entry" or row["arrival_observed"], row["first_at"]),
            (
                "exit",
                row["kind"] == "exit" or row["departure_observed"],
                row["ended_at"] or row["last_at"],
            ),
        ):
            if (
                supported
                and (until is None or datetime.fromisoformat(at) <= until)
                and datetime.fromisoformat(at).astimezone(TIMEZONE).date().isoformat()
                == business_date
            ):
                events.append(
                    dict(
                        at=at,
                        identity=identity,
                        direction=direction,
                        camera_id=row["camera_id"],
                        population_key=key,
                        external=external,
                        identified=identified,
                    )
                )

    def reconciled(source: list[dict[str, Any]]) -> list[dict[str, Any]]:
        kept = []
        last: dict[tuple[str, str, str], tuple[datetime, int]] = {}
        for event in sorted(
            source,
            key=lambda item: (item["at"], item["identity"], item["direction"], item["camera_id"]),
        ):
            instant = datetime.fromisoformat(event["at"])
            token = (event["identity"], event["direction"], event["population_key"])
            previous = last.get(token)
            if (
                previous is not None
                and previous[1] != event["camera_id"]
                and (instant - previous[0]).total_seconds() <= 3
            ):
                continue
            last[token] = (instant, event["camera_id"])
            kept.append(event)
        return kept

    entries = exits = returns = 0
    departed: set[str] = set()
    for event in reconciled([event for event in events if event["external"]]):
        identity = event["identity"]
        if event["direction"] == "entry":
            entries += 1
            if identity in departed and event["identified"]:
                returns += 1
            departed.discard(identity)
        else:
            exits += 1
            departed.add(identity)

    flow_events = reconciled(events)
    source_cameras: dict[str, set[int]] = {}
    uncertain_keys: set[str] = set()
    for event in flow_events:
        source_cameras.setdefault(event["population_key"], set()).add(event["camera_id"])
        if not event["identified"]:
            uncertain_keys.add(event["population_key"])
    uncertain_keys = {key for key in uncertain_keys if len(source_cameras[key]) > 1}
    ordered = [(event["at"], 0, index, event) for index, event in enumerate(flow_events)]
    for rank, items in ((1, anchors or []), (2, corrections or [])):
        ordered.extend(
            (
                item["observed_at"] if rank == 1 else item["recorded_at"],
                rank,
                index,
                dict(
                    population_key=str(item["population_key"]),
                    occupancy=item["occupancy"] if rank == 1 else item["new_occupancy"],
                ),
            )
            for index, item in enumerate(items)
            if until is None
            or datetime.fromisoformat(item["observed_at"] if rank == 1 else item["recorded_at"])
            <= until
        )
    flows: dict[str, dict[str, int]] = {}
    timeline = []
    for at, rank, _, event in sorted(ordered, key=lambda item: item[:3]):
        key = event["population_key"]
        if include_population_timeline:
            timeline.append(
                dict(
                    at=at,
                    population_key=key,
                    reset=bool(rank),
                    value=event["occupancy"]
                    if rank
                    else 1
                    if event["direction"] == "entry"
                    else -1,
                    partial=not rank and key in uncertain_keys,
                )
            )
        if rank:
            flows[key] = {"net": 0, "floor": event["occupancy"], "reset": 1, "partial": 0}
            continue
        flow = flows.setdefault(key, {"net": 0, "floor": 0, "partial": 0})
        delta = 1 if event["direction"] == "entry" else -1
        flow["net"] += delta
        flow["floor"] = max(0, flow["floor"] + delta)
        flow["partial"] |= int(key in uncertain_keys)
    result: dict[str, Any] = dict(
        entries=entries,
        exits=exits,
        repeat_entry_count=returns,
        population_flows=flows,
        movement_state="partial"
        if any(len(boundary_sources[key]) > 1 for key in unresolved)
        else "available"
        if boundary_sources
        else "unavailable",
    )
    if include_population_timeline:
        result["population_timeline"] = timeline
    return result


def apply_flow(opening: int, flow: dict[str, int]) -> int:
    """Compose days without losing opening occupancy or unmatched-exit clamping."""
    if flow.get("reset"):
        return flow["floor"]
    return max(opening + flow["net"], flow["floor"])
