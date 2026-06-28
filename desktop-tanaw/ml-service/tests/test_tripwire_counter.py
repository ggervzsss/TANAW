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

    def test_slow_single_tripwire_crossing_counts_when_stable_side_changes(self) -> None:
        counter = TripwireCounter(
            tripwire_position=0.5, side_margin_px=6.0, min_crossing_distance_px=10.0
        )
        counter.reset()

        self._update(counter, 1, 80, 80)
        self._update(counter, 1, 90, 80)
        self._update(counter, 1, 96, 80)
        self._update(counter, 1, 102, 80)
        self._update(counter, 1, 108, 80, expected="entry")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)
        self.assertEqual(counter.counts.occupancy, 1)

    def test_single_custom_line_counts_its_named_direction(self) -> None:
        counter = TripwireCounter(entry_line=((0.35, 0.0), (0.35, 1.0)))
        counter.reset()

        self._update(counter, 1, 50, 80)
        self._update(counter, 1, 90, 80, expected="entry")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)

    def test_custom_entry_and_exit_lines_count_their_named_directions(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 1, 50, 80)
        self._update(counter, 1, 90, 80, expected="entry")
        self._update(counter, 1, 150, 80, expected="exit")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 0)

    def test_custom_entry_path_counts_when_crossing_any_segment(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 0.45), (0.45, 1.0)),
            exit_line=((0.75, 0.0), (0.75, 1.0)),
        )
        counter.reset()

        self._update(counter, 7, 58, 82)
        self._update(counter, 7, 96, 82, expected="entry")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)

    def test_custom_exit_and_entry_lines_count_when_crossed_in_reverse_order(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 2, 150, 80)
        self._update(counter, 2, 120, 80, expected="exit")
        self._update(counter, 2, 50, 80, expected="entry")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 1)

    def test_fast_crossing_over_both_custom_lines_counts_both_directions(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 3, 50, 80)
        counter.begin_frame()
        self.assertEqual(counter.update_many(3, Centroid(150, 80), 200, 120), ["entry", "exit"])

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 0)

    def test_slow_custom_line_crossing_counts_each_stable_side_change(
        self,
    ) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
            side_margin_px=6.0,
            min_crossing_distance_px=10.0,
        )
        counter.reset()

        for x in (50, 60, 66, 72):
            self._update(counter, 3, x, 80)
        self._update(counter, 3, 78, 80, expected="entry")
        for x in (84, 90, 96, 102, 108, 114, 120, 126, 132):
            self._update(counter, 3, x, 80)
        self._update(counter, 3, 138, 80, expected="exit")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 0)

    def test_bbox_touching_custom_entry_line_counts_when_point_stays_same_side(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        counter.begin_frame()
        self.assertEqual(
            counter.update_many(5, Centroid(50, 80), 200, 120, (20, 20, 60, 118)),
            [],
        )
        counter.begin_frame()
        self.assertEqual(
            counter.update_many(5, Centroid(60, 80), 200, 120, (30, 20, 90, 118)),
            ["entry"],
        )

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)
        self.assertEqual(counter.counts.occupancy, 1)

    def test_track_initialized_on_line_counts_after_leaving_tripwire_band(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        counter.begin_frame()
        self.assertEqual(
            counter.update_many(6, Centroid(70, 80), 200, 120, (30, 20, 90, 118)),
            [],
        )
        counter.begin_frame()
        self.assertEqual(
            counter.update_many(6, Centroid(82, 80), 200, 120, (72, 20, 112, 118)),
            ["entry"],
        )

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)
        self.assertEqual(counter.counts.occupancy, 1)

    def test_fast_reverse_crossing_over_both_custom_lines_counts_both_directions(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 4, 150, 80)
        counter.begin_frame()
        self.assertEqual(counter.update_many(4, Centroid(50, 80), 200, 120), ["exit", "entry"])

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 1)
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
