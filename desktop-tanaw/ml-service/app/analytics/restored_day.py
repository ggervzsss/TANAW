"""Combine a day restored from the server backup with the counts recorded after the restore.

A reinstalled or reset desktop has none of the day's observations, only the day's
totals from its last server backup. Those totals are kept as the day's
``restored_baseline`` and added to every rebuild of the day, so counting carries
on from where the backup left off instead of starting again at zero.
"""

from collections import Counter
from typing import Any

RESTORED_BASELINE_KEY = "restored_baseline"

_ADDITIVE_KEYS = (
    "unique_count",
    "confirmed_unique_count",
    "repeat_entry_count",
    "unresolved_observations",
    "qualified_observations",
    "covered_ms",
)
_DAY_MS = 86_400_000


def merge_restored_day(computed: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    """Add a restored day's totals to the totals rebuilt from the observations since."""
    baseline = {key: value for key, value in baseline.items() if key != RESTORED_BASELINE_KEY}
    if not _has_activity(computed):
        return {**computed, **baseline, RESTORED_BASELINE_KEY: baseline}
    merged = dict(computed)
    for key in _ADDITIVE_KEYS:
        merged[key] = _int(computed.get(key)) + _int(baseline.get(key))
    for key in ("entries", "exits"):
        merged[key] = _optional_sum(computed.get(key), baseline.get(key))
    merged["peak_occupancy"] = _optional_max(
        computed.get("peak_occupancy"), baseline.get("peak_occupancy")
    )
    merged["coverage_ratio"] = min(1.0, merged["covered_ms"] / _DAY_MS)
    merged["first_event_at"] = _optional_min(
        computed.get("first_event_at"), baseline.get("first_event_at")
    )
    merged["last_event_at"] = _optional_max(
        computed.get("last_event_at"), baseline.get("last_event_at")
    )
    merged["occupancy_corrections"] = [
        *baseline.get("occupancy_corrections", []),
        *computed.get("occupancy_corrections", []),
    ]
    merged["sources"] = sorted(set(computed.get("sources", [])) | set(baseline.get("sources", [])))
    merged["source_breakdown"] = _merge_sources(
        baseline.get("source_breakdown", []), computed.get("source_breakdown", [])
    )
    merged["movement_state"] = (
        "available"
        if "available" in {computed.get("movement_state"), baseline.get("movement_state")}
        else computed.get("movement_state")
    )
    merged["identification_state"] = _combined_state(
        computed.get("identification_state"), baseline.get("identification_state")
    )
    merged["reconciliation_state"] = (
        "partial"
        if "partial" in {computed.get("reconciliation_state"), baseline.get("reconciliation_state")}
        else computed.get("reconciliation_state")
    )
    merged["incompatible_identity_models"] = bool(
        computed.get("incompatible_identity_models")
    ) or bool(baseline.get("incompatible_identity_models"))
    identifiable = merged["qualified_observations"]
    merged["identification_coverage"] = (
        (identifiable - merged["unresolved_observations"]) / identifiable if identifiable else None
    )
    merged.update(_merge_sex(computed, baseline))
    merged[RESTORED_BASELINE_KEY] = baseline
    return merged


def _has_activity(metrics: dict[str, Any]) -> bool:
    return bool(
        _int(metrics.get("qualified_observations"))
        or _int(metrics.get("covered_ms"))
        or metrics.get("occupancy_corrections")
    )


def _merge_sex(computed: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    sides = [side for side in (computed, baseline) if _int(side.get("unique_count")) > 0]
    if not sides:
        return {
            key: computed.get(key)
            for key in (
                "male_count",
                "female_count",
                "sex_estimation_state",
                "sex_evidence_share",
                "sex_models",
            )
        }
    models = sorted({model for side in sides for model in side.get("sex_models", [])})
    if any(side.get("sex_estimation_state") != "estimated" for side in sides):
        return {
            "male_count": None,
            "female_count": None,
            "sex_estimation_state": "unavailable",
            "sex_evidence_share": None,
            "sex_models": models,
        }
    visitors = sum(_int(side.get("unique_count")) for side in sides)
    weighted = [
        (float(share), _int(side.get("unique_count")))
        for side in sides
        if isinstance(share := side.get("sex_evidence_share"), int | float)
    ]
    evidence_share = (
        sum(share * count for share, count in weighted) / visitors
        if len(weighted) == len(sides)
        else None
    )
    return {
        "male_count": sum(_int(side.get("male_count")) for side in sides),
        "female_count": sum(_int(side.get("female_count")) for side in sides),
        "sex_estimation_state": "estimated",
        "sex_evidence_share": evidence_share,
        "sex_models": models,
    }


def _merge_sources(
    baseline: list[dict[str, Any]], computed: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    sources: dict[int, dict[str, Any]] = {}
    for source in [*baseline, *computed]:
        camera_id = source["camera_id"]
        target = sources.get(camera_id)
        if target is None:
            sources[camera_id] = dict(source)
            continue
        target["analysis_modes"] = sorted(
            set(target.get("analysis_modes", [])) | set(source.get("analysis_modes", []))
        )
        for key in ("entries", "exits"):
            target[key] = _optional_sum(target.get(key), source.get(key))
        for key in ("unique_count", "qualified_observations"):
            target[key] = _int(target.get(key)) + _int(source.get(key))
        for key in ("configuration_revisions", "embedding_spaces"):
            target[key] = sorted(set(target.get(key, [])) | set(source.get(key, [])))
        for key in ("identity_confidence", "matching_decisions"):
            target[key] = dict(Counter(target.get(key, {})) + Counter(source.get(key, {})))
    return [sources[key] for key in sorted(sources)]


def _combined_state(first: Any, second: Any) -> Any:
    states = {first, second}
    if states == {"available"}:
        return "available"
    if states == {"unavailable"}:
        return "unavailable"
    return "partial"


def _int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _optional_sum(first: Any, second: Any) -> int | None:
    if first is None and second is None:
        return None
    return _int(first) + _int(second)


def _optional_max(first: Any, second: Any) -> Any:
    values = [value for value in (first, second) if value is not None]
    return max(values) if values else None


def _optional_min(first: Any, second: Any) -> Any:
    values = [value for value in (first, second) if value is not None]
    return min(values) if values else None
