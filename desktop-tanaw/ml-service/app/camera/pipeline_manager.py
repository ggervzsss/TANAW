from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from typing import Any

from app.camera.camera_manager import CameraProcessingManager
from app.config.camera_config import CameraStartRequest, CameraTestRequest
from app.runtime.hardware import get_runtime_capabilities

logger = logging.getLogger(__name__)

DEFAULT_MAX_CONCURRENT_CAMERAS = 2
MAX_CONFIGURABLE_CONCURRENT_CAMERAS = 16


class CameraCapacityError(ValueError):
    pass


class CameraPipelineRegistry:
    """Owns one isolated processing pipeline per physical camera."""

    def __init__(
        self,
        app_data_dir: str | None = None,
        max_concurrent_cameras: int | None = None,
        pipeline_factory: Callable[..., CameraProcessingManager] = CameraProcessingManager,
        reporting_manager: CameraProcessingManager | None = None,
    ) -> None:
        self._app_data_dir = app_data_dir
        self._max_concurrent_cameras = _max_concurrent_cameras(max_concurrent_cameras)
        self._lock = threading.RLock()
        self._lifecycle_lock = threading.RLock()
        self._pipelines: dict[int, CameraProcessingManager] = {}
        self._config_fingerprints: dict[int, str] = {}
        self._pending_starts: dict[int, str] = {}
        self._enterprise_id: str | None = None
        self._enterprise_name: str | None = None
        self._pipeline_factory = pipeline_factory
        self._reporting = reporting_manager or CameraProcessingManager(app_data_dir)

    @property
    def max_concurrent_cameras(self) -> int:
        return self._max_concurrent_cameras

    def bind_enterprise(self, enterprise_id: str, enterprise_name: str | None = None) -> dict:
        normalized_id = enterprise_id.strip()
        normalized_name = enterprise_name.strip() if enterprise_name else None
        if not normalized_id:
            raise ValueError("Enterprise ID is required.")

        with self._lifecycle_lock:
            with self._lock:
                changed = self._enterprise_id != normalized_id
                if not changed:
                    if normalized_name:
                        self._enterprise_name = normalized_name
                    return {
                        "enterprise_id": normalized_id,
                        "enterprise_name": self._enterprise_name,
                        "changed": False,
                        "session_restored": False,
                    }

            self._stop_all_locked()
            context = self._reporting.bind_enterprise(
                normalized_id, normalized_name, restore_session=False
            )
            with self._lock:
                self._enterprise_id = normalized_id
                self._enterprise_name = normalized_name
                self._pipelines.clear()
                self._config_fingerprints.clear()
            logger.info("Bound camera registry to enterprise %s.", normalized_id)
            return {
                **context,
                "session_restored": False,
            }

    def test_connection(self, payload: CameraTestRequest) -> tuple[bool, str]:
        logger.info(
            "Camera stream test started.",
            extra={"enterprise_id": self._enterprise_id, "camera_id": payload.camera_id},
        )
        result = self._reporting.test_connection(
            payload.stream_url, payload.camera_type, payload.username, payload.password
        )
        logger.log(
            logging.INFO if result[0] else logging.WARNING,
            "Camera stream test succeeded." if result[0] else "Camera stream test failed.",
            extra={"enterprise_id": self._enterprise_id, "camera_id": payload.camera_id},
        )
        return result

    def start(self, config: CameraStartRequest) -> bool:
        if config.camera_id is None:
            raise ValueError("Camera ID is required to start camera processing.")

        with self._lifecycle_lock:
            try:
                return self._start_locked(config)
            except CameraCapacityError:
                raise
            except Exception:
                logger.exception("Camera %s failed to start.", config.camera_id)
                raise

    def request_start(self, config: CameraStartRequest) -> bool:
        """Accept a camera start without blocking on stream and model initialization."""
        if config.camera_id is None:
            raise ValueError("Camera ID is required to start camera processing.")
        camera_id = config.camera_id
        fingerprint = config.model_dump_json()

        with self._lock:
            self._require_enterprise_locked()
            existing = self._pipelines.get(camera_id)
            if (
                existing is not None
                and existing.running
                and self._config_fingerprints.get(camera_id) == fingerprint
            ):
                logger.info("Ignored duplicate start for camera %s.", camera_id)
                return False
            if camera_id in self._pending_starts:
                logger.info("Ignored in-flight duplicate start for camera %s.", camera_id)
                return False
            self._raise_if_capacity_reached_locked(camera_id)
            self._pending_starts[camera_id] = fingerprint

        thread = threading.Thread(
            target=self._run_requested_start,
            args=(config, fingerprint),
            name=f"tanaw-camera-{camera_id}-startup",
            daemon=True,
        )
        try:
            thread.start()
        except Exception:
            with self._lock:
                if self._pending_starts.get(camera_id) == fingerprint:
                    self._pending_starts.pop(camera_id, None)
            raise
        return True

    def _run_requested_start(self, config: CameraStartRequest, fingerprint: str) -> None:
        camera_id = config.camera_id
        if camera_id is None:
            return

        with self._lifecycle_lock:
            with self._lock:
                if self._pending_starts.get(camera_id) != fingerprint:
                    return
            try:
                self._start_locked(config)
            except Exception:
                logger.exception("Camera %s failed during requested startup.", camera_id)
            finally:
                with self._lock:
                    if self._pending_starts.get(camera_id) == fingerprint:
                        self._pending_starts.pop(camera_id, None)

    def _start_locked(self, config: CameraStartRequest) -> bool:
        camera_id = config.camera_id
        if camera_id is None:
            raise ValueError("Camera ID is required to start camera processing.")
        fingerprint = config.model_dump_json()

        with self._lock:
            self._require_enterprise_locked()
            existing = self._pipelines.get(camera_id)
            if (
                existing is not None
                and existing.running
                and self._config_fingerprints.get(camera_id) == fingerprint
            ):
                logger.info("Ignored duplicate start for camera %s.", camera_id)
                return False
            self._raise_if_capacity_reached_locked(camera_id)
            enterprise_id = self._enterprise_id
            enterprise_name = self._enterprise_name

        if existing is not None:
            existing.stop()
        else:
            existing = self._pipeline_factory(self._app_data_dir, camera_id=camera_id)
            existing.bind_enterprise(enterprise_id or "", enterprise_name, restore_session=False)
            with self._lock:
                self._pipelines[camera_id] = existing

        try:
            existing.start(config)
        except Exception:
            with self._lock:
                self._config_fingerprints.pop(camera_id, None)
            raise

        with self._lock:
            self._config_fingerprints[camera_id] = fingerprint
        logger.info("Started isolated processing pipeline for camera %s.", camera_id)
        return True

    def _require_enterprise_locked(self) -> None:
        if self._enterprise_id is None:
            raise ValueError("An enterprise context must be selected first.")

    def _raise_if_capacity_reached_locked(self, camera_id: int) -> None:
        active_other_camera_ids = {
            other_id
            for other_id, pipeline in self._pipelines.items()
            if other_id != camera_id and pipeline.running
        }
        pending_other_camera_ids = set(self._pending_starts) - {camera_id}
        if len(active_other_camera_ids | pending_other_camera_ids) < self._max_concurrent_cameras:
            return
        logger.warning(
            "Camera worker capacity rejected a start request.",
            extra={
                "enterprise_id": self._enterprise_id,
                "camera_id": camera_id,
                "max_concurrent_cameras": self._max_concurrent_cameras,
            },
        )
        raise CameraCapacityError(
            f"Camera worker capacity reached ({self._max_concurrent_cameras} concurrent cameras)."
        )

    def stop(self, camera_id: int) -> bool:
        with self._lifecycle_lock:
            with self._lock:
                self._pending_starts.pop(camera_id, None)
                pipeline = self._pipelines.get(camera_id)
            if pipeline is None:
                return False
            was_running = pipeline.running
            pipeline.stop()
            with self._lock:
                self._config_fingerprints.pop(camera_id, None)
            logger.info("Stopped processing pipeline for camera %s.", camera_id)
            return was_running

    def stop_all(self) -> int:
        with self._lifecycle_lock:
            return self._stop_all_locked()

    def _stop_all_locked(self) -> int:
        with self._lock:
            self._pending_starts.clear()
            pipelines = list(self._pipelines.items())
        stopped = 0
        for camera_id, pipeline in pipelines:
            if pipeline.running:
                stopped += 1
            pipeline.stop()
            logger.info("Stopped processing pipeline for camera %s during cleanup.", camera_id)
        with self._lock:
            self._config_fingerprints.clear()
        return stopped

    def pipeline(self, camera_id: int) -> CameraProcessingManager | None:
        with self._lock:
            return self._pipelines.get(camera_id)

    def require_pipeline(self, camera_id: int) -> CameraProcessingManager:
        pipeline = self.pipeline(camera_id)
        if pipeline is None:
            raise KeyError(camera_id)
        return pipeline

    def camera_state(self, camera_id: int) -> dict[str, Any]:
        enterprise_occupancy = int(
            self._reporting.metrics_summary(include_submitted=True)["current_occupancy"] or 0
        )
        return self._camera_state(camera_id, enterprise_occupancy)

    def _camera_state(self, camera_id: int, enterprise_occupancy: int) -> dict[str, Any]:
        pipeline = self.require_pipeline(camera_id)
        enterprise_id = self._enterprise_id or ""
        counts = {**pipeline.counts(), "occupancy": enterprise_occupancy}
        session = pipeline.session()
        session = {**session, "counts": {**session["counts"], "occupancy": enterprise_occupancy}}
        return {
            "enterprise_id": enterprise_id,
            "camera_id": camera_id,
            "counts": counts,
            "detections": pipeline.detections(),
            "health": self._health_for_pipeline(pipeline),
            "session": session,
        }

    def camera_states(self) -> dict[str, Any]:
        with self._lock:
            camera_ids = sorted(self._pipelines)
            enterprise_id = self._enterprise_id or ""
        enterprise_occupancy = int(
            self._reporting.metrics_summary(include_submitted=True)["current_occupancy"] or 0
        )
        cameras = [self._camera_state(camera_id, enterprise_occupancy) for camera_id in camera_ids]
        return {
            "enterprise_id": enterprise_id,
            "enterprise_occupancy": enterprise_occupancy,
            "active_camera_count": sum(
                1 for camera in cameras if bool(camera["counts"]["running"])
            ),
            "max_concurrent_cameras": self._max_concurrent_cameras,
            "cameras": cameras,
        }

    def service_health(self) -> dict[str, Any]:
        states = self.camera_states()
        cameras = states["cameras"]
        first_health = cameras[0]["health"] if cameras else {}
        errors = [camera["counts"]["error"] for camera in cameras if camera["counts"].get("error")]
        return {
            **first_health,
            "status": "ok",
            "running": states["active_camera_count"] > 0,
            "error": errors[0] if errors else None,
            "runtime_capabilities": get_runtime_capabilities(),
            "active_camera_count": states["active_camera_count"],
            "max_concurrent_cameras": self._max_concurrent_cameras,
        }

    def _health_for_pipeline(self, pipeline: CameraProcessingManager) -> dict[str, Any]:
        counts = pipeline.counts()
        return {
            "status": "ok",
            "running": bool(counts["running"]),
            "error": counts["error"] if isinstance(counts["error"], str) else None,
            **pipeline.model_status(),
            "active_camera_count": 1 if counts["running"] else 0,
            "max_concurrent_cameras": self._max_concurrent_cameras,
        }

    def list_camera_profiles(self) -> list[dict[str, Any]]:
        return self._reporting.list_camera_profiles()

    def replace_camera_profiles(self, cameras: list[dict[str, Any]]) -> list[dict[str, Any]]:
        with self._lifecycle_lock:
            previous_ids = {int(camera["id"]) for camera in self._reporting.list_camera_profiles()}
            profiles = self._reporting.replace_camera_profiles(cameras)
            retained_ids = {int(camera["id"]) for camera in profiles}
            with self._lock:
                removed_ids = [
                    camera_id for camera_id in self._pipelines if camera_id not in retained_ids
                ]
            for camera_id in removed_ids:
                self.stop(camera_id)
                with self._lock:
                    self._pipelines.pop(camera_id, None)
            for camera_id in sorted(retained_ids - previous_ids):
                logger.info(
                    "Camera configuration created.",
                    extra={"enterprise_id": self._enterprise_id, "camera_id": camera_id},
                )
            for camera_id in sorted(previous_ids - retained_ids):
                logger.info(
                    "Camera configuration deleted.",
                    extra={"enterprise_id": self._enterprise_id, "camera_id": camera_id},
                )
            return profiles

    def metrics_summary(self, include_submitted: bool = False) -> dict[str, Any]:
        return self._reporting.metrics_summary(include_submitted=include_submitted)

    def metrics_history(self, include_submitted: bool = False) -> dict[str, Any]:
        return self._reporting.metrics_history(include_submitted=include_submitted)

    def record_occupancy_correction(self, **values: Any) -> dict[str, Any]:
        return self._reporting.record_occupancy_correction(**values)

    def occupancy_corrections(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._reporting.occupancy_corrections(limit=limit)

    def record_report_submission(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            return self._reporting.record_report_submission(*args, **kwargs)
        except Exception:
            logger.exception(
                "Enterprise report persistence failed.",
                extra={"enterprise_id": self._enterprise_id},
            )
            raise

    def list_report_submissions(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._reporting.list_report_submissions(limit=limit)

    def get_report_draft(self, draft_key: str) -> dict[str, Any] | None:
        return self._reporting.get_report_draft(draft_key)

    def save_report_draft(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return self._reporting.save_report_draft(*args, **kwargs)

    def delete_report_draft(self, draft_key: str) -> bool:
        return self._reporting.delete_report_draft(draft_key)

    def mark_report_synced(self, report_id: str) -> bool:
        return self._reporting.mark_report_synced(report_id)

    def purge_report_raw_events(self, report_id: str) -> dict[str, Any]:
        return self._reporting.purge_report_raw_events(report_id)

    def mark_events_synced(self) -> int:
        return self._reporting.mark_events_synced()

    def prepare_sample_counts(self, **values: Any) -> dict[str, Any]:
        return self._reporting.prepare_sample_counts(**values)

    def aggregate_session(self) -> dict[str, Any]:
        states = self.camera_states()
        cameras = states["cameras"]
        if len(cameras) == 1:
            return dict(cameras[0]["session"])
        summary = self.metrics_summary(include_submitted=False)
        counts = {
            "entry": summary["entries"],
            "exit": summary["exits"],
            "occupancy": summary["current_occupancy"],
            "running": states["active_camera_count"] > 0,
            "status": "running" if states["active_camera_count"] > 0 else "stopped",
            "started_at": None,
            "error": None,
        }
        return {
            "running": counts["running"],
            "status": counts["status"],
            "error": None,
            "camera_id": None,
            "camera_name": None,
            "camera_config": None,
            "counts": counts,
            "updated_at": None,
        }


def _max_concurrent_cameras(explicit_value: int | None) -> int:
    raw_value: int | str = (
        explicit_value
        if explicit_value is not None
        else os.environ.get("TANAW_MAX_CONCURRENT_CAMERAS", str(DEFAULT_MAX_CONCURRENT_CAMERAS))
    )
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError("TANAW_MAX_CONCURRENT_CAMERAS must be a whole number.") from exc
    if not 1 <= value <= MAX_CONFIGURABLE_CONCURRENT_CAMERAS:
        raise ValueError(
            "TANAW_MAX_CONCURRENT_CAMERAS must be between 1 and "
            f"{MAX_CONFIGURABLE_CONCURRENT_CAMERAS}."
        )
    return value
