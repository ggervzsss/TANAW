from __future__ import annotations

import logging
from typing import Any

from app.camera.runtime_types import (
    ProcessingSession,
)

logger = logging.getLogger(__name__)


class CoverageRuntimeMixin:
    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)

    def _start_monitoring_coverage(self, session: ProcessingSession) -> None:
        if session.monitoring_session_id is None:
            return
        started_at = self._utc_now().isoformat()
        config = session.config
        self._runtime_store.start_monitoring_session(
            monitoring_session_id=session.monitoring_session_id,
            camera_id=config.camera_id,
            camera_name=config.camera_name,
            central_camera_id=getattr(config, "central_camera_id", None),
            started_at=started_at,
        )
        self._runtime_store.record_coverage_gap(
            monitoring_session_id=session.monitoring_session_id,
            camera_id=config.camera_id,
            camera_name=config.camera_name,
            central_camera_id=getattr(config, "central_camera_id", None),
            started_at=started_at,
            reason="initial_connection",
            recoverable=True,
            detail="Waiting for the first valid camera frame.",
        )

    def _record_coverage_gap(
        self,
        session: ProcessingSession,
        *,
        reason: str,
        recoverable: bool,
        detail: str,
    ) -> None:
        if session.monitoring_session_id is None:
            return
        config = session.config
        try:
            self._runtime_store.record_coverage_gap(
                monitoring_session_id=session.monitoring_session_id,
                camera_id=config.camera_id,
                camera_name=config.camera_name,
                central_camera_id=getattr(config, "central_camera_id", None),
                started_at=self._utc_now().isoformat(),
                reason=reason,
                recoverable=recoverable,
                detail=detail,
            )
        except Exception as exc:
            logger.error("Unable to persist camera coverage gap: %s", exc)

    def _end_monitoring_coverage(
        self, session: ProcessingSession, *, reason: str, error: bool
    ) -> None:
        if session.monitoring_session_id is None:
            return
        try:
            self._runtime_store.end_monitoring_session(
                session.monitoring_session_id,
                ended_at=self._utc_now().isoformat(),
                reason=reason,
                error=error,
            )
        except Exception as exc:
            logger.error("Unable to close camera monitoring session: %s", exc)
