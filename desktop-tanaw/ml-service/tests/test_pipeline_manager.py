import tempfile
import threading
import unittest

from app.camera.camera_manager import CameraProcessingManager
from app.camera.pipeline_manager import CameraCapacityError, CameraPipelineRegistry
from app.config.camera_config import CameraStartRequest


class FakePipeline(CameraProcessingManager):
    def __init__(self, app_data_dir: str | None = None, camera_id: int | None = None) -> None:
        self.camera_id = camera_id
        self.running_value = False
        self.start_calls = 0
        self.stop_calls = 0
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
        self.config = config
        self.start_calls += 1
        self.running_value = True

    def stop(self) -> None:
        self.stop_calls += 1
        self.running_value = False

    def counts(self) -> dict:
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

    def session(self) -> dict:
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

    def test_capacity_limit_rejects_only_the_additional_camera(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(
                directory, max_concurrent_cameras=1, pipeline_factory=FakePipeline
            )
            registry.bind_enterprise("enterprise@example.test")
            registry.start(_config(1))

            with self.assertRaisesRegex(CameraCapacityError, "capacity"):
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
                self.assertFalse(registry.request_start(first))
                with self.assertRaisesRegex(CameraCapacityError, "capacity"):
                    registry.request_start(_config(2))
            finally:
                finish_initialization.set()

            self.assertTrue(initialization_finished.wait(timeout=1))
            self.assertTrue(registry.require_pipeline(1).running)

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
            self.assertEqual(registry.camera_states()["cameras"], [])

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


if __name__ == "__main__":
    unittest.main()
