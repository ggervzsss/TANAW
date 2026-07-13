from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TelemetryMetricDefinition:
    unit: str
    allowed_grains: frozenset[str]
    projects_to_live_state: str | None
    integral: bool


# This catalog is the executable form of ADR-002 for sequenced telemetry. Report
# aliases from the removed v1 snapshot contract are intentionally not accepted.
TELEMETRY_METRIC_CATALOG: dict[str, TelemetryMetricDefinition] = {
    "visitor_entries": TelemetryMetricDefinition(
        unit="crossings",
        allowed_grains=frozenset({"camera", "site"}),
        projects_to_live_state="entries_window",
        integral=True,
    ),
    "visitor_exits": TelemetryMetricDefinition(
        unit="crossings",
        allowed_grains=frozenset({"camera", "site"}),
        projects_to_live_state="exits_window",
        integral=True,
    ),
    "occupancy_current": TelemetryMetricDefinition(
        unit="people",
        allowed_grains=frozenset({"camera", "site"}),
        projects_to_live_state="current_occupancy",
        integral=True,
    ),
    "occupancy_peak": TelemetryMetricDefinition(
        unit="people",
        allowed_grains=frozenset({"site"}),
        projects_to_live_state="peak_occupancy_window",
        integral=True,
    ),
    "venue_local_unique_estimate": TelemetryMetricDefinition(
        unit="estimated_visitors",
        allowed_grains=frozenset({"camera", "site"}),
        projects_to_live_state="unique_visitor_estimate_window",
        integral=True,
    ),
    "monitored_duration": TelemetryMetricDefinition(
        unit="seconds",
        allowed_grains=frozenset({"camera", "site"}),
        projects_to_live_state=None,
        integral=True,
    ),
    "coverage_ratio": TelemetryMetricDefinition(
        unit="ratio",
        allowed_grains=frozenset({"camera", "site"}),
        projects_to_live_state=None,
        integral=False,
    ),
}

CAMERA_HEALTH_STATES = frozenset(
    {
        "streaming",
        "reconnecting",
        "unavailable",
        "credential_error",
        "stopped",
        "unknown",
    }
)

ERROR_CAMERA_HEALTH_STATES = frozenset({"unavailable", "credential_error"})
