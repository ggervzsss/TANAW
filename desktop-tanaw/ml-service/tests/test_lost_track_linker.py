import numpy as np

from app.camera.frame_geometry import occlusion_fractions
from app.counting.geometry import Centroid
from app.reid import TrackAppearanceBuffer
from app.tracking import LostTrackLinker, ResolvedTrack


def unit(*values: float) -> np.ndarray:
    vector = np.asarray(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


PERSON = unit(1, 0, 0)
# Cosine 0.70 to PERSON: below the daily match bar (0.80), above the resume bar (0.65).
SAME_PERSON_LATER = unit(0.70, np.sqrt(1 - 0.70**2), 0)
SOMEONE_ELSE = unit(0, 0, 1)


def seen(linker: LostTrackLinker, track_id: int, at: float, x: float = 0.5) -> None:
    linker.observe({track_id: (x, 0.5)}, at)


def test_track_resuming_a_briefly_hidden_person_links_to_their_track() -> None:
    linker = LostTrackLinker()
    seen(linker, 1, 0.0)
    seen(linker, 1, 1.0)
    linker.remember_appearance(1, PERSON)
    seen(linker, 2, 4.0, x=0.55)
    assert linker.needs_link_decision(2)
    assert linker.link(2, SAME_PERSON_LATER) == 1
    assert not linker.needs_link_decision(2)


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
