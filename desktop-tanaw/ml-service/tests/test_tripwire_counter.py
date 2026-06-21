import unittest

from app.counting.geometry import Centroid
from app.counting.tripwire_counter import TripwireCounter


class TripwireCounterTest(unittest.TestCase):
    def test_single_tripwire_counts_entry_and_exit_once_per_track(self) -> None:
        counter = TripwireCounter(tripwire_position=0.5)
        counter.reset()

        self._update(counter, 1, 80, 80)
        self._update(counter, 1, 116, 80, expected="entry")
        self._update(counter, 1, 84, 80, expected="exit")
        self._update(counter, 1, 118, 80)

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 0)

    def test_reverse_direction_swaps_single_tripwire_direction(self) -> None:
        counter = TripwireCounter(tripwire_position=0.5, reverse_direction=True)
        counter.reset()

        self._update(counter, 1, 80, 80)
        self._update(counter, 1, 116, 80, expected="exit")

        self.assertEqual(counter.counts.entry, 0)
        self.assertEqual(counter.counts.exit, 1)

    def test_jitter_inside_margin_does_not_count(self) -> None:
        counter = TripwireCounter(
            tripwire_position=0.5, side_margin_px=6.0, min_crossing_distance_px=10.0
        )
        counter.reset()

        self._update(counter, 1, 96, 80)
        self._update(counter, 1, 104, 80)
        self._update(counter, 1, 98, 80)
        self._update(counter, 1, 102, 80)

        self.assertEqual(counter.counts.entry, 0)
        self.assertEqual(counter.counts.exit, 0)

    def test_single_custom_line_counts_its_named_direction(self) -> None:
        counter = TripwireCounter(entry_line=((0.35, 0.0), (0.35, 1.0)))
        counter.reset()

        self._update(counter, 1, 50, 80)
        self._update(counter, 1, 90, 80, expected="entry")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)

    def test_paired_custom_lines_count_exit_when_moving_from_entry_side_to_exit_side(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 1, 50, 80)
        self._update(counter, 1, 90, 80)
        self._update(counter, 1, 150, 80, expected="exit")

        self.assertEqual(counter.counts.entry, 0)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 0)

    def test_paired_custom_lines_count_entry_when_moving_from_exit_side_to_entry_side(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 2, 150, 80)
        self._update(counter, 2, 120, 80)
        self._update(counter, 2, 50, 80, expected="entry")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)
        self.assertEqual(counter.counts.occupancy, 1)

    def test_fast_crossing_over_both_paired_lines_counts_exit(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 3, 50, 80)
        self._update(counter, 3, 150, 80, expected="exit")

        self.assertEqual(counter.counts.entry, 0)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 0)

    def test_fast_crossing_over_both_paired_lines_counts_entry(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 4, 150, 80)
        self._update(counter, 4, 50, 80, expected="entry")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)
        self.assertEqual(counter.counts.occupancy, 1)

    def test_stale_track_can_count_again_after_ttl(self) -> None:
        counter = TripwireCounter(tripwire_position=0.5, track_ttl_frames=2)
        counter.reset()

        self._update(counter, 1, 80, 80)
        self._update(counter, 1, 116, 80, expected="entry")
        counter.begin_frame()
        counter.begin_frame()
        counter.begin_frame()
        self._update(counter, 1, 80, 80)
        self._update(counter, 1, 116, 80, expected="entry")

        self.assertEqual(counter.counts.entry, 2)

    def test_timestamp_ttl_expires_track_independent_of_frame_rate(self) -> None:
        counter = TripwireCounter(tripwire_position=0.5, track_ttl_seconds=1.0)
        counter.reset()
        counter.begin_frame(now=10.0)
        counter.update(1, Centroid(80, 80), 200, 120)
        counter.begin_frame(now=11.1)

        self.assertNotIn(1, counter.tracks)

    def _update(
        self,
        counter: TripwireCounter,
        track_id: int,
        x: float,
        y: float,
        expected: str | None = None,
    ) -> None:
        counter.begin_frame()
        self.assertEqual(counter.update(track_id, Centroid(x, y), 200, 120), expected)


if __name__ == "__main__":
    unittest.main()
