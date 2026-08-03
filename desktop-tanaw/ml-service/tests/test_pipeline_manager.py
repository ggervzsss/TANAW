import tempfile
import threading
import unittest
from typing import Any, cast

from app.camera.camera_manager import CameraProcessingManager
from app.camera.contracts import CameraCounts, CameraSessionState
from app.camera.pipeline_manager import (
    CameraCapacityError,
    CameraConfigurationCapacityError,
    CameraNotActiveError,
    CameraPipelineRegistry,
    TripwireWorkerUpdateError,
)
from app.config.camera_config import CameraCountingConfigUpdate, CameraStartRequest


class FakePipeline(CameraProcessingManager):
    def __init__(self, app_data_dir: str | None = None, camera_id: int | None = None) -> None:
        self.camera_id = camera_id
        self.running_value = False
        self.start_calls = 0
        self.stop_calls = 0
        self.close_calls = 0
        self.counting_update_calls = 0
        self.config: CameraStartRequest | None = None
        self.enterprise_id: str | None = None

    @property
    def running(self) -> bool:
        return self.running_value

    def bind_enterprise(
        self,
        enterprise_id: str,
        enterprise_name: str | None = None,
        *,
        restore_session: bool = True,
    ) -> dict:
        self.enterprise_id = enterprise_id
        return {
            "enterprise_id": enterprise_id,
            "enterprise_name": enterprise_name,
            "changed": True,
            "session_restored": False,
        }

    def start(self, config: CameraStartRequest) -> None:
        if self.running_value:
            self.stop()
        self.config = config
        self.start_calls += 1
        self.running_value = True

    def stop(self) -> None:
        self.stop_calls += 1
        self.running_value = False

    def close(self) -> None:
        self.close_calls += 1
        self.stop()

    def update_counting_config(self, update: CameraCountingConfigUpdate) -> dict[str, object]:
        self.counting_update_calls += 1
        return {
            "camera_id": self.camera_id,
            "session_id": 1,
            "raw_frame_id": 10,
            "stream_frame_id": 10,
        }

    def counts(self) -> CameraCounts:
        return {
            "entry": self.camera_id or 0,
            "exit": 0,
            "occupancy": 999,
            "running": self.running_value,
            "status": "running" if self.running_value else "stopped",
            "started_at": None,
            "error": None,
        }

    def detections(self) -> dict:
        return {"running": self.running_value, "status": "running", "tracks": []}

    def session(self) -> CameraSessionState:
        return {
            "running": self.running_value,
            "status": "running",
            "error": None,
            "camera_id": self.camera_id,
            "camera_name": f"Camera {self.camera_id}",
            "camera_config": None,
            "counts": self.counts(),
            "updated_at": None,
        }

    def model_status(self) -> dict:
        return {}


class CameraPipelineRegistryTest(unittest.TestCase):
    def test_default_policy_supports_six_configured_and_active_cameras(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(directory, pipeline_factory=FakePipeline)
            registry.bind_enterprise("enterprise@example.test")
            registry.replace_camera_profiles([_profile(camera_id) for camera_id in range(1, 7)])

            for camera_id in range(1, 7):
                self.assertTrue(registry.start(_config(camera_id)))

            states = registry.camera_states()
            self.assertEqual(states["active_camera_count"], 6)
            self.assertEqual(states["max_configured_cameras"], 6)
            self.assertEqual(states["max_concurrent_cameras"], 6)
            self.assertEqual(
                [camera["camera_id"] for camera in states["cameras"]],
                [1, 2, 3, 4, 5, 6],
            )
            self.assertEqual(
                [camera["counts"]["entry"] for camera in states["cameras"]],
                [1, 2, 3, 4, 5, 6],
            )

            with self.assertRaisesRegex(
                CameraCapacityError, "processing limit of 6 active cameras"
            ):
                registry.start(_config(7))
            self.assertTrue(
                all(registry.require_pipeline(camera_id).running for camera_id in range(1, 7))
            )

    def test_stopping_worker_frees_active_capacity_without_affecting_others(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=6, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            for camera_id in range(1, 7):
                registry.start(_config(camera_id))

            self.assertTrue(registry.stop(3))
            self.assertTrue(registry.start(_config(7)))
            self.assertEqual(registry.camera_states()["active_camera_count"], 6)
            self.assertFalse(registry.require_pipeline(3).running)
            self.assertTrue(
                all(
                    registry.require_pipeline(camera_id).running for camera_id in [1, 2, 4, 5, 6, 7]
                )
            )

    def test_seventh_profile_is_rejected_and_deleting_one_frees_the_slot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(directory, pipeline_factory=FakePipeline)
            registry.bind_enterprise("enterprise@example.test")
            six_profiles = [_profile(camera_id) for camera_id in range(1, 7)]
            registry.replace_camera_profiles(six_profiles)

            with self.assertRaisesRegex(
                CameraConfigurationCapacityError, "register up to 6 cameras"
            ):
                registry.replace_camera_profiles([*six_profiles, _profile(7)])

            registry.start(_config(1))
            registry.replace_camera_profiles([*six_profiles[1:], _profile(7)])
            with self.assertRaises(KeyError):
                registry.require_pipeline(1)
            self.assertEqual(
                [profile["id"] for profile in registry.list_camera_profiles()],
                [2, 3, 4, 5, 6, 7],
            )

    def test_failed_sixth_worker_releases_capacity_and_preserves_five_workers(self) -> None:
        class SixthCameraFails(FakePipeline):
            def start(self, config: CameraStartRequest) -> None:
                if config.camera_id == 6:
                    raise RuntimeError("simulated stream failure")
                super().start(config)

        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory,
                max_concurrent_cameras=6,
                pipeline_factory=SixthCameraFails,
            )
            registry.bind_enterprise("enterprise@example.test")
            for camera_id in range(1, 6):
                registry.start(_config(camera_id))

            with self.assertRaisesRegex(RuntimeError, "simulated stream failure"):
                registry.start(_config(6))
            self.assertTrue(registry.start(_config(7)))
            self.assertEqual(registry.camera_states()["active_camera_count"], 6)
            self.assertTrue(
                all(
                    registry.require_pipeline(camera_id).running for camera_id in [1, 2, 3, 4, 5, 7]
                )
            )

    def test_two_cameras_run_independently_and_duplicate_start_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=2, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            first = _config(1)
            second = _config(2)

            self.assertTrue(registry.start(first))
            self.assertFalse(registry.start(first))
            self.assertTrue(registry.start(second))
            first_pipeline = registry.require_pipeline(1)
            second_pipeline = registry.require_pipeline(2)
            self.assertTrue(first_pipeline.running)
            self.assertTrue(second_pipeline.running)

            self.assertTrue(registry.stop(1))
            self.assertFalse(first_pipeline.running)
            self.assertTrue(second_pipeline.running)

    def test_counting_hot_update_is_atomic_and_isolated_to_one_camera(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=2, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            registry.replace_camera_profiles([_profile(1), _profile(2)])
            registry.start(_config(1))
            registry.start(_config(2))
            first = cast(FakePipeline, registry.require_pipeline(1))
            second = cast(FakePipeline, registry.require_pipeline(2))

            result = registry.update_counting_config(
                1,
                CameraCountingConfigUpdate.model_validate(
                    {
                        "entry_line": {
                            "start": {"x": 0.25, "y": 0.0},
                            "end": {"x": 0.25, "y": 1.0},
                        },
                        "exit_line": {
                            "start": {"x": 0.75, "y": 0.0},
                            "end": {"x": 0.75, "y": 1.0},
                        },
                        "reverse_direction": True,
                    }
                ),
            )

            self.assertEqual(result["session_id"], 1)
            self.assertTrue(result["persisted"])
            self.assertTrue(result["worker_applied"])
            self.assertEqual(first.counting_update_calls, 1)
            self.assertEqual(second.counting_update_calls, 0)
            self.assertEqual(first.start_calls, 1)
            self.assertEqual(second.start_calls, 1)
            self.assertEqual(first.stop_calls, 0)
            self.assertEqual(second.stop_calls, 0)
            self.assertTrue(first.running)
            self.assertTrue(second.running)
            profiles = registry.list_camera_profiles()
            self.assertTrue(profiles[0]["config"]["reverse"])
            self.assertFalse(profiles[1]["config"]["reverse"])

    def test_failed_counting_hot_update_rolls_back_persisted_profile(self) -> None:
        class RejectingPipeline(FakePipeline):
            def update_counting_config(
                self, update: CameraCountingConfigUpdate
            ) -> dict[str, object]:
                raise RuntimeError("simulated hot update failure")

        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=1, pipeline_factory=RejectingPipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            registry.replace_camera_profiles([_profile(1)])
            registry.start(_config(1))
            with self.assertRaises(TripwireWorkerUpdateError):
                registry.update_counting_config(
                    1,
                    CameraCountingConfigUpdate.model_validate(
                        {
                            "entry_line": {
                                "start": {"x": 0.25, "y": 0.0},
                                "end": {"x": 0.25, "y": 1.0},
                            },
                            "exit_line": {
                                "start": {"x": 0.75, "y": 0.0},
                                "end": {"x": 0.75, "y": 1.0},
                            },
                            "reverse_direction": True,
                        }
                    ),
                )

            self.assertFalse(registry.list_camera_profiles()[0]["config"]["reverse"])
            pipeline = cast(RejectingPipeline, registry.require_pipeline(1))
            self.assertEqual(pipeline.start_calls, 1)
            self.assertEqual(pipeline.stop_calls, 0)

    def test_stopped_camera_tripwire_update_persists_without_connection_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=1, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            original = _profile(1)
            original["status"] = "stopped"
            registry.replace_camera_profiles([original])

            result = registry.update_counting_config(
                1,
                CameraCountingConfigUpdate.model_validate(
                    {
                        "entry_line": {
                            "start": {"x": 0.2, "y": 0.0},
                            "end": {"x": 0.3, "y": 1.0},
                            "points": [
                                {"x": 0.2, "y": 0.0},
                                {"x": 0.25, "y": 0.5},
                                {"x": 0.3, "y": 1.0},
                            ],
                            "curve": "smooth",
                        },
                        "exit_line": {
                            "start": {"x": 0.7, "y": 0.0},
                            "end": {"x": 0.8, "y": 1.0},
                        },
                        "tripwire_position": 0.6,
                    }
                ),
            )

            self.assertTrue(result["persisted"])
            self.assertFalse(result["worker_applied"])
            saved = registry.list_camera_profiles()[0]
            self.assertEqual(saved["rtsp"], original["rtsp"])
            self.assertEqual(saved["cameraHost"], original["cameraHost"])
            self.assertEqual(saved["config"]["tripwire"], 60.0)
            self.assertEqual(
                saved["config"]["tripwires"]["entry"]["points"][1],
                {"x": 25.0, "y": 50.0},
            )

    def test_required_active_worker_rejects_without_persisting(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=1, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            registry.replace_camera_profiles([_profile(1)])

            with self.assertRaises(CameraNotActiveError):
                registry.update_counting_config(
                    1,
                    CameraCountingConfigUpdate.model_validate(
                        {
                            "entry_line": {
                                "start": {"x": 0.25, "y": 0.0},
                                "end": {"x": 0.25, "y": 1.0},
                            },
                            "exit_line": {
                                "start": {"x": 0.75, "y": 0.0},
                                "end": {"x": 0.75, "y": 1.0},
                            },
                            "require_active_worker": True,
                            "reverse_direction": True,
                        }
                    ),
                )

            self.assertFalse(registry.list_camera_profiles()[0]["config"]["reverse"])

    def test_counting_hot_update_keeps_six_camera_workers_isolated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=6, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            registry.replace_camera_profiles([_profile(camera_id) for camera_id in range(1, 7)])
            for camera_id in range(1, 7):
                registry.start(_config(camera_id))

            registry.update_counting_config(
                3,
                CameraCountingConfigUpdate.model_validate(
                    {
                        "entry_line": {
                            "start": {"x": 0.25, "y": 0.0},
                            "end": {"x": 0.25, "y": 1.0},
                        },
                        "exit_line": {
                            "start": {"x": 0.75, "y": 0.0},
                            "end": {"x": 0.75, "y": 1.0},
                        },
                    }
                ),
            )

            pipelines = [
                cast(FakePipeline, registry.require_pipeline(camera_id))
                for camera_id in range(1, 7)
            ]
            self.assertEqual(
                [pipeline.counting_update_calls for pipeline in pipelines],
                [0, 0, 1, 0, 0, 0],
            )
            self.assertTrue(all(pipeline.running for pipeline in pipelines))
            self.assertTrue(all(pipeline.start_calls == 1 for pipeline in pipelines))
            self.assertTrue(all(pipeline.stop_calls == 0 for pipeline in pipelines))

    def test_capacity_limit_rejects_only_the_additional_camera(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=1, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            registry.start(_config(1))

            with self.assertRaisesRegex(CameraCapacityError, "processing limit"):
                registry.start(_config(2))
            self.assertTrue(registry.require_pipeline(1).running)

    def test_requested_start_returns_while_slow_initialization_continues(self) -> None:
        initialization_started = threading.Event()
        finish_initialization = threading.Event()
        initialization_finished = threading.Event()

        class SlowPipeline(FakePipeline):
            def start(self, config: CameraStartRequest) -> None:
                initialization_started.set()
                finish_initialization.wait(timeout=2)
                super().start(config)
                initialization_finished.set()

        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=1, pipeline_factory=SlowPipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            first = _config(1)

            try:
                self.assertTrue(registry.request_start(first))
                self.assertTrue(initialization_started.wait(timeout=1))
                self.assertFalse(initialization_finished.is_set())
                self.assertEqual(registry.camera_states()["pending_camera_ids"], [1])
                self.assertFalse(registry.request_start(first))
                with self.assertRaisesRegex(CameraCapacityError, "processing limit"):
                    registry.request_start(_config(2))
            finally:
                finish_initialization.set()

            self.assertTrue(initialization_finished.wait(timeout=1))
            self.assertTrue(registry.require_pipeline(1).running)
            self.assertEqual(registry.camera_states()["pending_camera_ids"], [])

    def test_changed_start_releases_the_previous_worker_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=1, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            registry.start(_config(1))
            pipeline = cast(FakePipeline, registry.require_pipeline(1))

            updated = _config(1)
            updated.processing_profile = "high_accuracy"
            self.assertTrue(registry.start(updated))

            self.assertEqual(pipeline.stop_calls, 1)
            self.assertEqual(pipeline.start_calls, 2)
            self.assertIs(pipeline.config, updated)
            self.assertTrue(pipeline.running)

    def test_latest_changed_request_wins_while_an_older_start_is_pending(self) -> None:
        first_update_started = threading.Event()
        release_first_update = threading.Event()
        latest_update_finished = threading.Event()

        class SerializedPipeline(FakePipeline):
            def start(self, config: CameraStartRequest) -> None:
                if config.camera_name == "First update":
                    first_update_started.set()
                    release_first_update.wait(timeout=2)
                super().start(config)
                if config.camera_name == "Latest update":
                    latest_update_finished.set()

        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=1, pipeline_factory=SerializedPipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            registry.start(_config(1))
            first_update = _config(1)
            first_update.camera_name = "First update"
            latest_update = _config(1)
            latest_update.camera_name = "Latest update"

            try:
                self.assertTrue(registry.request_start(first_update))
                self.assertTrue(first_update_started.wait(timeout=1))
                self.assertTrue(registry.request_start(latest_update))
            finally:
                release_first_update.set()

            self.assertTrue(latest_update_finished.wait(timeout=1))
            pipeline = cast(SerializedPipeline, registry.require_pipeline(1))
            self.assertIs(pipeline.config, latest_update)
            self.assertEqual(registry.camera_states()["pending_camera_ids"], [])

    def test_enterprise_switch_and_shutdown_stop_every_pipeline(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=2, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("first@example.test")
            registry.start(_config(1))
            registry.start(_config(2))
            first = registry.require_pipeline(1)
            second = registry.require_pipeline(2)

            registry.bind_enterprise("second@example.test")
            self.assertFalse(first.running)
            self.assertFalse(second.running)
            self.assertEqual(cast(FakePipeline, first).close_calls, 1)
            self.assertEqual(cast(FakePipeline, second).close_calls, 1)
            self.assertEqual(registry.camera_states()["cameras"], [])

    def test_removing_camera_profile_disposes_pipeline_workers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(directory, pipeline_factory=FakePipeline)
            registry.bind_enterprise("enterprise@example.test")
            registry.replace_camera_profiles([_profile(1)])
            registry.start(_config(1))
            pipeline = cast(FakePipeline, registry.require_pipeline(1))

            registry.replace_camera_profiles([])

            self.assertEqual(pipeline.close_calls, 1)
            with self.assertRaises(KeyError):
                registry.require_pipeline(1)

    def test_enterprise_occupancy_is_projected_identically_to_every_camera(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=2, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            registry.start(_config(1))
            registry.start(_config(2))
            registry.record_occupancy_correction(
                new_occupancy=7,
                reason="Manual recount",
                camera_id=1,
            )

            states = registry.camera_states()
            self.assertEqual(states["enterprise_occupancy"], 7)
            self.assertEqual(
                [camera["counts"]["occupancy"] for camera in states["cameras"]], [7, 7]
            )
            self.assertEqual(
                [camera["session"]["counts"]["occupancy"] for camera in states["cameras"]],
                [7, 7],
            )


def _config(camera_id: int) -> CameraStartRequest:
    return CameraStartRequest(
        camera_id=camera_id,
        camera_name=f"Camera {camera_id}",
        stream_url="rtsp://192.168.1.20/stream2",
    )


def _profile(camera_id: int) -> dict[str, Any]:
    host = f"192.168.1.{20 + camera_id}"
    return {
        "cameraHost": host,
        "confidence": 0.35,
        "config": {
            "reverse": False,
            "roi": {"height": 100, "left": 0, "top": 0, "width": 100},
            "tripwire": 50,
            "tripwires": {
                "entry": {
                    "end": {"x": 40, "y": 100},
                    "start": {"x": 40, "y": 0},
                },
                "exit": {
                    "end": {"x": 60, "y": 100},
                    "start": {"x": 60, "y": 0},
                },
            },
        },
        "id": camera_id,
        "name": f"Camera {camera_id}",
        "processingProfile": "auto",
        "reidMode": "auto",
        "rtsp": f"rtsp://{host}/stream2",
        "rtspStream": "stream2",
        "status": "running",
        "trackingConfidence": 0.15,
        "uniqueCountingMode": "estimated_reid",
        "zone": "Lobby",
    }


if __name__ == "__main__":
    unittest.main()
