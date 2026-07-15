from __future__ import annotations

import logging
import random
import threading
import time
from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

logger = logging.getLogger(__name__)


class SimulationRuntimeMixin:
    _simulation_thread: threading.Thread | None
    _simulation_stop_event: threading.Event | None
    _simulation_run_id: str | None
    _simulation_mode: str | None
    _simulation_scenario: str | None
    _simulation_started_at: str | None
    _simulation_started_monotonic: float | None
    _simulation_completed_at: str | None

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

    def start_simulation(
        self,
        *,
        simulation_run_id: str,
        mode: str = "virtual",
        scenario: str = "normal",
        events_per_minute: int = 12,
        capacity: int = 100,
        starting_occupancy: int | None = None,
        duration_minutes: int | None = None,
        threshold_percent: int = 90,
        entry_probability: float | None = None,
        unique_entry_rate: float = 0.88,
    ) -> dict:
        with self._lock:
            if not self._enterprise_id:
                raise ValueError("Log into an enterprise account before starting a simulation.")
            if mode == "hybrid" and (not self._state.running or self._config is None):
                raise ValueError("Hybrid simulation mode requires an active real camera session.")

        self.stop_simulation()
        if starting_occupancy is not None:
            self._set_simulation_starting_occupancy(simulation_run_id, mode, starting_occupancy)

        stop_event = threading.Event()
        with self._lock:
            self._simulation_stop_event = stop_event
            self._simulation_run_id = simulation_run_id
            self._simulation_mode = mode
            self._simulation_scenario = scenario
            self._simulation_state = "running"
            self._simulation_paused = False
            self._simulation_events_per_minute = max(1, min(events_per_minute, 120))
            self._simulation_capacity = max(1, capacity)
            self._simulation_threshold_percent = max(1, min(threshold_percent, 100))
            self._simulation_duration_minutes = duration_minutes
            self._simulation_started_at = datetime.now(UTC).isoformat()
            self._simulation_started_monotonic = time.monotonic()
            self._simulation_completed_at = None
            self._simulation_entry_probability = entry_probability
            self._simulation_unique_entry_rate = max(0.0, min(unique_entry_rate, 1.0))
            self._simulation_events_generated = 0
            self._simulation_thread = threading.Thread(
                target=self._simulation_event_loop,
                args=(stop_event, simulation_run_id),
                name="tanaw-live-simulation",
                daemon=True,
            )
            self._simulation_thread.start()
        return self.simulation_status()

    def pause_simulation(self) -> dict:
        with self._lock:
            if self._simulation_state != "running":
                raise ValueError("No running simulation is available to pause.")
            self._simulation_paused = True
            self._simulation_state = "paused"
        return self.simulation_status()

    def resume_simulation(self) -> dict:
        with self._lock:
            if self._simulation_state != "paused" or self._simulation_thread is None:
                raise ValueError("No paused simulation is available to resume.")
            self._simulation_paused = False
            self._simulation_state = "running"
        return self.simulation_status()

    def stop_simulation(self) -> dict:
        with self._lock:
            thread = self._simulation_thread
            stop_event = self._simulation_stop_event
            if stop_event is not None:
                stop_event.set()

        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=2)

        with self._lock:
            self._simulation_thread = None
            self._simulation_stop_event = None
            self._simulation_paused = False
            if self._simulation_state in {"running", "paused"}:
                self._simulation_state = "stopped"
                self._simulation_completed_at = datetime.now(UTC).isoformat()
        return self.simulation_status()

    def reset_simulation_data(self, simulation_run_id: str | None = None) -> dict:
        with self._lock:
            should_stop_current_run = (
                simulation_run_id is None or self._simulation_run_id == simulation_run_id
            )
        if should_stop_current_run:
            self.stop_simulation()
        removed = self._runtime_store.remove_simulation_data(simulation_run_id)
        with self._lock:
            if simulation_run_id is None or self._simulation_run_id == simulation_run_id:
                self._simulation_run_id = None
                self._simulation_mode = None
                self._simulation_scenario = None
                self._simulation_state = "idle"
                self._simulation_events_generated = 0
                self._simulation_started_at = None
                self._simulation_started_monotonic = None
                self._simulation_completed_at = None
        return cast(dict, removed)

    def append_simulation_event(self, direction: str) -> dict:
        with self._lock:
            if self._simulation_state not in {"running", "paused"} or not self._simulation_run_id:
                raise ValueError("Start a simulation before adding manual events.")
            simulation_run_id = self._simulation_run_id
            mode = self._simulation_mode or "virtual"

        if not self._append_simulation_count_event(direction, simulation_run_id, mode):
            if direction == "exit":
                raise ValueError("An exit cannot be recorded while occupancy is zero.")
            raise ValueError("The simulated event could not be recorded.")
        return self.simulation_status()

    def simulation_status(self) -> dict:
        summary = self._runtime_store.metrics_summary(include_submitted=True)
        with self._lock:
            running = self._simulation_thread is not None and self._simulation_thread.is_alive()
            prepared_run_id = (
                summary["simulation_run_id"]
                if summary["classification"] in {"simulation"}
                else None
            )
            return {
                "running": running and self._simulation_state == "running",
                "paused": running and self._simulation_state == "paused",
                "state": self._simulation_state,
                "mode": self._simulation_mode or ("prepared" if prepared_run_id else None),
                "scenario": self._simulation_scenario,
                "simulation_run_id": self._simulation_run_id or prepared_run_id,
                "events_generated": self._simulation_events_generated
                if self._simulation_run_id
                else summary["total_events"],
                "events_per_minute": self._simulation_events_per_minute,
                "requires_real_camera": self._simulation_mode == "hybrid",
                "enterprise_id": self._enterprise_id,
                "enterprise_name": self._enterprise_name,
                "capacity": self._simulation_capacity,
                "threshold_percent": self._simulation_threshold_percent,
                "duration_minutes": self._simulation_duration_minutes,
                "started_at": self._simulation_started_at,
                "completed_at": self._simulation_completed_at,
                "entries": summary["entries"],
                "exits": summary["exits"],
                "current_occupancy": summary["current_occupancy"],
                "peak_occupancy": summary["peak_occupancy"],
                "unique_count": summary["unique_count"],
                "unsubmitted_events": summary["unsubmitted_events"],
            }

    def _current_classification_locked(self) -> str:
        if self._simulation_state in {"running", "paused"}:
            return "simulation"
        return "official"

    def generate_simulation_report(
        self,
        report_id: str | None,
        period_id: str,
        notes: str | None = None,
        payload: dict | None = None,
    ) -> dict:
        with self._lock:
            simulation_run_id = self._simulation_run_id
        if not simulation_run_id:
            raise ValueError("Hybrid simulation mode is not running.")

        resolved_report_id = report_id or f"REP-{int(time.time()) % 1_000_000:06d}"
        report_payload = {
            "status": "Submitted",
            "classification": "simulation",
            "simulationRunId": simulation_run_id,
            **(payload or {}),
        }
        return cast(
            dict,
            self.create_local_report_revision(
                resolved_report_id,
                period_id,
                notes or "Monthly camera analytics submitted for LGU review.",
                report_payload,
                classification="simulation",
                simulation_run_id=simulation_run_id,
            ),
        )

    def _simulation_event_loop(self, stop_event: threading.Event, simulation_run_id: str) -> None:
        rng = random.Random(simulation_run_id)
        while not stop_event.is_set():
            with self._lock:
                mode = self._simulation_mode or "virtual"
                if mode == "hybrid" and (not self._state.running or self._config is None):
                    break
                paused = self._simulation_paused
                events_per_minute = self._simulation_events_per_minute
                duration_minutes = self._simulation_duration_minutes
                started_monotonic = self._simulation_started_monotonic

            if paused:
                stop_event.wait(0.25)
                continue

            jitter = rng.uniform(0.82, 1.18)
            if stop_event.wait(max(0.5, (60.0 / events_per_minute) * jitter)):
                break

            with self._lock:
                if self._simulation_paused:
                    continue

            if (
                duration_minutes is not None
                and started_monotonic is not None
                and time.monotonic() - started_monotonic >= duration_minutes * 60
            ):
                with self._lock:
                    self._simulation_state = "completed"
                    self._simulation_completed_at = datetime.now(UTC).isoformat()
                break

            summary = self._runtime_store.metrics_summary(include_submitted=True)
            occupancy = int(summary["current_occupancy"] or 0)
            direction = self._next_simulation_direction(rng, occupancy)
            if direction is None:
                with self._lock:
                    self._simulation_state = "completed"
                    self._simulation_completed_at = datetime.now(UTC).isoformat()
                break

            self._append_simulation_count_event(direction, simulation_run_id, mode, rng)

        with self._lock:
            if self._simulation_thread is threading.current_thread():
                self._simulation_thread = None
                self._simulation_stop_event = None

    def _next_simulation_direction(self, rng: random.Random, occupancy: int) -> str | None:
        with self._lock:
            scenario = self._simulation_scenario or "normal"
            capacity = max(1, self._simulation_capacity)
            custom_probability = self._simulation_entry_probability

        if scenario == "evacuation" and occupancy <= 0:
            return None
        if occupancy <= 0:
            return "entry"

        occupancy_ratio = occupancy / capacity
        if scenario == "morning-rush":
            entry_probability = 0.76 if occupancy_ratio < 0.85 else 0.42
        elif scenario == "event-opening":
            entry_probability = 0.84 if occupancy_ratio < 0.8 else 0.55
        elif scenario == "overcrowding":
            entry_probability = 0.92 if occupancy_ratio < 1.1 else 0.32
        elif scenario == "evacuation":
            entry_probability = 0.06
        elif scenario == "custom":
            entry_probability = custom_probability if custom_probability is not None else 0.5
        else:
            entry_probability = 0.57 if occupancy_ratio < 0.55 else 0.43

        return "entry" if rng.random() < entry_probability else "exit"

    def _append_simulation_count_event(
        self,
        direction: str,
        simulation_run_id: str,
        mode: str,
        rng: random.Random | None = None,
    ) -> bool:
        rng = rng or random.Random(f"{simulation_run_id}:{time.time_ns()}")
        summary = self._runtime_store.metrics_summary(include_submitted=True)
        entries = int(summary["entries"] or 0)
        exits = int(summary["exits"] or 0)
        occupancy = int(summary["current_occupancy"] or 0)
        if direction == "exit" and occupancy <= 0:
            return False

        next_entries = entries + (1 if direction == "entry" else 0)
        next_exits = exits + (1 if direction == "exit" else 0)
        next_occupancy = max(0, occupancy + (1 if direction == "entry" else -1))
        with self._lock:
            event_index = self._simulation_events_generated + 1
            camera_id = self._config.camera_id if mode == "hybrid" and self._config else None
            camera_name = (
                self._config.camera_name if mode == "hybrid" and self._config else "Simulation Lab"
            )
            unique_entry_rate = self._simulation_unique_entry_rate

        is_unique_entry = direction == "entry" and rng.random() < unique_entry_rate
        visitor_id = str(uuid4()) if is_unique_entry and rng.random() < 0.88 else None
        payload = {
            "camera_id": camera_id,
            "camera_name": camera_name,
            "direction": direction,
            "track_id": 100_000 + event_index,
            "source_track_id": 100_000 + event_index,
            "visitor_id": visitor_id,
            "is_unique_entry": is_unique_entry,
            "reid_score": round(rng.uniform(0.72, 0.96), 3) if visitor_id else None,
            "reid_decision": "new"
            if visitor_id
            else ("degraded_no_embedding" if is_unique_entry else None),
            "identity_confidence": "high"
            if visitor_id
            else ("degraded" if is_unique_entry else None),
            "identity_state": "confirmed" if visitor_id else "unconfirmed",
            "identity_score": round(rng.uniform(0.7, 0.98), 3),
            "identity_source": "appearance" if visitor_id else "virtual-sensor",
            "classification": "simulation",
            "simulation_run_id": simulation_run_id,
            "counts": {
                "entry": next_entries,
                "exit": next_exits,
                "occupancy": next_occupancy,
            },
        }
        try:
            self._runtime_store.append_event(payload)
        except Exception as exc:
            self._record_persistence_failure("append_simulation_event", exc)
            return False

        with self._lock:
            self._simulation_events_generated += 1
        return True

    def _set_simulation_starting_occupancy(
        self, simulation_run_id: str, mode: str, starting_occupancy: int
    ) -> None:
        summary = self._runtime_store.metrics_summary(include_submitted=True)
        current_occupancy = int(summary["current_occupancy"] or 0)
        direction = "entry" if starting_occupancy > current_occupancy else "exit"
        difference = abs(starting_occupancy - current_occupancy)
        rng = random.Random(f"{simulation_run_id}:starting-occupancy")
        for _ in range(difference):
            if not self._append_simulation_count_event(direction, simulation_run_id, mode, rng):
                break
