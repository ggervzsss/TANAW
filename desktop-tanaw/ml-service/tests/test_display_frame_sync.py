import threading
import unittest

import numpy as np

from app.camera.camera_manager import CameraProcessingManager, ProcessingSession
from app.config.camera_config import CameraStartRequest


class DisplayFrameSyncTest(unittest.TestCase):
    def test_overlay_snapshot_uses_the_frame_that_produced_the_tracks(self) -> None:
        manager = CameraProcessingManager()
        config = CameraStartRequest(stream_url="rtsp://192.168.1.20/stream2", camera_id=1)
        session = ProcessingSession(session_id=1, config=config, stop_event=threading.Event())
        raw_frame = np.full((4, 4, 3), 255, dtype=np.uint8)
        processed_frame = np.zeros((4, 4, 3), dtype=np.uint8)
        manager._active_session = session
        manager._latest_raw_frame = raw_frame
        manager._latest_raw_frame_id = 9
        manager._latest_processed_frame = processed_frame
        manager._latest_processed_frame_id = 4

        snapshot = manager._next_display_frame_snapshot(session, 3, timeout=0.0)

        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertEqual(snapshot[1], 4)
        np.testing.assert_array_equal(snapshot[0], processed_frame)
        self.assertFalse(np.array_equal(snapshot[0], raw_frame))


if __name__ == "__main__":
    unittest.main()
