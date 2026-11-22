"""Unique-visitor counting when the same person is hidden, turns, or leaves by a door."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from unittest.mock import patch

import numpy as np

from app.camera.camera_manager import CameraProcessingManager
from app.camera.models import ProcessingSession
from app.config.camera_config import CameraStartRequest
from app.config.open_space_config import OpenSpaceConfig, ZonePoint
from app.counting.geometry import Centroid
from app.identity.establishment_registry import EstablishmentRegistry
from app.identity.unique_visitor_registry import UniqueVisitorRegistry
from app.reid.async_worker import ReIdResult
from app.storage.repositories.establishment_repository import day_bounds
from app.storage.session_store import SessionStore
from app.tracking import ResolvedTrack

NOW = datetime(2026, 11, 10, 2, tzinfo=UTC)
DAY = "2026-11-10"


def unit(*values: float) -> np.ndarray:
    vector = np.asarray(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


def at_cosine(score: float) -> np.ndarray:
    """A view whose cosine similarity to ``PERSON`` is ``score``."""
    return unit(score, np.sqrt(1 - score**2), 0)


PERSON = unit(1, 0, 0)
STRANGER = unit(0, 0, 1)


def resolve(registry: UniqueVisitorRegistry, track: int, embedding: np.ndarray, **extra):  # type: ignore[no-untyped-def]
    return registry.resolve_entry(
        track_id=track,
        camera_id=1,
        embedding=embedding,
        detection_confidence=0.9,
        bbox=(10, 10, 80, 180),
        now=extra.pop("now", NOW),
        **extra,
    )


def test_a_bound_track_teaches_its_visitor_new_views(tmp_path: Path) -> None:
    registry = UniqueVisitorRegistry(SessionStore(str(tmp_path)))
    first = resolve(registry, 1, PERSON)
    turned = at_cosine(0.70)
    # Before learning, the turned view alone is only an uncertain match.
    assert registry._best_match(turned)[1] is not None
    assert float(registry._best_match(turned)[1] or 0) < 0.80
    resolve(registry, 1, PERSON, view_embedding=turned, now=NOW + timedelta(seconds=2))
    later = resolve(registry, 2, turned, now=NOW + timedelta(hours=1))
    assert later.visitor_id == first.visitor_id
    assert later.reid_decision == "matched_existing"


def test_an_inconsistent_view_is_not_learned(tmp_path: Path) -> None:
    registry = UniqueVisitorRegistry(SessionStore(str(tmp_path)))
    resolve(registry, 1, PERSON)
    resolve(registry, 1, PERSON, view_embedding=STRANGER, now=NOW + timedelta(seconds=2))
    identity = registry._gallery[0]
    assert len(identity.prototypes) == 1
    assert float(identity.embedding @ PERSON) > 0.99


def test_match_only_observations_never_add_visitors(tmp_path: Path) -> None:
    registry = UniqueVisitorRegistry(SessionStore(str(tmp_path)))
    decision = resolve(registry, 1, PERSON, allow_new_identity=False)
    assert decision.visitor_id is None and decision.reid_decision == "unmatched"
    assert registry.status()["reid_gallery_size"] == 0


def test_uncertain_identity_waits_and_is_settled_from_all_its_views(tmp_path: Path) -> None:
    registry = UniqueVisitorRegistry(
        SessionStore(str(tmp_path)),
        provisional_decision_seconds=10,
        reconciliation_match_threshold=0.76,
    )
    first = resolve(registry, 1, PERSON)
    uncertain = resolve(registry, 2, at_cosine(0.70))
    assert uncertain.reid_decision == "ambiguous_new"
    # The person turns towards the camera: a distinct view (kept as its own prototype)
    # that is much closer to the known visitor.
    facing = unit(0.92, 0.2, 0.337)
    pending = resolve(
        registry,
        2,
        at_cosine(0.70),
        view_embedding=facing,
        now=NOW + timedelta(seconds=2),
    )
    assert pending.reid_decision == "provisional_pending"
    assert pending.identity_confidence == "low"
    settled = resolve(registry, 2, at_cosine(0.70), now=NOW + timedelta(seconds=4), finalize=True)
    assert settled.reid_decision == "reconciled_existing"
    assert settled.visitor_id == first.visitor_id


def test_uncertain_identity_is_settled_once_its_wait_elapses(tmp_path: Path) -> None:
    registry = UniqueVisitorRegistry(SessionStore(str(tmp_path)), provisional_decision_seconds=10)
    resolve(registry, 1, PERSON)
    resolve(registry, 2, at_cosine(0.70))
    assert not registry.finalize_due_provisionals(NOW + timedelta(seconds=5))
    assert registry.finalize_due_provisionals(NOW + timedelta(seconds=11))
    assert registry.status()["reid_provisional_gallery_size"] == 0
    assert registry.confirmed_visitor_count(1, NOW) == 2


def establishment_observe(service: EstablishmentRegistry, key: str, **changes):  # type: ignore[no-untyped-def]
    at = changes.pop("observed_at", NOW)
    args = dict(
        observation_id=changes.pop("observation_id", key),
        camera_id=2,
        track_key=key,
        analysis_mode="open_space",
        kind="area_visit",
        qualified=True,
        first_at=at,
        observed_at=at,
        embedding=PERSON,
    )
    return service.observe(**{**args, **changes})


def unique_count(service: EstablishmentRegistry) -> int:
    start, end = (datetime.fromisoformat(value) for value in day_bounds(DAY))
    return int(service.repository.summary(start, end)["unique_count"])


def test_an_exit_matches_known_visitors_but_never_adds_one(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    entered = establishment_observe(
        service, "in", camera_id=1, analysis_mode="entrance_exit", kind="entry"
    )
    matched = establishment_observe(
        service,
        "out",
        camera_id=1,
        analysis_mode="entrance_exit",
        kind="exit",
        observed_at=NOW + timedelta(minutes=5),
    )
    unknown = establishment_observe(
        service,
        "stranger-out",
        camera_id=1,
        analysis_mode="entrance_exit",
        kind="exit",
        embedding=STRANGER,
        observed_at=NOW + timedelta(minutes=6),
    )
    assert matched.visitor_id == entered.visitor_id
    assert unknown.visitor_id is None
    start, end = (datetime.fromisoformat(value) for value in day_bounds(DAY))
    result = service.repository.summary(start, end)
    assert result["unique_count"] == 1
    assert result["unresolved_observations"] == 0


def test_a_linked_track_keeps_its_visitor_whatever_its_appearance_score(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    first = establishment_observe(service, "run:1")
    resumed_at = NOW + timedelta(seconds=3)
    assert (
        service.link_track(
            camera_id=2,
            track_key="run:2",
            predecessor_track_key="run:1",
            observed_at=resumed_at,
        )
        == first.visitor_id
    )
    # Mostly hidden at first, the resumed track looks like nobody in the gallery.
    resumed = establishment_observe(
        service, "run:2", embedding=at_cosine(0.4), observed_at=resumed_at
    )
    assert resumed.visitor_id == first.visitor_id
    assert unique_count(service) == 1


def test_a_link_shares_a_visitor_identified_after_it(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    establishment_observe(service, "run:1", embedding=None)
    service.link_track(
        camera_id=2, track_key="run:2", predecessor_track_key="run:1", observed_at=NOW
    )
    later = establishment_observe(service, "run:2", observed_at=NOW + timedelta(seconds=2))
    with service.database.connection() as db:
        visitors = {
            row["track_key"]: row["visitor_id"]
            for row in db.execute("select track_key,visitor_id from establishment_observations")
        }
    assert visitors == {"2:run:1": later.visitor_id, "2:run:2": later.visitor_id}
    assert unique_count(service) == 1


def test_an_uncertain_visitor_is_settled_while_nobody_is_in_view(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    establishment_observe(service, "first")
    uncertain = establishment_observe(
        service, "second", embedding=at_cosine(0.65), observed_at=NOW + timedelta(minutes=1)
    )
    assert uncertain.identity_confidence == "low"
    assert unique_count(service) == 1
    assert not service.finalize_pending(NOW + timedelta(minutes=1, seconds=5))
    assert service.finalize_pending(NOW + timedelta(minutes=1, seconds=11))
    assert unique_count(service) == 2


def test_open_space_person_hidden_long_enough_to_get_a_new_track_stays_one_visitor(
    tmp_path: Path,
) -> None:
    polygon = [ZonePoint(x=x, y=y) for x, y in ((0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8))]
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    manager.bind_enterprise("park", restore_session=False)
    config = CameraStartRequest(
        stream_url="rtsp://192.168.1.20/stream2",
        camera_id=1,
        analysis_mode="open_space",
        reid_mode="fast",
        open_space=OpenSpaceConfig(polygon=polygon),
    )
    manager._config = config
    manager._configure_reid_locked(config)
    session = ProcessingSession(1, config, Event(), "session")
    manager._active_session = session
    # Visible, hidden for three seconds (the visit ends), then back as a new track whose
    # appearance alone scores only 0.70 against the first.
    timeline = [
        (0, 1, PERSON),
        (1, 1, PERSON),
        (2, 1, PERSON),
        (3, 1, PERSON),
        (4, None, None),
        (5, None, None),
        (6, None, None),
        (7, 2, at_cosine(0.70)),
        (8, 2, at_cosine(0.70)),
        (9, 2, at_cosine(0.70)),
        (10, 2, at_cosine(0.70)),
    ]
    try:
        with (
            patch.object(manager._reidentifier, "status", return_value={"reid_model_ready": True}),
            patch.object(manager._tracker, "track_people", return_value=[]),
            patch.object(manager._counting_track_resolver, "resolve") as motion,
            patch.object(manager._reid_worker, "poll") as fast,
            patch.object(manager._quality_reid_worker, "poll", return_value=[]),
            patch.object(manager, "_schedule_track_embedding"),
        ):
            manager._begin_area(config)
            tracker = manager._area_tracker
            assert tracker is not None
            for second, track_id, embedding in timeline:
                observed = tracker.anchor + second
                x = 100 + (4 if track_id == 2 else 0)
                motion.return_value = (
                    [
                        ResolvedTrack(
                            track_id,
                            track_id,
                            (x - 30, 20, x + 30, 180),
                            0.9,
                            Centroid(x, 90),
                            Centroid(x, 100),
                            "new",
                            None,
                            "motion",
                        )
                    ]
                    if track_id is not None
                    else []
                )
                fast.return_value = (
                    [ReIdResult(1, track_id, track_id, embedding, 0.9, observed - 0.1, observed)]
                    if track_id is not None and embedding is not None
                    else []
                )
                with (
                    patch("app.camera.camera_manager.time.monotonic", return_value=observed),
                    patch("app.camera.camera_manager.datetime") as clock,
                ):
                    clock.now.return_value = tracker.wall_anchor + timedelta(seconds=second)
                    manager._detect_and_count(
                        session,
                        np.zeros((200, 200, 3), dtype=np.uint8),
                        0.15,
                        0.35,
                        observed_at=observed,
                    )
            registry = manager._establishment_registry
            assert registry is not None
            with registry.database.connection() as db:
                rows = db.execute(
                    "select track_key,visitor_id from establishment_observations"
                ).fetchall()
            assert len({row["track_key"] for row in rows}) == 2
            assert len({row["visitor_id"] for row in rows}) == 1
            assert rows[0]["visitor_id"] is not None
            assert manager.area_state()["unique_visitors"] == 1  # type: ignore[index]
    finally:
        manager.close()


def test_a_finished_zone_visit_is_identified_from_its_few_clean_views(tmp_path: Path) -> None:
    polygon = [ZonePoint(x=x, y=y) for x, y in ((0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8))]
    area = CameraProcessingManager(str(tmp_path), camera_id=2)
    try:
        area.bind_enterprise("park", restore_session=False)
        config = CameraStartRequest(
            camera_id=2,
            stream_url="rtsp://192.168.1.11/stream2",
            analysis_mode="open_space",
            reid_mode="fast",
            open_space=OpenSpaceConfig(polygon=polygon),
        )
        area._config = config
        area._configure_reid_locked(config)
        area._begin_area(config)
        tracker = area._area_tracker
        registry = area._establishment_registry
        assert tracker is not None and registry is not None
        # Crowded: only one clean view before the person leaves the zone.
        area._appearance_buffer.record_sample(1, PERSON, 0.9, 1)
        for second in range(4):
            tracker.update({1: (0.5, 0.5)}, tracker.anchor + second)
        area._save_area(tracker.anchor + 3, force=True)
        with registry.database.connection() as db:
            assert (
                db.execute("select visitor_id from establishment_observations").fetchone()[0]
                is None
            )
        area._finish_area("camera_stopped")
        with registry.database.connection() as db:
            visitor = db.execute("select visitor_id from establishment_observations").fetchone()[0]
        assert visitor is not None
    finally:
        area.close()
