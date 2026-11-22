"""Safeguards that keep identity continuity from merging people or counting too early."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

from app.camera.camera_manager import CameraProcessingManager
from app.camera.models import PendingEntryEvent
from app.counting.geometry import Centroid
from app.identity.establishment_registry import EstablishmentRegistry
from app.storage.repositories.establishment_repository import day_bounds
from app.tracking import ResolvedTrack

NOW = datetime(2026, 11, 10, 2, tzinfo=UTC)
DAY = "2026-11-10"


def unit(*values: float) -> np.ndarray:
    vector = np.zeros(4, dtype=np.float32)
    vector[: len(values)] = values
    return vector / np.linalg.norm(vector)


def at_cosine(score: float) -> np.ndarray:
    return unit(score, np.sqrt(1 - score**2))


PERSON = unit(1)
STRANGER = unit(0, 0, 1)


def observe(service: EstablishmentRegistry, key: str, **changes: Any) -> Any:
    at = changes.pop("observed_at", NOW)
    args: dict[str, Any] = dict(
        observation_id=changes.pop("observation_id", f"visit-{key}"),
        camera_id=2,
        track_key=key,
        analysis_mode="open_space",
        kind="area_visit",
        qualified=True,
        first_at=changes.pop("first_at", at),
        observed_at=at,
        embedding=PERSON,
    )
    return service.observe(**{**args, **changes})


def unique_count(service: EstablishmentRegistry, day: str = DAY) -> int:
    start, end = (datetime.fromisoformat(value) for value in day_bounds(day))
    return int(service.repository.summary(start, end)["unique_count"])


def rows(service: EstablishmentRegistry) -> dict[str, tuple[str | None, str]]:
    with service.database.connection() as db:
        return {
            row["track_key"]: (row["visitor_id"], row["identity_confidence"])
            for row in db.execute(
                "select track_key,visitor_id,identity_confidence from establishment_observations"
            )
        }


def test_people_seen_side_by_side_stay_apart_when_settled_later(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    earlier, beside = unit(0.3, 0.954), unit(0.77, 0.439, 0.463)
    observe(service, "r:3", embedding=earlier)
    # A, then B next to A: B looks like A (0.77) and like an earlier visitor (0.65).
    service.update_present_tracks(2, {"r:1"}, NOW + timedelta(seconds=20))
    observe(service, "r:1", observed_at=NOW + timedelta(seconds=20))
    for second in (21, 22):
        service.update_present_tracks(2, {"r:1", "r:2"}, NOW + timedelta(seconds=second))
        observe(
            service,
            "r:2",
            embedding=beside,
            first_at=NOW + timedelta(seconds=21),
            observed_at=NOW + timedelta(seconds=second),
        )
    # A walks off before B's identity is settled.
    service.update_present_tracks(2, {"r:2"}, NOW + timedelta(seconds=23))
    observe(
        service,
        "r:1",
        first_at=NOW + timedelta(seconds=20),
        observed_at=NOW + timedelta(seconds=23),
        ended_at=NOW + timedelta(seconds=23),
    )
    for second in range(24, 34):
        service.update_present_tracks(2, {"r:2"}, NOW + timedelta(seconds=second))
        observe(
            service,
            "r:2",
            embedding=beside,
            first_at=NOW + timedelta(seconds=21),
            observed_at=NOW + timedelta(seconds=second),
        )
    assert unique_count(service) == 3


def test_a_track_linked_to_an_uncertain_visitor_waits_for_it(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "first")
    later = NOW + timedelta(minutes=1)
    uncertain = observe(service, "run:1", embedding=at_cosine(0.65), observed_at=later)
    assert uncertain.identity_confidence == "low"
    observe(service, "run:2", embedding=None, observed_at=later + timedelta(seconds=3))
    linked = service.link_track(
        camera_id=2,
        track_key="run:2",
        predecessor_track_key="run:1",
        observed_at=later + timedelta(seconds=3),
    )
    assert linked == uncertain.visitor_id
    assert rows(service)["2:run:2"] == (uncertain.visitor_id, "low")
    assert unique_count(service) == 1
    assert service.finalize_pending(later + timedelta(seconds=11))
    assert rows(service)["2:run:2"] == (uncertain.visitor_id, "high")
    assert unique_count(service) == 2


def test_linking_two_identified_tracks_merges_their_visitors(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    first = observe(service, "run:1")
    observe(service, "run:2", embedding=STRANGER, observed_at=NOW + timedelta(seconds=3))
    assert unique_count(service) == 2
    linked = service.link_track(
        camera_id=2,
        track_key="run:2",
        predecessor_track_key="run:1",
        observed_at=NOW + timedelta(seconds=4),
    )
    assert linked == first.visitor_id
    assert {visitor for visitor, _ in rows(service).values()} == {first.visitor_id}
    assert unique_count(service) == 1


def test_visitors_seen_at_the_same_time_are_never_merged_by_a_link(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "run:1")
    observe(service, "run:1", observed_at=NOW + timedelta(seconds=5))
    observe(service, "run:2", embedding=STRANGER, observed_at=NOW + timedelta(seconds=3))
    linked = service.link_track(
        camera_id=2,
        track_key="run:2",
        predecessor_track_key="run:1",
        observed_at=NOW + timedelta(seconds=6),
    )
    assert linked is None
    assert unique_count(service) == 2


def test_an_uncertain_identity_is_settled_after_a_restart(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "first")
    later = NOW + timedelta(minutes=1)
    observe(service, "second", embedding=at_cosine(0.65), observed_at=later)
    assert unique_count(service) == 1

    restarted = EstablishmentRegistry(str(tmp_path), "park")
    # The wait started when the identity was first seen, not when the service restarted.
    assert not restarted.finalize_pending(later + timedelta(seconds=5))
    assert restarted.finalize_pending(later + timedelta(seconds=11))
    assert unique_count(restarted) == 2


def test_an_entry_identified_after_midnight_counts_on_its_crossing_day(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    crossed = datetime(2026, 11, 10, 15, 59, 59, tzinfo=UTC)  # 23:59:59 in Manila
    entry: dict[str, Any] = dict(
        observation_id="late-entry",
        camera_id=1,
        track_key="door:7",
        analysis_mode="entrance_exit",
        kind="entry",
        qualified=True,
    )
    service.observe(**entry, first_at=crossed, observed_at=crossed)
    identified_at = crossed + timedelta(seconds=2)
    service.observe(**entry, first_at=identified_at, observed_at=identified_at, embedding=PERSON)
    with service.database.connection() as db:
        crossing_day = db.execute(
            "select visitor_id,identity_confidence from establishment_observations "
            "where observation_id='late-entry' and business_date=?",
            (DAY,),
        ).fetchone()
    assert crossing_day["visitor_id"] is not None
    assert crossing_day["identity_confidence"] == "high"
    assert unique_count(service) == 1
    start, end = (datetime.fromisoformat(value) for value in day_bounds(DAY))
    assert service.repository.summary(start, end)["unresolved_observations"] == 0


def test_a_queued_entry_follows_its_track_through_a_reid_relink(tmp_path: Path) -> None:
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    try:
        track = ResolvedTrack(
            5,
            11,
            (10, 10, 60, 160),
            0.9,
            Centroid(35, 85),
            Centroid(35, 160),
            "new",
            None,
            "motion",
        )
        manager._pending_entry_events[(1, "entry")] = PendingEntryEvent(
            event_id="entry",
            session_id=1,
            track=track,
            direction="entry",
            created_at=0.0,
            expires_at=2.0,
        )
        manager._follow_remap_in_pending_entries(5, 9)
        moved = manager._pending_entry_events[(1, "entry")].track
        assert (moved.track_id, moved.source_track_id) == (9, 11)
    finally:
        manager.close()
