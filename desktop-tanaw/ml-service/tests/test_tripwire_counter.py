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

    def test_single_tripwire_allows_entry_exit_entry_cycle_after_cooldown(self) -> None:
        counter = TripwireCounter(tripwire_position=0.5, event_cooldown_frames=1)
        counter.reset()

        self._update(counter, 1, 80, 80)
        self._update(counter, 1, 116, 80, expected="entry")
        self._update(counter, 1, 84, 80, expected="exit")
        self._update(counter, 1, 118, 80, expected="entry")

        self.assertEqual(counter.counts.entry, 2)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 1)

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

    def test_custom_entry_then_exit_sequence_counts_exit(self) -> None:
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

    def test_custom_entry_path_counts_when_crossing_any_segment(self) -> None:
        counter = TripwireCounter(entry_line=((0.35, 0.0), (0.35, 0.45), (0.45, 1.0)))
        counter.reset()

        self._update(counter, 7, 58, 82)
        self._update(counter, 7, 96, 82, expected="entry")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)

    def test_fast_center_movement_counts_when_it_intersects_sampled_path(self) -> None:
        counter = TripwireCounter(entry_line=((0.40, 0.10), (0.60, 0.90)))
        counter.reset()

        self._update(counter, 9, 70, 100)
        self._update(counter, 9, 130, 100, expected="entry")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)

    def test_paired_custom_path_counts_when_crossing_sampled_segment(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.30, 0.0), (0.35, 0.50), (0.45, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 8, 55, 82)
        self._update(counter, 8, 95, 82)
        self._update(counter, 8, 150, 82, expected="exit")

        self.assertEqual(counter.counts.entry, 0)
        self.assertEqual(counter.counts.exit, 1)

    def test_custom_exit_then_entry_sequence_counts_entry(self) -> None:
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

    def test_reverse_direction_swaps_paired_line_sequence_direction(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
            reverse_direction=True,
        )
        counter.reset()

        self._update(counter, 5, 50, 80)
        self._update(counter, 5, 90, 80)
        self._update(counter, 5, 150, 80, expected="entry")

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)
        self.assertEqual(counter.counts.occupancy, 1)

    def test_fast_crossing_over_both_custom_lines_counts_both_directions(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 3, 50, 80)
        counter.begin_frame()
        self.assertEqual(counter.update_many(3, Centroid(150, 80), 200, 120), ["exit"])

        self.assertEqual(counter.counts.entry, 0)
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
        self._update(counter, 3, 78, 80)
        for x in (84, 90, 96, 102, 108, 114, 120, 126, 132):
            self._update(counter, 3, x, 80)
        self._update(counter, 3, 138, 80, expected="exit")

        self.assertEqual(counter.counts.entry, 0)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 0)

    def test_bbox_touching_single_tripwire_does_not_count_before_point_crosses(self) -> None:
        counter = TripwireCounter(tripwire_position=0.5)
        counter.reset()

        counter.begin_frame()
        self.assertEqual(
            counter.update_many(5, Centroid(70, 80), 200, 120, (40, 20, 90, 118)),
            [],
        )
        counter.begin_frame()
        self.assertEqual(
            counter.update_many(5, Centroid(85, 80), 200, 120, (55, 20, 115, 118)),
            [],
        )
        counter.begin_frame()
        self.assertEqual(
            counter.update_many(5, Centroid(108, 80), 200, 120, (78, 20, 138, 118)),
            ["entry"],
        )

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)
        self.assertEqual(counter.counts.occupancy, 1)

    def test_bbox_touching_custom_entry_line_does_not_start_paired_sequence(self) -> None:
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
            [],
        )
        debug_state = counter.debug_state(5)
        self.assertIsNotNone(debug_state)
        assert debug_state is not None
        self.assertIsNone(debug_state["pending_line"])

        counter.begin_frame()
        self.assertEqual(
            counter.update_many(5, Centroid(150, 80), 200, 120, (130, 20, 170, 118)),
            ["exit"],
        )

        self.assertEqual(counter.counts.entry, 0)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 0)

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
            [],
        )
        counter.begin_frame()
        self.assertEqual(
            counter.update_many(6, Centroid(150, 80), 200, 120, (130, 20, 170, 118)),
            ["exit"],
        )

        self.assertEqual(counter.counts.entry, 0)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 0)

    def test_wide_bbox_spanning_paired_lines_does_not_count_same_pass_twice(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
            event_cooldown_seconds=3.6,
        )
        counter.reset()

        self.assertEqual(
            self._update_many_at(counter, 0.0, 1, 30, (0, 20, 60, 180)),
            [],
        )
        self.assertEqual(
            self._update_many_at(counter, 0.5, 1, 55, (20, 20, 90, 180)),
            [],
        )
        self.assertEqual(
            self._update_many_at(counter, 1.0, 1, 100, (55, 20, 145, 180)),
            [],
        )
        self.assertEqual(
            self._update_many_at(counter, 2.0, 1, 125, (90, 20, 160, 180)),
            [],
        )
        self.assertEqual(
            self._update_many_at(counter, 4.0, 1, 135, (100, 20, 170, 180)),
            [],
        )
        self.assertEqual(
            self._update_many_at(counter, 5.0, 1, 145, (110, 20, 180, 180)),
            ["exit"],
        )

        self.assertEqual(counter.counts.entry, 0)
        self.assertEqual(counter.counts.exit, 1)
        self.assertEqual(counter.counts.occupancy, 0)

    def test_fast_reverse_crossing_over_both_custom_lines_counts_both_directions(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 4, 150, 80)
        counter.begin_frame()
        self.assertEqual(counter.update_many(4, Centroid(50, 80), 200, 120), ["entry"])

        self.assertEqual(counter.counts.entry, 1)
        self.assertEqual(counter.counts.exit, 0)
        self.assertEqual(counter.counts.occupancy, 1)

    def test_single_line_crossing_does_not_finalize_paired_sequence(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
        )
        counter.reset()

        self._update(counter, 1, 50, 80)
        self._update(counter, 1, 90, 80)

        self.assertEqual(counter.counts.entry, 0)
        self.assertEqual(counter.counts.exit, 0)
        debug_state = counter.debug_state(1)
        self.assertIsNotNone(debug_state)
        assert debug_state is not None
        self.assertEqual(debug_state["pending_line"], "entry")

    def test_paired_sequence_expires_after_gap(self) -> None:
        counter = TripwireCounter(
            entry_line=((0.35, 0.0), (0.35, 1.0)),
            exit_line=((0.65, 0.0), (0.65, 1.0)),
            paired_line_max_gap_frames=1,
        )
        counter.reset()

        self._update(counter, 1, 50, 80)
        self._update(counter, 1, 90, 80)
        counter.begin_frame()
        counter.begin_frame()
        self._update(counter, 1, 150, 80)

        self.assertEqual(counter.counts.entry, 0)

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

    def _update_many_at(
        self,
        counter: TripwireCounter,
        now: float,
        track_id: int,
        x: float,
        bbox: tuple[int, int, int, int],
    ) -> list[str]:
        counter.begin_frame(now=now)
        return counter.update_many(track_id, Centroid(x, 180), 200, 200, bbox)


if __name__ == "__main__":
    unittest.main()
