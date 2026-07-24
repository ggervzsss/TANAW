import unittest
from typing import Any

from scripts.evaluate_tracking import evaluate


class TrackingEvaluatorTest(unittest.TestCase):
    def test_perfect_sequence_reports_perfect_identity_and_crossing_metrics(self) -> None:
        ground_truth: dict[int, dict[str, Any]] = {
            1: {"people": [{"id": "person-1", "bbox": [10, 10, 50, 100]}]},
            2: {
                "people": [{"id": "person-1", "bbox": [20, 10, 60, 100]}],
                "events": [{"person_id": "person-1", "direction": "entry"}],
            },
        }
        predictions = {
            1: {"tracks": [{"track_id": 7, "bbox": [10, 10, 50, 100]}], "processing_ms": 100.0},
            2: {
                "tracks": [{"track_id": 7, "bbox": [20, 10, 60, 100]}],
                "events": [{"track_id": 7, "direction": "entry"}],
                "processing_ms": 100.0,
            },
        }

        metrics = evaluate(ground_truth, predictions)

        self.assertEqual(metrics["idf1"], 1.0)
        self.assertEqual(metrics["crossing_precision"], 1.0)
        self.assertEqual(metrics["crossing_recall"], 1.0)
        self.assertEqual(metrics["unique_count_error"], 0.0)
        self.assertEqual(metrics["analytics_fps"], 10.0)

    def test_identity_change_and_missing_crossing_are_reported(self) -> None:
        ground_truth: dict[int, dict[str, Any]] = {
            1: {"people": [{"id": "person-1", "bbox": [10, 10, 50, 100]}]},
            2: {
                "people": [{"id": "person-1", "bbox": [20, 10, 60, 100]}],
                "events": [{"person_id": "person-1", "direction": "entry"}],
            },
        }
        predictions = {
            1: {"tracks": [{"track_id": 7, "bbox": [10, 10, 50, 100]}]},
            2: {"tracks": [{"track_id": 8, "bbox": [20, 10, 60, 100]}]},
        }

        metrics = evaluate(ground_truth, predictions)

        self.assertEqual(metrics["id_switches"], 1)
        self.assertEqual(metrics["crossing_recall"], 0.0)
        self.assertLess(float(metrics["idf1"] or 0.0), 1.0)


if __name__ == "__main__":
    unittest.main()
