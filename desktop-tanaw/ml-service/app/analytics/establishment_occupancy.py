"""Combine simultaneous measurements using physical coverage, never camera mode."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.config.camera_coverage import CameraCoverage


@dataclass(frozen=True)
class OccupancyMeasurement:
    camera_id: int
    coverage: CameraCoverage
    available: bool
    occupancy: int | None
    visitor_ids: frozenset[str] = field(default_factory=frozenset)
    # A boundary balance can include visitors whose identity is currently unknown.
    boundary_balance: bool = False
    partial: bool = False
    observed_at: datetime | None = None
    population_key: str | None = None


def reconcile_occupancy(measurements: list[OccupancyMeasurement]) -> dict[str, Any]:
    by_id = {measurement.camera_id: measurement for measurement in measurements}
    if len(by_id) != len(measurements):
        raise ValueError("Supply one simultaneous occupancy measurement per camera.")
    unknown = [
        item.camera_id
        for item in measurements
        if item.coverage.role == "unconfigured" or item.coverage.relationship == "unknown"
    ]
    if not measurements or unknown:
        return _result(None, 0, "configuration_required", [], unknown, [])

    roots: dict[int, int] = {}
    for item in measurements:
        path: set[int] = set()
        current = item
        while current.coverage.relationship in {"contained", "alternative"}:
            if current.camera_id in path:
                raise ValueError("Camera coverage cannot contain cycles.")
            path.add(current.camera_id)
            target = current.coverage.related_camera_id
            if target not in by_id:
                return _result(None, 0, "configuration_required", [], [item.camera_id], [])
            current = by_id[target]
        roots[item.camera_id] = current.camera_id

    selected: dict[int, OccupancyMeasurement] = {}
    excluded: list[int] = []
    missing: list[int] = []
    for root in sorted(set(roots.values())):
        primary = by_id[root]
        candidates = [
            item
            for item in measurements
            if roots[item.camera_id] == root and item.coverage.relationship == "alternative"
        ]
        chosen = next((item for item in [primary, *candidates] if _available(item)), None)
        if chosen is None:
            missing.append(root)
        else:
            selected[root] = chosen
        excluded.extend(
            item.camera_id
            for item in measurements
            if roots[item.camera_id] == root
            and (chosen is None or item.camera_id != chosen.camera_id)
        )

    # Overlapping roots form a union of people observed at this instant. A chain
    # of overlapping views does not imply that every pair sees the same people.
    groups = {root: {root} for root in selected}
    for root in selected:
        related = by_id[root].coverage.related_camera_id
        if by_id[root].coverage.relationship != "overlapping":
            continue
        if related not in roots or roots[related] not in selected:
            missing.append(root)
            continue
        target = roots[related]
        union = groups[root] | groups[target]
        for member in union:
            groups[member] = union

    total = 0
    partial = False
    contributions: list[dict[str, Any]] = []
    visited: set[int] = set()
    for root in sorted(selected):
        if root in visited:
            continue
        group = groups[root]
        visited.update(group)
        items = [selected[member] for member in sorted(group)]
        count, uncertain = _population_count(items)
        total += count
        partial |= uncertain
        contributions.append(
            {
                "camera_ids": [item.camera_id for item in items],
                "occupancy": count,
                "state": "partial" if uncertain else "estimated",
                "basis": "boundary_balance"
                if any(item.boundary_balance for item in items)
                else "observed_presence",
                "population_keys": sorted(
                    {item.population_key for item in items if item.population_key is not None}
                ),
            }
        )
    return _result(
        None if missing else total,
        total,
        "unavailable"
        if missing and not selected
        else "partial"
        if missing or partial
        else "estimated",
        contributions,
        sorted(set(missing)),
        sorted(set(excluded)),
    )


def _available(item: OccupancyMeasurement) -> bool:
    return item.available and item.occupancy is not None and item.occupancy >= 0


def _population_count(items: list[OccupancyMeasurement]) -> tuple[int, bool]:
    if len(items) == 1:
        return items[0].occupancy or 0, items[0].partial
    known = set().union(*(item.visitor_ids for item in items))
    largest = max(item.occupancy or 0 for item in items)
    boundary = [item for item in items if item.boundary_balance]
    if boundary:
        # Alternative evidence for one population cannot simply be added to its
        # balance. Unknown identity membership makes this a disclosed lower bound.
        return max(largest, len(known)), True
    complete = all(len(item.visitor_ids) == item.occupancy for item in items)
    return max(largest, len(known)), not complete or any(item.partial for item in items)


def _result(
    occupancy: int | None,
    partial_occupancy: int,
    state: str,
    contributions: list[dict[str, Any]],
    missing: list[int],
    excluded: list[int],
) -> dict[str, Any]:
    return {
        "occupancy": occupancy,
        "partial_occupancy": partial_occupancy,
        "state": state,
        "contributions": contributions,
        "missing_camera_ids": missing,
        "excluded_camera_ids": excluded,
    }
