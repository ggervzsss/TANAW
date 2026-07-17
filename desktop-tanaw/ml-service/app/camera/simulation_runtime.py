from __future__ import annotations

from typing import Any, cast


class SimulationRuntimeMixin:
    """Isolated preparation and cleanup for mock-data records.

    The storage classification remains ``simulation`` so seeded records can never be
    mistaken for official camera evidence. Interactive event generation belongs in
    operator scripts, not in the production desktop runtime.
    """

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)

    def prepare_simulation_counts(
        self,
        *,
        simulation_run_id: str,
        enterprise_id: str,
        enterprise_name: str | None,
        entries: int,
        exits: int,
        unique_count: int,
        peak_occupancy: int,
        period_id: str,
    ) -> dict:
        with self._lock:
            if self._enterprise_id != enterprise_id:
                raise ValueError(
                    f"Desktop is bound to {self._enterprise_id or 'no enterprise'}. "
                    f"Log into {enterprise_name or enterprise_id} before preparing counts."
                )
            camera_id = self._config.camera_id if self._config else None
            camera_name = self._config.camera_name if self._config else None

        summary = self._runtime_store.prepare_simulation_counts(
            simulation_run_id=simulation_run_id,
            entries=entries,
            exits=exits,
            unique_count=unique_count,
            peak_occupancy=peak_occupancy,
            camera_id=camera_id,
            camera_name=camera_name,
            period_id=period_id,
        )
        return {
            **summary,
            "enterprise_id": enterprise_id,
            "enterprise_name": enterprise_name,
            "period": summary["period"],
            "prepared": bool(summary.get("prepared")),
        }

    def reset_simulation_data(self, simulation_run_id: str | None = None) -> dict:
        return cast(dict, self._runtime_store.remove_simulation_data(simulation_run_id))

    def simulation_status(self) -> dict:
        summary = self._runtime_store.metrics_summary(include_submitted=True)
        prepared_run_id = (
            summary["simulation_run_id"] if summary["classification"] == "simulation" else None
        )
        return {
            "running": False,
            "paused": False,
            "state": "idle",
            "mode": "prepared" if prepared_run_id else None,
            "scenario": None,
            "simulation_run_id": prepared_run_id,
            "events_generated": summary["total_events"] if prepared_run_id else 0,
            "events_per_minute": 0,
            "requires_real_camera": False,
            "enterprise_id": self._enterprise_id,
            "enterprise_name": self._enterprise_name,
            "capacity": 0,
            "threshold_percent": 0,
            "duration_minutes": None,
            "started_at": None,
            "completed_at": None,
            "entries": summary["entries"],
            "exits": summary["exits"],
            "current_occupancy": summary["current_occupancy"],
            "peak_occupancy": summary["peak_occupancy"],
            "unique_count": summary["unique_count"],
            "unsubmitted_events": summary["unsubmitted_events"],
        }
