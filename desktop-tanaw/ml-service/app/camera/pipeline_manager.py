from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, cast

from app.camera.camera_manager import CameraProcessingManager
from app.camera.contracts import CameraCounts, CountingConfigResult, EnterpriseBinding
from app.camera.local_operations_service import LocalOperationsService
from app.camera.stream_candidates import StreamSelection
from app.config.camera_config import (
    CameraCountingConfigUpdate,
    CameraStartRequest,
    CameraTestRequest,
    ProcessingProfile,
    ReIdMode,
    TripwireLine,
    TripwirePoint,
)
from app.identity.establishment_registry import EstablishmentRegistry
from app.runtime.hardware import cached_runtime_capabilities
from app.storage.local_data_schema import local_database_needs_reset, set_aside_local_data
from app.storage.local_database import LocalDatabase
from app.storage.repositories.area_repository import AreaRepository
from app.storage.repositories.establishment_report_repository import EstablishmentReportRepository
from app.storage.repositories.establishment_repository import EstablishmentRepository
from app.storage.repositories.establishment_sample_repository import prepare_sample_period
from app.storage.repositories.local_backup_repository import (
    export_local_backup,
    local_data_is_empty,
    restore_local_backup,
)

logger = logging.getLogger(__name__)

DEFAULT_MAX_CONFIGURED_CAMERAS = 6
DEFAULT_MAX_CONCURRENT_CAMERAS = 6
MAX_CONFIGURABLE_CONCURRENT_CAMERAS = 16


class CameraCapacityError(ValueError):
    pass


class CameraConfigurationCapacityError(ValueError):
    pass


class CameraNotActiveError(RuntimeError):
    pass


class TripwirePersistenceError(RuntimeError):
    pass


class TripwireWorkerUpdateError(RuntimeError):
    pass


class CameraPipelineRegistry:
    """Owns one isolated processing pipeline per physical camera."""

    def __init__(
        self,
        app_data_dir: str | None = None,
        max_configured_cameras: int = DEFAULT_MAX_CONFIGURED_CAMERAS,
        max_concurrent_cameras: int | None = None,
        pipeline_factory: Callable[..., CameraProcessingManager] = CameraProcessingManager,
        reporting_manager: LocalOperationsService | None = None,
    ) -> None:
        self._app_data_dir = app_data_dir
        if not 1 <= max_configured_cameras <= DEFAULT_MAX_CONFIGURED_CAMERAS:
            raise ValueError(
                f"Configured camera capacity must be between 1 and {DEFAULT_MAX_CONFIGURED_CAMERAS}."
            )
        self._max_configured_cameras = max_configured_cameras
        self._max_concurrent_cameras = _max_concurrent_cameras(max_concurrent_cameras)
        self._lock = threading.RLock()
        self._lifecycle_lock = threading.RLock()
        self._pipelines: dict[int, CameraProcessingManager] = {}
        self._config_fingerprints: dict[int, str] = {}
        self._pending_starts: dict[int, str] = {}
        self._start_locks: dict[int, threading.Lock] = {}
        self._context_generation = 0
        self._switching_context = False
        self._enterprise_id: str | None = None
        self._enterprise_name: str | None = None
        self._pipeline_factory = pipeline_factory
        self._reporting = reporting_manager or LocalOperationsService(app_data_dir)
        self._establishment_registry: EstablishmentRegistry | None = None
        self._summary_stop = threading.Event()
        self._summary_thread: threading.Thread | None = None
        self._summary_last_cleanup: datetime | None = None

    @property
    def max_concurrent_cameras(self) -> int:
        return self._max_concurrent_cameras

    @property
    def max_configured_cameras(self) -> int:
        return self._max_configured_cameras

    def bind_enterprise(
        self, enterprise_id: str, enterprise_name: str | None = None
    ) -> EnterpriseBinding:
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

            with self._lock:
                self._switching_context = True
                self._context_generation += 1
                self._pending_starts.clear()
            try:
                self._dispose_all_locked()
                context = self._reporting.bind_enterprise(normalized_id, normalized_name)
                with self._lock:
                    self._enterprise_id = normalized_id
                    self._enterprise_name = normalized_name
                self.area_repository().recover()
                self._establishment_registry = EstablishmentRegistry(
                    self._app_data_dir, normalized_id
                )
                self._establishment_registry.cleanup()
                # Rebuilds still pending when the service last stopped were not saved.
                self._establishment_registry.repository.rebuild_recent_days(datetime.now(UTC))
            except Exception:
                # A half-bound enterprise would make the next attempt return early as bound.
                with self._lock:
                    self._enterprise_id = None
                    self._enterprise_name = None
                self._establishment_registry = None
                self._reporting.unbind_enterprise()
                raise
            finally:
                with self._lock:
                    self._switching_context = False
            logger.info("Bound camera registry to enterprise %s.", normalized_id)
            return cast(
                EnterpriseBinding,
                {
                    **context,
                    "session_restored": False,
                },
            )

    def area_repository(self) -> AreaRepository:
        if self._enterprise_id is None:
            raise ValueError("Select an enterprise before querying local analytics.")
        return AreaRepository(LocalDatabase(self._app_data_dir, self._enterprise_id))

    def establishment_repository(self) -> EstablishmentRepository:
        if self._establishment_registry is None:
            raise ValueError("Select an enterprise before querying establishment analytics.")
        return self._establishment_registry.repository

    def establishment_summary(self, start: datetime, end: datetime) -> dict[str, Any]:
        with self._lifecycle_lock:
            return self.establishment_repository().summary(start, end)

    def establishment_hourly(self, start: datetime, end: datetime) -> dict[str, Any]:
        with self._lifecycle_lock:
            return self.establishment_repository().hourly(start, end)

    def establishment_report_periods(self) -> list[dict[str, Any]]:
        with self._lifecycle_lock:
            return EstablishmentReportRepository(self.establishment_repository().database).periods()

    def test_connection(self, payload: CameraTestRequest) -> StreamSelection:
        logger.info(
            "Camera stream test started.",
            extra={"enterprise_id": self._enterprise_id, "camera_id": payload.camera_id},
        )
        result = self._reporting.test_connection(payload)
        logger.log(
            logging.INFO if result.ok else logging.WARNING,
            "Camera stream test succeeded." if result.ok else "Camera stream test failed.",
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
            if self._switching_context:
                raise ValueError("Enterprise context is changing. Retry after sign-in completes.")
            generation = self._context_generation
            existing = self._pipelines.get(camera_id)
            if (
                existing is not None
                and existing.running
                and self._config_fingerprints.get(camera_id) == fingerprint
            ):
                logger.info("Ignored duplicate start for camera %s.", camera_id)
                return False
            pending_fingerprint = self._pending_starts.get(camera_id)
            if pending_fingerprint == fingerprint:
                logger.info("Ignored in-flight duplicate start for camera %s.", camera_id)
                return False
            self._raise_if_capacity_reached_locked(camera_id)
            self._pending_starts[camera_id] = fingerprint

        thread = threading.Thread(
            target=self._run_requested_start,
            args=(config, fingerprint, generation),
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

    def _run_requested_start(
        self, config: CameraStartRequest, fingerprint: str, generation: int
    ) -> None:
        camera_id = config.camera_id
        if camera_id is None:
            return

        def still_requested() -> bool:
            # Read without the registry lock: a camera calls this while holding its own lock.
            return (
                self._pending_starts.get(camera_id) == fingerprint
                and generation == self._context_generation
                and not self._switching_context
            )

        # The slow stream probe and model warmup run outside the lifecycle lock, so other
        # cameras, Stop, and reporting never wait behind one camera's startup. A stop, newer
        # start, or sign-out cancels this start through ``still_requested``.
        with self._camera_start_lock(camera_id):
            if not still_requested():
                return
            try:
                self._start_locked(config, should_continue=still_requested)
            except Exception:
                logger.exception("Camera %s failed during requested startup.", camera_id)
            finally:
                with self._lock:
                    if self._pending_starts.get(camera_id) == fingerprint:
                        self._pending_starts.pop(camera_id, None)

    def _camera_start_lock(self, camera_id: int) -> threading.Lock:
        with self._lock:
            return self._start_locks.setdefault(camera_id, threading.Lock())

    def _start_locked(
        self,
        config: CameraStartRequest,
        should_continue: Callable[[], bool] | None = None,
    ) -> bool:
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

        if existing is None:
            existing = self._pipeline_factory(self._app_data_dir, camera_id=camera_id)
            existing.bind_enterprise(enterprise_id or "", enterprise_name, restore_session=False)
            if (
                isinstance(existing, CameraProcessingManager)
                and self._establishment_registry is not None
            ):
                existing.use_establishment_registry(self._establishment_registry)
            with self._lock:
                self._pipelines[camera_id] = existing

        self._start_summary_worker()
        try:
            if should_continue is None:
                existing.start(config)
            else:
                existing.start(config, should_continue=should_continue)
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
            "The configured processing limit of "
            f"{self._max_concurrent_cameras} active cameras has been reached."
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

    def apply_performance_profile(
        self, processing_profile: ProcessingProfile, reid_mode: ReIdMode
    ) -> int:
        """Restart running cameras with this computer's new performance profile.

        Each camera restarts from the start request it is running with, so no credentials need
        to be resent. Returns how many cameras were restarted.
        """
        with self._lock:
            running = [pipeline for pipeline in self._pipelines.values() if pipeline.running]
        restarted = 0
        for pipeline in running:
            config = pipeline.current_config
            if config is None or (
                config.processing_profile == processing_profile and config.reid_mode == reid_mode
            ):
                continue
            update = {"processing_profile": processing_profile, "reid_mode": reid_mode}
            if self.request_start(config.model_copy(update=update)):
                restarted += 1
        return restarted

    def stop_all(self) -> int:
        with self._lifecycle_lock:
            return self._stop_all_locked()

    def _stop_all_locked(self) -> int:
        with self._lock:
            self._pending_starts.clear()
            pipelines = list(self._pipelines.items())
        stopped = 0
        errors: list[Exception] = []
        for camera_id, pipeline in pipelines:
            if pipeline.running:
                stopped += 1
            try:
                pipeline.stop()
            except Exception as exc:
                errors.append(exc)
                logger.exception("Unable to stop camera %s during cleanup.", camera_id)
            else:
                logger.info("Stopped processing pipeline for camera %s during cleanup.", camera_id)
        with self._lock:
            self._config_fingerprints.clear()
        if errors:
            raise ExceptionGroup("Some camera pipelines could not be stopped.", errors)
        return stopped

    def _dispose_all_locked(self) -> int:
        with self._lock:
            self._context_generation += 1
            self._pending_starts.clear()
            pipelines = list(self._pipelines.items())
            self._config_fingerprints.clear()
        stopped = 0
        errors: list[Exception] = []
        for camera_id, pipeline in pipelines:
            if pipeline.running:
                stopped += 1
            try:
                pipeline.close()
            except Exception as exc:
                errors.append(exc)
                logger.exception("Unable to dispose camera %s.", camera_id)
            else:
                with self._lock:
                    self._pipelines.pop(camera_id, None)
                logger.info("Disposed processing pipeline for camera %s.", camera_id)
        if errors:
            raise ExceptionGroup("Some camera pipelines could not be disposed.", errors)
        return stopped

    def close(self) -> None:
        """Dispose every camera and reporting worker during service shutdown."""
        self._summary_stop.set()
        with self._lifecycle_lock:
            try:
                self._dispose_all_locked()
            finally:
                self._reporting.close()
        if (
            self._summary_thread is not None
            and self._summary_thread is not threading.current_thread()
            and self._summary_thread.is_alive()
        ):
            self._summary_thread.join(timeout=5)

    def _start_summary_worker(self) -> None:
        if self._summary_thread is not None:
            return
        self._summary_thread = threading.Thread(
            target=self._summary_loop, name="tanaw-establishment-summaries", daemon=True
        )
        try:
            self._summary_thread.start()
        except Exception:
            self._summary_thread = None
            raise

    def _summary_loop(self) -> None:
        while not self._summary_stop.wait(1):
            # Never hold up camera lifecycle operations or join behind their lock.
            if not self._lifecycle_lock.acquire(blocking=False):
                continue
            try:
                if self._establishment_registry is not None:
                    snapshot = self.establishment_live()
                    now = datetime.now(UTC)
                    self.establishment_repository().checkpoint_occupancy(snapshot, now)
                    self.establishment_repository().rebuild_changed_days()
                    if (
                        self._summary_last_cleanup is None
                        or (now - self._summary_last_cleanup).total_seconds() >= 60
                    ):
                        self._establishment_registry.cleanup(now)
                        self._summary_last_cleanup = now
            except Exception:
                logger.exception("Unable to checkpoint establishment analytics.")
            finally:
                self._lifecycle_lock.release()

    def establishment_live(self, now: datetime | None = None) -> dict[str, Any]:
        with self._lifecycle_lock:
            return self._establishment_live_locked(now)

    def _establishment_live_locked(self, now: datetime | None = None) -> dict[str, Any]:
        """Live occupancy: the shared Entry / Exit balance plus every Open Space zone.

        A camera that is stopped or not delivering fresh frames is left out and listed
        in ``missing_camera_ids``; the running cameras still count.
        """
        repository = self.establishment_repository()
        profiles = self.list_camera_profiles()
        states = {state["camera_id"]: state for state in self.camera_states()["cameras"]}
        now = now or datetime.now(UTC)
        balance = repository.today_balance(now)
        doors: list[int] = []
        contributions: list[dict[str, Any]] = []
        missing: list[int] = []
        sources: list[dict[str, Any]] = []
        ready_identities: set[int] = set()
        for profile in profiles:
            camera_id = int(profile["id"])
            state = states.get(camera_id, {})
            counts, health = state.get("counts") or {}, state.get("health") or {}
            area = state.get("area") or {}
            is_area = profile.get("analysisMode") == "open_space"
            observed_at = None
            if is_area:
                available = bool(area.get("available") and counts.get("running"))
                if area.get("observed_at") is not None:
                    try:
                        observed_at = datetime.fromisoformat(area["observed_at"])
                        available &= (
                            observed_at.tzinfo is not None
                            and 0 <= (now - observed_at).total_seconds() <= 5
                        )
                    except (ValueError, TypeError):
                        available = False
                presence = area.get("presence") if available else None
                available &= isinstance(presence, int) and presence >= 0
            else:
                # Analysed frames, not raw video, show that this doorway is still counting.
                age = health.get("processed_frame_stale_ms")
                available = bool(
                    counts.get("running")
                    and counts.get("status") in {"running", "degraded"}
                    and isinstance(age, (int, float))
                    and age <= 5000
                )
                presence = None
            if not available:
                missing.append(camera_id)
            elif is_area:
                contributions.append(
                    {
                        "camera_ids": [camera_id],
                        "occupancy": presence,
                        "state": "estimated",
                        "basis": "observed_presence",
                    }
                )
            else:
                doors.append(camera_id)
            if (
                available
                and profile.get("uniqueCountingMode", "estimated_reid") == "estimated_reid"
                and health.get("reid_model_ready")
            ):
                ready_identities.add(camera_id)
            sources.append(
                {
                    "camera_id": camera_id,
                    "camera_name": profile.get("name") or f"Camera {camera_id}",
                    "analysis_mode": "open_space" if is_area else "entrance_exit",
                    "available": available,
                    "occupancy": presence,
                    "observed_at": observed_at.isoformat() if observed_at is not None else None,
                }
            )
        if doors:
            contributions.insert(
                0,
                {
                    "camera_ids": doors,
                    "occupancy": balance,
                    "state": "estimated",
                    "basis": "entry_exit_balance",
                },
            )
        total = sum(item["occupancy"] for item in contributions)
        return {
            "enterprise_id": self._enterprise_id,
            "occupancy": total if contributions else None,
            "partial_occupancy": total,
            "state": "unavailable" if not contributions else "partial" if missing else "estimated",
            "contributions": contributions,
            "missing_camera_ids": missing,
            "movement_available": bool(doors),
            "identification_available": bool(ready_identities),
            "measurement_sources": sources,
        }

    def pipeline(self, camera_id: int) -> CameraProcessingManager | None:
        with self._lock:
            return self._pipelines.get(camera_id)

    def require_pipeline(self, camera_id: int) -> CameraProcessingManager:
        pipeline = self.pipeline(camera_id)
        if pipeline is None:
            raise KeyError(camera_id)
        return pipeline

    def update_counting_config(
        self, camera_id: int, update: CameraCountingConfigUpdate
    ) -> CountingConfigResult:
        with self._lifecycle_lock:
            previous_profiles = self._reporting.list_camera_profiles()
            found_profile = False
            updated_profiles: list[dict[str, Any]] = []
            for profile in previous_profiles:
                if int(profile["id"]) == camera_id:
                    updated_profiles.append(_profile_with_counting_update(profile, update))
                    found_profile = True
                else:
                    updated_profiles.append(profile)
            if not found_profile:
                raise KeyError(camera_id)

            pipeline = self.pipeline(camera_id)
            worker_is_active = pipeline is not None and pipeline.running
            if update.require_active_worker and not worker_is_active:
                raise CameraNotActiveError(
                    "The selected camera is no longer processing. Retry after its status refreshes."
                )

            try:
                self._reporting.replace_camera_profiles(updated_profiles)
            except (OSError, ValueError) as exc:
                raise TripwirePersistenceError(
                    "The Tripwire configuration could not be persisted."
                ) from exc

            if not worker_is_active or pipeline is None:
                return {
                    "camera_id": camera_id,
                    "persisted": True,
                    "worker_applied": False,
                    "session_id": None,
                    "raw_frame_id": None,
                    "stream_frame_id": None,
                }

            try:
                result = pipeline.update_counting_config(update)
            except Exception as exc:
                try:
                    self._reporting.replace_camera_profiles(previous_profiles)
                except Exception:
                    logger.exception(
                        "Tripwire worker update failed and persistence rollback also failed.",
                        extra={"enterprise_id": self._enterprise_id, "camera_id": camera_id},
                    )
                raise TripwireWorkerUpdateError(
                    "The active camera worker rejected the Tripwire configuration."
                ) from exc
            logger.info(
                "Updated counting geometry without restarting the camera pipeline.",
                extra={"enterprise_id": self._enterprise_id, "camera_id": camera_id},
            )
            return cast(
                CountingConfigResult,
                {
                    **result,
                    "persisted": True,
                    "worker_applied": True,
                },
            )

    def _camera_state(self, camera_id: int, enterprise_occupancy: int) -> dict[str, Any]:
        pipeline = self.require_pipeline(camera_id)
        enterprise_id = self._enterprise_id or ""
        session = pipeline.session()
        mode = (session.get("camera_config") or {}).get("analysis_mode", "entrance_exit")
        counts: CameraCounts = {**pipeline.counts()}
        if mode == "entrance_exit":
            counts["occupancy"] = enterprise_occupancy
        session = {**session, "counts": counts}
        return {
            "enterprise_id": enterprise_id,
            "camera_id": camera_id,
            "analysis_mode": mode,
            "area": pipeline.area_state() if mode == "open_space" else None,
            "counts": counts,
            "detections": pipeline.detections(),
            "health": self._health_for_pipeline(pipeline),
            "session": session,
        }

    def camera_states(self) -> dict[str, Any]:
        with self._lock:
            camera_ids = sorted(self._pipelines)
            pending_camera_ids = sorted(self._pending_starts)
            enterprise_id = self._enterprise_id or ""
        enterprise_occupancy = (
            self.establishment_repository().today_balance()
            if self._establishment_registry is not None
            else 0
        )
        cameras = [self._camera_state(camera_id, enterprise_occupancy) for camera_id in camera_ids]
        return {
            "enterprise_id": enterprise_id,
            "enterprise_occupancy": enterprise_occupancy,
            "active_camera_count": sum(
                1 for camera in cameras if bool(camera["counts"]["running"])
            ),
            "max_configured_cameras": self._max_configured_cameras,
            "max_concurrent_cameras": self._max_concurrent_cameras,
            "pending_camera_ids": pending_camera_ids,
            "cameras": cameras,
        }

    def service_health(self) -> dict[str, Any]:
        states = self.camera_states()
        cameras = states["cameras"]
        errors = [camera["counts"]["error"] for camera in cameras if camera["counts"].get("error")]
        return {
            **_representative_health(cameras),
            "status": "ok",
            "running": states["active_camera_count"] > 0,
            "error": errors[0] if errors else None,
            "runtime_capabilities": cached_runtime_capabilities(),
            "active_camera_count": states["active_camera_count"],
            "max_configured_cameras": self._max_configured_cameras,
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
            "max_configured_cameras": self._max_configured_cameras,
            "max_concurrent_cameras": self._max_concurrent_cameras,
        }

    def list_camera_profiles(self) -> list[dict[str, Any]]:
        return self._reporting.list_camera_profiles()

    def replace_camera_profiles(self, cameras: list[dict[str, Any]]) -> list[dict[str, Any]]:
        with self._lifecycle_lock:
            if len(cameras) > self._max_configured_cameras:
                raise CameraConfigurationCapacityError(
                    "This Enterprise account can register up to "
                    f"{self._max_configured_cameras} cameras."
                )
            previous_profiles = {
                int(camera["id"]): camera for camera in self._reporting.list_camera_profiles()
            }
            previous_ids = set(previous_profiles)
            profiles = self._reporting.replace_camera_profiles(cameras)
            retained_ids = {int(camera["id"]) for camera in profiles}
            for profile in profiles:
                camera_id = int(profile["id"])
                previous = previous_profiles.get(camera_id)
                if previous is None:
                    continue
                changed = previous.get("analysisMode", "entrance_exit") != profile.get(
                    "analysisMode", "entrance_exit"
                ) or previous.get("openSpace") != profile.get("openSpace")
                if changed:
                    self.stop(camera_id)
                    with self._lock:
                        self._config_fingerprints.pop(camera_id, None)
            with self._lock:
                removed_ids = [
                    camera_id for camera_id in self._pipelines if camera_id not in retained_ids
                ]
            errors: list[Exception] = []
            for camera_id in removed_ids:
                with self._lock:
                    pipeline = self._pipelines.get(camera_id)
                    self._pending_starts.pop(camera_id, None)
                    self._config_fingerprints.pop(camera_id, None)
                if pipeline is not None:
                    try:
                        pipeline.close()
                    except Exception as exc:
                        errors.append(exc)
                        logger.exception("Unable to close removed camera %s.", camera_id)
                    else:
                        with self._lock:
                            self._pipelines.pop(camera_id, None)
            if errors:
                raise ExceptionGroup("Some removed cameras could not be closed.", errors)
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
        with self._lifecycle_lock:
            return self.establishment_repository().record_occupancy_correction(**values)

    def occupancy_corrections(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._reporting.occupancy_corrections(limit=limit)

    def record_report_submission(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            with self._lifecycle_lock:
                return EstablishmentReportRepository(
                    self.establishment_repository().database
                ).submit(*args, **kwargs)
        except Exception:
            logger.exception(
                "Enterprise report persistence failed.",
                extra={"enterprise_id": self._enterprise_id},
            )
            raise

    def list_report_submissions(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._lifecycle_lock:
            return self._reporting.list_report_submissions(limit=limit)

    def get_report_draft(self, draft_key: str) -> dict[str, Any] | None:
        return self._reporting.get_report_draft(draft_key)

    def save_report_draft(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return self._reporting.save_report_draft(*args, **kwargs)

    def delete_report_draft(self, draft_key: str) -> bool:
        return self._reporting.delete_report_draft(draft_key)

    def mark_report_synced(self, report_id: str, submission_id: str) -> bool:
        return self._reporting.mark_report_synced(report_id, submission_id)

    def mark_report_upload_rejected(self, report_id: str, submission_id: str) -> bool:
        return self._reporting.mark_report_upload_rejected(report_id, submission_id)

    def purge_report_raw_events(self, report_id: str) -> dict[str, Any]:
        return self._reporting.purge_report_raw_events(report_id)

    def mark_events_synced(self) -> int:
        return self._reporting.mark_events_synced()

    def prepare_sample_counts(
        self, *, enterprise_id: str, enterprise_name: str | None, **values: Any
    ) -> dict[str, Any]:
        with self._lifecycle_lock:
            if self._enterprise_id != enterprise_id:
                raise ValueError(
                    f"Desktop is bound to {self._enterprise_id or 'no enterprise'}. "
                    f"Log into {enterprise_name or enterprise_id} before preparing counts."
                )
            result = prepare_sample_period(self.establishment_repository(), **values)
        return {**result, "enterprise_id": enterprise_id, "enterprise_name": enterprise_name}

    def reset_unreadable_local_data(self, enterprise_id: str) -> dict[str, Any]:
        """Set aside an enterprise's local data that this version cannot open.

        Only an unreadable database is moved, so this can never discard data the
        application is able to use. The next enterprise binding starts fresh.
        """
        normalized_id = enterprise_id.strip()
        if not normalized_id:
            raise ValueError("Enterprise ID is required.")
        with self._lifecycle_lock:
            if self._enterprise_id == normalized_id:
                raise ValueError("This establishment's local data is open and readable.")
            database = LocalDatabase(self._app_data_dir, normalized_id)
            if not local_database_needs_reset(database.path):
                raise ValueError("This establishment's local data is readable; nothing was reset.")
            moved_to = set_aside_local_data(database.root)
        logger.warning(
            "Unreadable local data was set aside.",
            extra={"enterprise_id": normalized_id, "path": str(moved_to)},
        )
        return {"enterprise_id": normalized_id, "set_aside_path": str(moved_to)}

    def export_local_backup(self) -> dict[str, Any]:
        with self._lifecycle_lock:
            database = self.establishment_repository().database
            backup = export_local_backup(database, datetime.now(UTC))
            return {
                **backup,
                "enterprise_id": self._enterprise_id,
                "cameras": self._reporting.list_camera_profiles(),
                "empty": local_data_is_empty(database),
            }

    def restore_local_backup(
        self,
        *,
        enterprise_id: str,
        days: list[dict[str, Any]],
        drafts: list[dict[str, Any]],
        cameras: list[dict[str, Any]],
    ) -> dict[str, Any]:
        with self._lifecycle_lock:
            if self._enterprise_id != enterprise_id:
                raise ValueError(
                    f"Desktop is bound to {self._enterprise_id or 'no enterprise'}, "
                    f"not {enterprise_id}."
                )
            database = self.establishment_repository().database
            if not local_data_is_empty(database):
                return {"restored": False, "days": 0, "drafts": 0, "cameras": 0}
            # Restored cameras have no saved password yet, so each one is tested again.
            profiles = self.replace_camera_profiles(
                [{**camera, "status": "untested"} for camera in cameras]
            )
            restored = restore_local_backup(
                database, days=days, drafts=drafts, now=datetime.now(UTC)
            )
        logger.info(
            "Local data restored from the server backup.",
            extra={"enterprise_id": enterprise_id, **restored, "cameras": len(profiles)},
        )
        return {"restored": True, **restored, "cameras": len(profiles)}

    def aggregate_session(self) -> dict[str, Any]:
        states = self.camera_states()
        cameras = states["cameras"]
        if len(cameras) == 1:
            return dict(cameras[0]["session"])
        summary = self.metrics_summary(include_submitted=False)
        counts = {
            "entry": summary["entries"],
            "exit": summary["exits"],
            # The same daily establishment balance every other view shows.
            "occupancy": states["enterprise_occupancy"],
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


def _representative_health(cameras: list[dict[str, Any]]) -> dict[str, Any]:
    """The camera whose health a single summary should show: the one most in trouble.

    A summary built from the first camera alone would hide a second camera that has
    stalled or lost its models.
    """
    if not cameras:
        return {}

    def trouble(camera: dict[str, Any]) -> tuple[int, int, int, int]:
        health, counts = camera.get("health") or {}, camera.get("counts") or {}
        running = bool(counts.get("running"))
        return (
            int(running and bool(counts.get("error"))),
            int(running and not health.get("model_ready", True)),
            int(running and not health.get("reid_model_ready", True)),
            int(running),
        )

    return dict(max(cameras, key=trouble)["health"])


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


def _profile_with_counting_update(
    profile: dict[str, Any], update: CameraCountingConfigUpdate
) -> dict[str, Any]:
    existing_config = profile.get("config")
    if not isinstance(existing_config, dict):
        raise ValueError("Camera counting configuration is missing.")

    return {
        **profile,
        "config": {
            **existing_config,
            "tripwire": update.tripwire_position * 100.0,
            "tripwires": {
                "entry": _renderer_tripwire_line(update.entry_line),
                "exit": _renderer_tripwire_line(update.exit_line),
            },
            "roi": {
                "top": update.roi.top * 100.0,
                "left": update.roi.left * 100.0,
                "width": update.roi.width * 100.0,
                "height": update.roi.height * 100.0,
            },
            "reverse": update.reverse_direction,
        },
    }


def _renderer_tripwire_line(line: TripwireLine) -> dict[str, Any]:
    def point(value: TripwirePoint) -> dict[str, float]:
        return {"x": value.x * 100.0, "y": value.y * 100.0}

    payload: dict[str, Any] = {
        "start": point(line.start),
        "end": point(line.end),
        "curve": line.curve,
    }
    if line.points is not None:
        payload["points"] = [point(value) for value in line.points]
    if line.sampled_points is not None:
        payload["sampledPoints"] = [point(value) for value in line.sampled_points]
    return payload
