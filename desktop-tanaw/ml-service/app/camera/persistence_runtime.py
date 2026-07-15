from __future__ import annotations

import logging
from typing import Any

from app.camera.auth import redact_stream_credentials
from app.camera.runtime_types import (
    ProcessingSession,
)
from app.identity import VisitorDecision
from app.tracking import ResolvedTrack

logger = logging.getLogger(__name__)


class PersistenceRuntimeMixin:
    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)

    def _persist_count_event(
        self,
        session: ProcessingSession,
        track: ResolvedTrack,
        direction: str,
        visitor_decision: VisitorDecision | None = None,
    ) -> None:
        with self._lock:
            if not self._is_current_session_locked(session):
                return

            counts = self._counter.counts.as_dict()
            visitor_fields = visitor_decision.as_event_fields() if visitor_decision else {}
            try:
                self._runtime_store.append_event(
                    {
                        "camera_id": self._config.camera_id if self._config else None,
                        "camera_name": self._config.camera_name if self._config else None,
                        "direction": direction,
                        "track_id": track.track_id,
                        "source_track_id": track.source_track_id,
                        "identity_state": track.identity_state,
                        "identity_score": track.identity_score,
                        "identity_source": track.identity_source,
                        "classification": "official",
                        "simulation_run_id": None,
                        **visitor_fields,
                        "counts": counts,
                    }
                )
            except Exception as exc:
                self._record_persistence_failure("append_count_event", exc, session=session)
                raise RuntimeError(
                    "A camera count could not be durably recorded; monitoring was stopped "
                    "to prevent an inaccurate report."
                ) from exc
            self._persist_session_locked()

    def _persist_session_locked(self) -> None:
        counts = self._counter.counts.as_dict()
        payload = {
            "running": self._state.running,
            "status": self._state.status,
            "error": redact_stream_credentials(self._state.error) if self._state.error else None,
            "camera_id": self._config.camera_id if self._config else None,
            "camera_name": self._config.camera_name if self._config else None,
            "camera_config": self._safe_config_dump() if self._config else None,
            "counts": {
                **counts,
                "running": self._state.running,
                "status": self._state.status,
                "error": redact_stream_credentials(self._state.error)
                if self._state.error
                else None,
            },
        }
        try:
            self._runtime_store.save_session(payload)
            saved_payload = self._runtime_store.load_session()
            self._session_updated_at = saved_payload.get("updated_at") if saved_payload else None
        except Exception as exc:
            self._record_persistence_failure("save_session_snapshot", exc)
            return

    def _record_persistence_failure(
        self,
        operation: str,
        error: BaseException,
        *,
        session: ProcessingSession | None = None,
    ) -> None:
        attempt_count = getattr(error, "attempts", 1)
        safe_detail = redact_stream_credentials(str(error))
        try:
            self._runtime_store.record_persistence_error(
                operation=operation,
                reason="sqlite_write_failed",
                detail=safe_detail,
                attempt_count=attempt_count,
                occurred_at=self._utc_now().isoformat(),
            )
        except Exception as diagnostic_error:
            logger.error(
                "Local persistence failed and its diagnostic could not be recorded: %s",
                diagnostic_error,
            )
        active_session = session or self._active_session
        if active_session is not None:
            self._record_coverage_gap(
                active_session,
                reason="persistence_failure",
                recoverable=False,
                detail=safe_detail,
            )
