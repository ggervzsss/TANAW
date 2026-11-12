"""Stable physical population scopes, independent of daily appearance identities."""

import hashlib
import json
from dataclasses import replace
from typing import Any

from app.analytics.establishment_movements import population_roots
from app.analytics.establishment_occupancy import OccupancyMeasurement, reconcile_occupancy
from app.config.camera_coverage import CameraCoverage


def population_contexts(coverages: dict[int, CameraCoverage]) -> dict[int, dict[str, Any]]:
    # A contained internal zone has its own balance. It is excluded when the
    # establishment combines measurements, rather than added into its parent.
    local = {
        source: coverage.model_copy(
            update={"relationship": "independent", "related_camera_id": None}
        )
        if coverage.relationship == "contained" and coverage.role == "internal_observation"
        else coverage
        for source, coverage in coverages.items()
    }
    roots = population_roots(local)
    result = {}
    for source, root in roots.items():
        root_coverage = local.get(root, CameraCoverage())
        # Names and travel-time edits do not move a physical population. A new
        # reporting role/root does. Additional backup cameras share the root's
        # scope without resetting its existing opening population.
        definition = {
            "root_camera_id": root,
            "role": root_coverage.role,
            "relationship": root_coverage.relationship,
            "related_camera_id": root_coverage.related_camera_id,
        }
        digest = hashlib.sha256(json.dumps(definition, sort_keys=True).encode()).hexdigest()[:20]
        result[source] = {**definition, "population_key": f"{root}:{digest}"}
    return result


def direct_population_anchors(measurements: list[OccupancyMeasurement]) -> list[dict[str, Any]]:
    local = [
        replace(
            item,
            coverage=item.coverage.model_copy(
                update={"relationship": "independent", "related_camera_id": None}
            ),
        )
        if item.coverage.relationship == "contained"
        and item.coverage.role == "internal_observation"
        else item
        for item in measurements
    ]
    by_id = {item.camera_id: item for item in local}
    result = reconcile_occupancy(local)
    anchors = []
    for contribution in result["contributions"]:
        if contribution["basis"] != "observed_presence" or contribution["state"] != "estimated":
            continue
        items = [by_id[source] for source in contribution["camera_ids"]]
        if (
            any(item.observed_at is None for item in items)
            or len(contribution["population_keys"]) != 1
        ):
            continue
        anchors.append(
            dict(
                population_key=contribution["population_keys"][0],
                occupancy=contribution["occupancy"],
                camera_ids=contribution["camera_ids"],
                observed_at=max(
                    item.observed_at for item in items if item.observed_at is not None
                ).isoformat(),
                evidence={
                    str(item.camera_id): item.observed_at.isoformat()
                    for item in items
                    if item.observed_at is not None
                },
            )
        )
    return anchors
