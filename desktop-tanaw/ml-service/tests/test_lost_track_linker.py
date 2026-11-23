import numpy as np

from app.camera.frame_geometry import occlusion_fractions
from app.counting.geometry import Centroid
from app.reid import TrackAppearanceBuffer
from app.tracking import LostTrackLinker, ResolvedTrack


def unit(*values: float) -> np.ndarray:
    vector = np.asarray(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


PERSON = unit(1, 0, 0)
# Cosine 0.72 to PERSON: below the daily match bar (0.80), above the single-candidate
# resume bar (0.70).
SAME_PERSON_LATER = unit(0.72, np.sqrt(1 - 0.72**2), 0)
# Cosine 0.67: enough to beat a rival, not enough as the only candidate.
WEAK_LIKENESS = unit(0.67, np.sqrt(1 - 0.67**2), 0)
SOMEONE_ELSE = unit(0, 0, 1)


def seen(linker: LostTrackLinker, track_id: int, at: float, x: float = 0.5) -> None:
    linker.observe({track_id: (x, 0.5)}, at)


def test_track_resuming_a_briefly_hidden_person_links_to_their_track() -> None:
    linker = LostTrackLinker()
    seen(linker, 1, 0.0)
    seen(linker, 1, 1.0)
    linker.remember_appearance(1, PERSON)
    seen(linker, 2, 4.0, x=0.55)
    # A track looks for its past only once its appearance is trusted.
    assert not linker.needs_link_decision(2, 4.0)
    linker.remember_appearance(2, SAME_PERSON_LATER)
    assert linker.needs_link_decision(2, 4.0)
    assert linker.link(2, SAME_PERSON_LATER) == 1
    assert not linker.needs_link_decision(2, 4.5)


def test_link_attempts_are_timed_from_the_first_trusted_appearance() -> None:
    linker = LostTrackLinker(decision_window_seconds=5.0)
    seen(linker, 1, 0.0)
    linker.remember_appearance(1, PERSON)
    seen(linker, 2, 2.0)
    # In a crowd the new track collects clean samples only after several seconds.
    seen(linker, 2, 9.0)
    linker.remember_appearance(2, SOMEONE_ELSE)
    assert linker.needs_link_decision(2, 9.0)
    assert linker.link(2, SOMEONE_ELSE) is None
    # A failed attempt is retried with a better view while the window lasts.
    seen(linker, 2, 11.0)
    assert linker.needs_link_decision(2, 11.0)
    assert linker.link(2, SAME_PERSON_LATER) == 1
    assert not linker.needs_link_decision(2, 11.0)
    late = LostTrackLinker(decision_window_seconds=5.0)
    seen(late, 2, 0.0)
    late.remember_appearance(2, PERSON)
    seen(late, 2, 5.5)
    assert not late.needs_link_decision(2, 5.5)


def walk(
    linker: LostTrackLinker,
    track_id: int,
    start: float,
    path: list[tuple[float, float]],
    edges: list[set[str]],
) -> None:
    for step, (position, sides) in enumerate(zip(path, edges, strict=True)):
        linker.observe({track_id: position}, start + step * 0.5, edges={track_id: sides})


def test_people_walking_out_of_or_into_the_frame_are_not_linked() -> None:
    leaving = LostTrackLinker()
    walk(leaving, 1, 0.0, [(0.90, 0.5), (0.94, 0.5), (0.98, 0.5)], [set(), set(), {"right"}])
    leaving.remember_appearance(1, PERSON)
    walk(leaving, 2, 3.0, [(0.97, 0.5), (0.97, 0.5), (0.97, 0.5)], [{"right"}] * 3)
    leaving.remember_appearance(2, PERSON)
    assert leaving.link(2, PERSON) is None

    entering = LostTrackLinker()
    walk(entering, 1, 0.0, [(0.5, 0.95)] * 3, [set()] * 3)
    entering.remember_appearance(1, PERSON)
    walk(entering, 2, 3.0, [(0.5, 0.99), (0.5, 0.95), (0.5, 0.90)], [{"bottom"}, set(), set()])
    entering.remember_appearance(2, PERSON)
    assert entering.link(2, PERSON) is None


def test_a_person_hidden_while_standing_at_the_frame_edge_is_linked() -> None:
    # Close to a high camera, a person's box is cut off at the bottom of the frame.
    linker = LostTrackLinker()
    walk(linker, 1, 0.0, [(0.5, 0.99)] * 3, [{"bottom"}] * 3)
    linker.remember_appearance(1, PERSON)
    walk(linker, 2, 3.0, [(0.52, 0.99)] * 3, [{"bottom"}] * 3)
    linker.remember_appearance(2, PERSON)
    assert linker.needs_link_decision(2, 4.0)
    assert linker.link(2, PERSON) == 1


def test_a_tracker_flicker_at_the_frame_edge_is_linked() -> None:
    # Standing at the side of the frame, the cut-off box jitters outwards, then the tracker
    # replaces the track a moment later at the same spot.
    linker = LostTrackLinker()
    walk(linker, 1, 0.0, [(0.948, 0.32), (0.963, 0.32), (0.973, 0.33)], [{"right"}] * 3)
    linker.remember_appearance(1, PERSON)
    walk(linker, 2, 1.2, [(0.958, 0.29)] * 3, [{"right"}] * 3)
    linker.remember_appearance(2, PERSON)
    assert linker.link(2, PERSON) == 1


def test_an_edge_entry_waits_until_its_motion_is_known() -> None:
    linker = LostTrackLinker()
    linker.observe({1: (0.5, 0.97)}, 0.0)
    linker.remember_appearance(1, PERSON)
    linker.observe({2: (0.5, 0.99)}, 2.0, edges={2: {"bottom"}})
    linker.remember_appearance(2, PERSON)
    assert linker.link(2, PERSON) is None
    # Standing still for a second at the edge, it is no longer walking in.
    linker.observe({2: (0.5, 0.99)}, 3.1, edges={2: {"bottom"}})
    assert linker.link(2, PERSON) == 1


def test_a_lone_candidate_needs_a_stronger_likeness() -> None:
    linker = LostTrackLinker()
    seen(linker, 1, 0.0)
    linker.remember_appearance(1, PERSON)
    seen(linker, 2, 2.0)
    assert linker.link(2, WEAK_LIKENESS) is None


def test_tracks_visible_together_are_never_linked() -> None:
    linker = LostTrackLinker()
    linker.observe({1: (0.5, 0.5), 2: (0.52, 0.5)}, 0.0)
    linker.remember_appearance(1, PERSON)
    linker.observe({2: (0.52, 0.5)}, 1.0)
    assert linker.link(2, PERSON) is None


def test_far_away_long_gaps_and_other_people_are_not_linked() -> None:
    far = LostTrackLinker()
    seen(far, 1, 0.0, x=0.1)
    far.remember_appearance(1, PERSON)
    seen(far, 2, 1.0, x=0.9)
    assert far.link(2, PERSON) is None

    late = LostTrackLinker(max_gap_seconds=10.0)
    seen(late, 1, 0.0)
    late.remember_appearance(1, PERSON)
    seen(late, 2, 12.0)
    assert late.link(2, PERSON) is None

    stranger = LostTrackLinker()
    seen(stranger, 1, 0.0)
    stranger.remember_appearance(1, PERSON)
    seen(stranger, 2, 2.0)
    assert stranger.link(2, SOMEONE_ELSE) is None


def test_two_similar_candidates_are_ambiguous_and_a_track_has_one_successor() -> None:
    ambiguous = LostTrackLinker()
    ambiguous.observe({1: (0.5, 0.5), 2: (0.52, 0.5)}, 0.0)
    ambiguous.remember_appearance(1, PERSON)
    ambiguous.remember_appearance(2, PERSON)
    seen(ambiguous, 3, 2.0)
    assert ambiguous.link(3, PERSON) is None

    single = LostTrackLinker()
    seen(single, 1, 0.0)
    single.remember_appearance(1, PERSON)
    single.observe({2: (0.5, 0.5), 3: (0.6, 0.5)}, 2.0)
    assert single.link(2, PERSON) == 1
    assert single.link(3, PERSON) is None


def test_overlapped_crops_are_not_sampled_and_recent_views_are_kept() -> None:
    fractions = occlusion_fractions(
        {1: (0, 0, 100, 200), 2: (50, 0, 150, 200), 3: (300, 0, 400, 200)}
    )
    assert fractions[1] == 0.5 and fractions[2] == 0.5 and fractions[3] == 0.0

    buffer = TrackAppearanceBuffer()
    track = ResolvedTrack(
        1, 1, (10, 10, 90, 190), 0.9, Centroid(50, 100), Centroid(50, 100), "new", None, "motion"
    )
    assert buffer.should_sample(track, 200, 200, 1, occlusion=0.1)
    assert not buffer.should_sample(track, 200, 200, 1, occlusion=0.5)

    buffer.record_sample(1, PERSON, 0.95, 1)
    for frame in (2, 3, 4):
        buffer.record_sample(1, SOMEONE_ELSE, 0.10, frame)
    # The quality-ranked mean still favours the early high-quality view ...
    ranked = buffer.embedding_for_track(1)
    assert ranked is not None and float(ranked @ PERSON) > 0.5
    # ... while the latest view reflects how the person looks now.
    recent = buffer.recent_embedding_for_track(1)
    assert recent is not None and float(recent @ SOMEONE_ELSE) > 0.99
