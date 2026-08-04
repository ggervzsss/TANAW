import unittest

import numpy as np

from app.camera.frame_renderer import CameraFrameRenderer
from app.config.camera_config import TripwireLine, TripwirePoint


class CameraFrameRendererTest(unittest.TestCase):
    def setUp(self) -> None:
        self.renderer = CameraFrameRenderer()

    def test_normalized_line_prefers_sampled_curve_points(self) -> None:
        line = TripwireLine(
            start=TripwirePoint(x=0.1, y=0.2),
            end=TripwirePoint(x=0.9, y=0.8),
            sampled_points=[
                TripwirePoint(x=0.1, y=0.2),
                TripwirePoint(x=0.5, y=0.6),
                TripwirePoint(x=0.9, y=0.8),
            ],
        )

        self.assertEqual(
            self.renderer.normalized_line(line),
            ((0.1, 0.2), (0.5, 0.6), (0.9, 0.8)),
        )

    def test_resize_preserves_aspect_ratio_and_skips_small_frames(self) -> None:
        large = np.zeros((100, 200, 3), dtype=np.uint8)
        small = np.zeros((50, 80, 3), dtype=np.uint8)

        self.assertEqual(self.renderer.resize_for_processing(large, 100).shape, (50, 100, 3))
        self.assertIs(self.renderer.resize_for_processing(small, 100), small)


if __name__ == "__main__":
    unittest.main()
