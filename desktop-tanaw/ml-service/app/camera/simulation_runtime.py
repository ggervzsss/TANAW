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
    _mock_thread: threading.Thread | None
    _mock_stop_event: threading.Event | None
    _mock_run_id: str | None
    _mock_mode: str | None
    _mock_scenario: str | None
    _mock_started_at: str | None
    _mock_started_monotonic: float | None
    _mock_completed_at: str | None

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)

    def prepare_mock_counts(
        self,
        *,
        mock_run_id: str,
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

        summary = self._runtime_store.prepare_mock_counts(
            mock_run_id=mock_run_id,
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

    def start_mock_mode(
        self,
        *,
        mock_run_id: str,
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
                raise ValueError("Hybrid mock mode requires an active real camera session.")

        self.stop_mock_mode()
        if starting_occupancy is not None:
            self._set_mock_starting_occupancy(mock_run_id, mode, starting_occupancy)

        stop_event = threading.Event()
        with self._lock:
            self._mock_stop_event = stop_event
            self._mock_run_id = mock_run_id
            self._mock_mode = mode
            self._mock_scenario = scenario
            self._mock_state = "running"
            self._mock_paused = False
            self._mock_events_per_minute = max(1, min(events_per_minute, 120))
            self._mock_capacity = max(1, capacity)
            self._mock_threshold_percent = max(1, min(threshold_percent, 100))
            self._mock_duration_minutes = duration_minutes
            self._mock_started_at = datetime.now(UTC).isoformat()
            self._mock_started_monotonic = time.monotonic()
            self._mock_completed_at = None
            self._mock_entry_probability = entry_probability
            self._mock_unique_entry_rate = max(0.0, min(unique_entry_rate, 1.0))
            self._mock_events_generated = 0
            self._mock_thread = threading.Thread(
                target=self._mock_event_loop,
                args=(stop_event, mock_run_id),
                name="tanaw-live-simulation",
                daemon=True,
            )
            self._mock_thread.start()
        return self.mock_status()

    def pause_mock_mode(self) -> dict:
        with self._lock:
            if self._mock_state != "running":
                raise ValueError("No running simulation is available to pause.")
            self._mock_paused = True
            self._mock_state = "paused"
        return self.mock_status()

    def resume_mock_mode(self) -> dict:
        with self._lock:
            if self._mock_state != "paused" or self._mock_thread is None:
                raise ValueError("No paused simulation is available to resume.")
            self._mock_paused = False
            self._mock_state = "running"
        return self.mock_status()

    def stop_mock_mode(self) -> dict:
        with self._lock:
            thread = self._mock_thread
            stop_event = self._mock_stop_event
            if stop_event is not None:
                stop_event.set()

        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=2)

        with self._lock:
            self._mock_thread = None
            self._mock_stop_event = None
            self._mock_paused = False
            if self._mock_state in {"running", "paused"}:
                self._mock_state = "stopped"
                self._mock_completed_at = datetime.now(UTC).isoformat()
        return self.mock_status()

    def reset_mock_data(self, mock_run_id: str | None = None) -> dict:
        with self._lock:
            should_stop_current_run = mock_run_id is None or self._mock_run_id == mock_run_id
        if should_stop_current_run:
            self.stop_mock_mode()
        removed = self._runtime_store.remove_mock_data(mock_run_id)
        with self._lock:
            if mock_run_id is None or self._mock_run_id == mock_run_id:
                self._mock_run_id = None
                self._mock_mode = None
                self._mock_scenario = None
                self._mock_state = "idle"
                self._mock_events_generated = 0
                self._mock_started_at = None
                self._mock_started_monotonic = None
                self._mock_completed_at = None
        return cast(dict, removed)

    def append_mock_event(self, direction: str) -> dict:
        with self._lock:
            if self._mock_state not in {"running", "paused"} or not self._mock_run_id:
                raise ValueError("Start a simulation before adding manual events.")
            mock_run_id = self._mock_run_id
            mode = self._mock_mode or "virtual"

        if not self._append_mock_count_event(direction, mock_run_id, mode):
            if direction == "exit":
                raise ValueError("An exit cannot be recorded while occupancy is zero.")
            raise ValueError("The simulated event could not be recorded.")
        return self.mock_status()

    def mock_status(self) -> dict:
        summary = self._runtime_store.metrics_summary(include_submitted=True)
        with self._lock:
            running = self._mock_thread is not None and self._mock_thread.is_alive()
            prepared_run_id = (
                summary["mock_run_id"] if summary["source_kind"] in {"mock", "hybrid"} else None
            )
            return {
                "running": running and self._mock_state == "running",
                "paused": running and self._mock_state == "paused",
                "state": self._mock_state,
                "mode": self._mock_mode or ("prepared" if prepared_run_id else None),
                "scenario": self._mock_scenario,
                "mock_run_id": self._mock_run_id or prepared_run_id,
                "events_generated": self._mock_events_generated
                if self._mock_run_id
                else summary["total_events"],
                "events_per_minute": self._mock_events_per_minute,
                "requires_real_camera": self._mock_mode == "hybrid",
                "enterprise_id": self._enterprise_id,
                "enterprise_name": self._enterprise_name,
                "capacity": self._mock_capacity,
                "threshold_percent": self._mock_threshold_percent,
                "duration_minutes": self._mock_duration_minutes,
                "started_at": self._mock_started_at,
                "completed_at": self._mock_completed_at,
                "entries": summary["entries"],
                "exits": summary["exits"],
                "current_occupancy": summary["current_occupancy"],
                "peak_occupancy": summary["peak_occupancy"],
                "unique_count": summary["unique_count"],
                "unsubmitted_events": summary["unsubmitted_events"],
            }

    def _current_source_kind_locked(self) -> str:
        if self._mock_state in {"running", "paused"}:
            return "hybrid" if self._mock_mode == "hybrid" else "mock"
        return "real"

    def generate_mock_report(
        self,
        report_id: str | None,
        period_id: str,
        notes: str | None = None,
        payload: dict | None = None,
    ) -> dict:
        with self._lock:
            mock_run_id = self._mock_run_id
        if not mock_run_id:
            raise ValueError("Hybrid mock mode is not running.")

        resolved_report_id = report_id or f"REP-{int(time.time()) % 1_000_000:06d}"
        report_payload = {
            "status": "Submitted",
            "sourceKind": "hybrid",
            "mockRunId": mock_run_id,
            **(payload or {}),
        }
        return cast(
            dict,
            self.create_local_report_revision(
                resolved_report_id,
                period_id,
                notes or "Monthly camera analytics submitted for LGU review.",
                report_payload,
                source_kind="hybrid",
                mock_run_id=mock_run_id,
            ),
        )

    def _mock_event_loop(self, stop_event: threading.Event, mock_run_id: str) -> None:
        rng = random.Random(mock_run_id)
        while not stop_event.is_set():
            with self._lock:
                mode = self._mock_mode or "virtual"
                if mode == "hybrid" and (not self._state.running or self._config is None):
                    break
                paused = self._mock_paused
                events_per_minute = self._mock_events_per_minute
                duration_minutes = self._mock_duration_minutes
                started_monotonic = self._mock_started_monotonic

            if paused:
                stop_event.wait(0.25)
                continue

            jitter = rng.uniform(0.82, 1.18)
            if stop_event.wait(max(0.5, (60.0 / events_per_minute) * jitter)):
                break

            with self._lock:
                if self._mock_paused:
                    continue

            if (
                duration_minutes is not None
                and started_monotonic is not None
                and time.monotonic() - started_monotonic >= duration_minutes * 60
            ):
                with self._lock:
                    self._mock_state = "completed"
                    self._mock_completed_at = datetime.now(UTC).isoformat()
                break

            summary = self._runtime_store.metrics_summary(include_submitted=True)
            occupancy = int(summary["current_occupancy"] or 0)
            direction = self._next_mock_direction(rng, occupancy)
            if direction is None:
                with self._lock:
                    self._mock_state = "completed"
                    self._mock_completed_at = datetime.now(UTC).isoformat()
                break

            self._append_mock_count_event(direction, mock_run_id, mode, rng)

        with self._lock:
            if self._mock_thread is threading.current_thread():
                self._mock_thread = None
                self._mock_stop_event = None

    def _next_mock_direction(self, rng: random.Random, occupancy: int) -> str | None:
        with self._lock:
            scenario = self._mock_scenario or "normal"
            capacity = max(1, self._mock_capacity)
            custom_probability = self._mock_entry_probability

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

    def _append_mock_count_event(
        self,
        direction: str,
        mock_run_id: str,
        mode: str,
        rng: random.Random | None = None,
    ) -> bool:
        rng = rng or random.Random(f"{mock_run_id}:{time.time_ns()}")
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
            event_index = self._mock_events_generated + 1
            camera_id = self._config.camera_id if mode == "hybrid" and self._config else None
            camera_name = (
                self._config.camera_name if mode == "hybrid" and self._config else "Simulation Lab"
            )
            unique_entry_rate = self._mock_unique_entry_rate

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
            "source_kind": "hybrid" if mode == "hybrid" else "mock",
            "mock_run_id": mock_run_id,
            "counts": {
                "entry": next_entries,
                "exit": next_exits,
                "occupancy": next_occupancy,
            },
        }
        try:
            self._runtime_store.append_event(payload)
        except Exception as exc:
            self._record_persistence_failure("append_mock_event", exc)
            return False

        with self._lock:
            self._mock_events_generated += 1
        return True

    def _set_mock_starting_occupancy(
        self, mock_run_id: str, mode: str, starting_occupancy: int
    ) -> None:
        summary = self._runtime_store.metrics_summary(include_submitted=True)
        current_occupancy = int(summary["current_occupancy"] or 0)
        direction = "entry" if starting_occupancy > current_occupancy else "exit"
        difference = abs(starting_occupancy - current_occupancy)
        rng = random.Random(f"{mock_run_id}:starting-occupancy")
        for _ in range(difference):
            if not self._append_mock_count_event(direction, mock_run_id, mode, rng):
                break
