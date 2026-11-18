import asyncio
import threading
import unittest
from collections.abc import AsyncGenerator
from contextlib import ExitStack
from tempfile import TemporaryDirectory
from typing import cast
from unittest.mock import patch

import cv2
import numpy as np
from fastapi import Request

from app.camera.camera_manager import CameraProcessingManager
from app.camera.models import ProcessingSession
from app.camera.pipeline_manager import CameraPipelineRegistry
from app.config.camera_config import CameraStartRequest
from app.main import build_camera_state_envelope, camera_states, create_app, stream


def body_frames(body: object) -> AsyncGenerator[bytes, None]:
    """The stream route's body is its frames() async generator."""
    return cast(AsyncGenerator[bytes, None], body)


class LiveCameraStreamTest(unittest.IsolatedAsyncioTestCase):
    async def test_stream_waits_for_real_camera_frames_across_start_reconnect_and_restart(self):
        with TemporaryDirectory() as directory, ExitStack() as resources:
            manager = CameraProcessingManager(directory, camera_id=1)
            resources.callback(manager.close)
            manager.bind_enterprise("test-camera-stream", "Test stream")
            registry = CameraPipelineRegistry(directory)
            registry._pipelines[1] = manager
            request = Request({"type": "http", "app": create_app(registry=registry)})
            config = CameraStartRequest(
                camera_id=1,
                stream_url="rtsp://192.0.2.1/stream2",
                analysis_mode="open_space",
                preview_only=True,
            )
            validation_started = threading.Event()
            finish_validation = threading.Event()

            def validate(_config: object) -> tuple[bool, str]:
                validation_started.set()
                self.assertTrue(finish_validation.wait(4))
                return True, "Verified"

            def hold_capture(session: ProcessingSession) -> None:
                session.stop_event.wait()

            with (
                patch.object(manager, "_validate_config_stream", side_effect=validate),
                patch.object(manager, "_capture_loop", side_effect=hold_capture),
                patch.object(manager, "_detect_and_count", return_value=[]),
            ):
                start = asyncio.create_task(asyncio.to_thread(manager.start, config))
                try:
                    self.assertTrue(await asyncio.to_thread(validation_started.wait, 3))
                    responses = [
                        await stream(1, request, overlay=overlay) for overlay in (False, True)
                    ]
                    self.assertEqual(responses[0].headers["cache-control"], "no-store")
                    self.assertEqual(responses[0].headers["x-tanaw-stream-frames"], "live-only")
                    iterators = [body_frames(response.body_iterator) for response in responses]
                    first = await self.assert_waiting_for_video(iterators)
                finally:
                    finish_validation.set()
                    await start
                self.assertEqual(manager.counts()["status"], "connecting")
                self.assertTrue(all(not task.done() for task in first))
                session = manager._active_session
                assert session is not None
                generation = camera_states(request).cameras[0].health.stream_generation
                self.assertEqual(generation, manager.model_status()["stream_generation"])
                self.assertEqual(
                    build_camera_state_envelope(registry)["data"]["cameras"][0]["health"][
                        "stream_generation"
                    ],
                    generation,
                )
                bound = await stream(1, request, overlay=False, generation=generation)
                bound_frames = body_frames(bound.body_iterator)
                self.assert_live_jpeg(
                    await self.publish_and_read(manager, session, first, (101, 138, 72)),
                    (101, 138, 72),
                )
                await asyncio.wait_for(anext(bound_frames), 3)
                reconnect = await self.assert_waiting_for_video(iterators)
                manager._mark_reconnecting(session, "Test camera disconnected")
                self.assertEqual(manager.counts()["status"], "reconnecting")
                with self.assertRaises(StopAsyncIteration):
                    await asyncio.wait_for(anext(bound_frames), 3)
                self.assertTrue(all(not task.done() for task in reconnect))
                self.assert_live_jpeg(
                    await self.publish_and_read(manager, session, reconnect, (64, 91, 160)),
                    (64, 91, 160),
                )
                await asyncio.to_thread(manager.stop)
                stopped = await self.assert_waiting_for_video(iterators)
                await asyncio.to_thread(manager.start, config)
                self.assertTrue(all(not task.done() for task in stopped))
                restarted = manager._active_session
                assert restarted is not None
                self.assertIsNot(restarted, session)
                self.assert_live_jpeg(
                    await self.publish_and_read(manager, restarted, stopped, (71, 163, 104)),
                    (71, 163, 104),
                )
                for iterator in iterators:
                    await iterator.aclose()

    async def test_raw_encoder_discards_frame_if_camera_disconnects_during_encoding(self):
        with TemporaryDirectory() as directory, ExitStack() as resources:
            manager = CameraProcessingManager(directory, camera_id=1)
            resources.callback(manager.close)
            config = CameraStartRequest(camera_id=1, stream_url="rtsp://192.0.2.1/stream2")
            session = ProcessingSession(1, config, threading.Event(), "test")
            with manager._lock:
                manager._active_session = session
            manager._publish_raw_frame(session, np.zeros((72, 112, 3), dtype=np.uint8))
            encoding_started = threading.Event()
            finish_encoding = threading.Event()

            def encode(_frame):
                encoding_started.set()
                self.assertTrue(finish_encoding.wait(4))
                return b"old JPEG"

            with patch.object(manager._frame_renderer, "encode_frame", side_effect=encode):
                cursor = (-1, 0)
                result = asyncio.create_task(
                    asyncio.to_thread(manager.wait_for_stream_frame, cursor, overlay=False)
                )
                try:
                    self.assertTrue(await asyncio.to_thread(encoding_started.wait, 3))
                    manager._mark_reconnecting(session, "Test camera disconnected")
                finally:
                    finish_encoding.set()
                    self.assertEqual(await result, (None, cursor))

    async def assert_waiting_for_video(self, iterators):
        tasks = [asyncio.create_task(anext(iterator)) for iterator in iterators]
        done, _ = await asyncio.wait(tasks, timeout=0.06)
        self.assertEqual(done, set(), "An idle connection emitted a JPEG")
        return tasks

    async def publish_and_read(self, manager, session, tasks, color):
        frame = np.full((72, 112, 3), color, dtype=np.uint8)
        manager._publish_raw_frame(session, frame)
        return await asyncio.wait_for(asyncio.gather(*tasks), 3)

    def assert_live_jpeg(self, parts, color):
        for part in parts:
            headers, jpeg = part.split(b"\r\n\r\n", 1)
            self.assertIn(f"Content-Length: {len(jpeg) - 2}".encode(), headers)
            frame = cv2.imdecode(np.frombuffer(jpeg[:-2], dtype=np.uint8), cv2.IMREAD_COLOR)
            assert frame is not None
            self.assertEqual(frame.shape, (72, 112, 3))
            np.testing.assert_allclose(frame[44, 25], color, atol=3)
