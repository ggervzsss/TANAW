"""Direct headcounts and doorway balances describe one timestamped population."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from app.camera.pipeline_manager import CameraPipelineRegistry
from app.config.camera_coverage import CameraCoverage
from app.storage.repositories.establishment_repository import day_bounds

NOW = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=1)


def profile(source, mode, *, role="external_boundary", relationship="independent", related=None):
    return dict(
        id=source,
        name=f"Camera {source}",
        zone=f"Area {source}",
        status="running",
        rtsp=f"rtsp://192.168.1.{source + 10}/stream2",
        cameraHost=f"192.168.1.{source + 10}",
        rtspStream="stream2",
        analysisMode=mode,
        coverage=dict(role=role, relationship=relationship, related_camera_id=related),
        confidence=0.35,
        processingProfile="auto",
        uniqueCountingMode="estimated_reid",
        config=dict(tripwire=50, reverse=False, roi=dict(left=0, top=0, width=100, height=100)),
    )


class Runtime:
    def __init__(self, root, monkeypatch):
        self.root, self.monkeypatch = root, monkeypatch
        self.states = {}
        self.open()

    def open(self):
        self.pipeline = CameraPipelineRegistry(str(self.root))
        self.pipeline.bind_enterprise("park")
        self.monkeypatch.setattr(
            self.pipeline, "camera_states", lambda: {"cameras": list(self.states.values())}
        )

    def close(self):
        self.pipeline.close()

    @property
    def service(self):
        service = self.pipeline._establishment_registry
        assert service is not None
        return service

    @property
    def repository(self):
        return self.pipeline.establishment_repository()

    def configure(self, *profiles):
        self.pipeline.replace_camera_profiles(list(profiles))

    def door(self, source, running=True):
        self.states[source] = dict(
            camera_id=source,
            counts=dict(running=running, status="running" if running else "stopped"),
            health=dict(raw_frame_stale_ms=0, reid_model_ready=True),
        )

    def area(self, source, count, at, available=True):
        self.states[source] = dict(
            camera_id=source,
            counts=dict(running=available, status="running" if available else "stopped"),
            health=dict(reid_model_ready=True),
            area=dict(
                available=available,
                presence=count,
                observed_at=at.isoformat(),
                observed_track_ids=[],
            ),
        )

    def visible_people(self, source, count, at, *track_ids):
        self.area(source, count, at)
        self.states[source]["area"].update(run_id="run", observed_track_ids=list(track_ids))

    def cross(
        self, source, event_id, at, direction: Literal["entry", "exit"] = "entry", identified=True
    ):
        configured = next(
            item for item in self.pipeline.list_camera_profiles() if item["id"] == source
        )
        self.service.observe(
            observation_id=event_id,
            camera_id=source,
            track_key=event_id,
            analysis_mode="entrance_exit",
            kind=direction,
            coverage=CameraCoverage.model_validate(configured["coverage"]),
            qualified=True,
            first_at=at,
            observed_at=at,
            embedding=np.array([1, 0, 0], dtype=np.float32) if identified else None,
        )

    def live(self, at):
        result = self.pipeline.establishment_live(at)
        self.repository.checkpoint_occupancy(result, at)
        return result

    def summary(self, day=NOW):
        begin, end = map(
            datetime.fromisoformat,
            day_bounds(day.astimezone(ZoneInfo("Asia/Manila")).date().isoformat()),
        )
        return self.repository.summary(begin, end)


@pytest.fixture
def runtime(tmp_path: Path, monkeypatch):
    value = Runtime(tmp_path, monkeypatch)
    try:
        yield value
    finally:
        value.close()


def test_direct_primary_hands_off_with_opening_population_and_later_crossings(runtime):
    h = runtime
    h.configure(
        profile(1, "open_space"), profile(2, "entrance_exit", relationship="alternative", related=1)
    )
    h.area(1, 5, NOW)
    h.door(2)
    assert h.live(NOW)["occupancy"] == 5
    h.cross(2, "arrival", NOW + timedelta(seconds=1))
    # A repeated read of the same direct frame must not reset a later arrival.
    assert h.live(NOW + timedelta(seconds=2))["occupancy"] == 6
    h.area(1, None, NOW, False)
    assert h.live(NOW + timedelta(seconds=3))["occupancy"] == 6
    h.cross(2, "arrival", NOW + timedelta(seconds=1))
    assert h.live(NOW + timedelta(seconds=4))["occupancy"] == 6
    h.close()
    h.open()
    assert h.live(NOW + timedelta(seconds=5))["occupancy"] == 6
    h.cross(2, "departure", NOW + timedelta(seconds=6), "exit")
    assert h.live(NOW + timedelta(seconds=7))["occupancy"] == 5
    h.area(1, 4, NOW + timedelta(seconds=8))
    assert h.live(NOW + timedelta(seconds=8))["occupancy"] == 4
    h.cross(2, "next-arrival", NOW + timedelta(seconds=9))
    h.area(1, None, NOW, False)
    assert h.live(NOW + timedelta(seconds=10))["occupancy"] == 5
    assert h.summary()["peak_occupancy"] == 6
    with h.repository.database.connection() as db:
        assert (
            db.execute("select count(*) from establishment_population_anchors").fetchone()[0] == 1
        )


def test_direct_backup_reanchors_a_doorway_primary_without_adding_both(runtime):
    h = runtime
    h.configure(
        profile(1, "entrance_exit"), profile(2, "open_space", relationship="alternative", related=1)
    )
    h.door(1, False)
    h.area(2, 7, NOW)
    assert h.live(NOW)["occupancy"] == 7
    h.door(1)
    h.cross(1, "arrival", NOW + timedelta(seconds=1))
    h.area(2, 3, NOW + timedelta(seconds=2))
    assert h.live(NOW + timedelta(seconds=2))["occupancy"] == 8
    h.door(1, False)
    assert h.live(NOW + timedelta(seconds=3))["occupancy"] == 3
    h.door(1)
    assert h.live(NOW + timedelta(seconds=4))["occupancy"] == 3


def test_internal_independent_doorway_contributes_presence_without_boundary_arrivals(runtime):
    h = runtime
    h.configure(profile(1, "entrance_exit", role="internal_observation"))
    h.door(1)
    h.cross(1, "internal-entry", NOW)
    assert h.live(NOW + timedelta(seconds=1))["occupancy"] == 1
    result = h.summary()
    assert result["entries"] == result["exits"] == 0
    assert result["movement_state"] == "unavailable"
    assert result["unique_count"] == 1
    h.cross(1, "internal-exit", NOW + timedelta(seconds=2), "exit")
    assert h.live(NOW + timedelta(seconds=3))["occupancy"] == 0


def test_contained_internal_door_balance_does_not_inflate_parent_and_can_be_corrected(runtime):
    h = runtime
    h.configure(
        profile(1, "entrance_exit"),
        profile(
            2, "entrance_exit", role="internal_observation", relationship="contained", related=1
        ),
    )
    h.door(1)
    h.door(2)
    h.pipeline.record_occupancy_correction(
        camera_id=1, new_occupancy=100, reason="Verified people inside", now=NOW
    )
    h.cross(2, "zone-entry", NOW + timedelta(seconds=1))
    assert h.live(NOW + timedelta(seconds=2))["occupancy"] == 100
    correction = h.pipeline.record_occupancy_correction(
        camera_id=2,
        new_occupancy=3,
        reason="Verified zone population",
        now=NOW + timedelta(seconds=3),
    )
    assert correction["old_occupancy"] == 1
    assert h.live(NOW + timedelta(seconds=4))["occupancy"] == 100
    assert sorted(h.repository.population_balances().values()) == [3, 100]
    assert h.summary()["entries"] == 0


def test_population_anchors_and_corrections_survive_day_and_retention_boundaries(runtime):
    h = runtime
    h.configure(
        profile(1, "open_space"), profile(2, "entrance_exit", relationship="alternative", related=1)
    )
    h.area(1, 5, NOW)
    h.door(2)
    h.live(NOW)
    h.area(1, None, NOW, False)
    h.cross(2, "next-day-exit", NOW + timedelta(days=1), "exit")
    assert h.live(NOW + timedelta(days=1, seconds=1))["occupancy"] == 4
    h.repository.cleanup(NOW + timedelta(days=31))
    assert list(h.repository.population_balances().values()) == [4]
    h.repository.cleanup(NOW + timedelta(days=181))
    assert list(h.repository.population_balances().values()) == [4]
    h.repository.cleanup(NOW + timedelta(days=202))
    assert list(h.repository.population_balances().values()) == [4]


def test_coverage_role_edits_keep_historical_population_scopes(runtime):
    h = runtime
    h.configure(profile(1, "entrance_exit"))
    h.door(1)
    h.cross(1, "outside-entry", NOW)
    old_key = next(iter(h.repository.population_balances()))
    h.configure(profile(1, "entrance_exit", role="internal_observation"))
    h.cross(1, "inside-entry", NOW + timedelta(seconds=10))
    result = h.live(NOW + timedelta(seconds=11))
    assert result["occupancy"] == 1
    assert result["state"] == "partial"
    assert h.repository.population_balances()[old_key] == 1
    assert len(h.repository.population_balances()) == 2
    assert h.summary()["entries"] == 1
    assert h.summary()["unique_count"] == 1


def test_unchanged_direct_measurements_compress_intervals_and_keep_source_zero(runtime):
    h = runtime
    h.configure(profile(1, "open_space"))
    for seconds in range(20):
        at = NOW + timedelta(seconds=seconds)
        h.area(1, 0, at)
        assert h.live(at)["occupancy"] == 0
    with h.repository.database.connection() as db:
        assert (
            db.execute("select count(*) from establishment_occupancy_intervals").fetchone()[0] == 1
        )
        assert (
            db.execute("select count(*) from establishment_population_anchors").fetchone()[0] == 1
        )
    result = h.summary()
    assert result["covered_ms"] == 19000
    assert result["source_breakdown"][0]["unique_count"] == 0
    assert result["source_breakdown"][0]["observation_state"] == "observed"
    assert result["source_breakdown"][0]["analysis_modes"] == ["open_space"]


def test_overlapping_frames_can_improve_at_the_same_latest_capture_time(runtime, monkeypatch):
    h = runtime
    h.configure(
        profile(1, "open_space", role="internal_observation"),
        profile(
            2, "open_space", role="internal_observation", relationship="overlapping", related=1
        ),
    )
    monkeypatch.setattr(
        h.repository,
        "identities_for_tracks",
        lambda keys, day: {key.rsplit(":", 1)[1] for key in keys},
    )
    h.visible_people(1, 2, NOW + timedelta(seconds=1), "a", "b")
    h.visible_people(2, 1, NOW, "b")
    assert h.live(NOW + timedelta(seconds=1))["occupancy"] == 2
    h.visible_people(2, 2, NOW + timedelta(milliseconds=500), "b", "c")
    assert h.live(NOW + timedelta(seconds=1, milliseconds=100))["occupancy"] == 3
    assert h.live(NOW + timedelta(seconds=1, milliseconds=200))["state"] == "estimated"
    h.visible_people(2, 1, NOW, "b")
    assert h.live(NOW + timedelta(seconds=1, milliseconds=300))["occupancy"] == 3
    assert h.live(NOW + timedelta(seconds=8))["occupancy"] is None


def test_late_identity_resolution_corrects_past_peak_without_replaying_arrivals(runtime):
    h = runtime
    h.configure(
        profile(1, "open_space"),
        profile(2, "entrance_exit", relationship="alternative", related=1),
        profile(3, "entrance_exit", relationship="alternative", related=1),
    )
    h.area(1, 5, NOW)
    h.door(2)
    h.door(3)
    h.live(NOW)
    first = NOW + timedelta(seconds=1)
    second = NOW + timedelta(seconds=1, milliseconds=200)
    h.cross(2, "view-a", first, identified=False)
    h.cross(3, "view-b", second, identified=False)
    h.area(1, 5, NOW + timedelta(seconds=2))
    h.live(NOW + timedelta(seconds=2))
    assert h.summary()["peak_occupancy"] == 7
    h.cross(2, "view-a", first)
    h.cross(3, "view-b", second)
    assert h.summary()["entries"] == 1
    assert h.summary()["peak_occupancy"] == 6
    assert list(h.repository.population_balances().values()) == [5]
    h.cross(3, "view-b", second)
    assert h.summary()["peak_occupancy"] == 6


def test_contained_camera_can_reconcile_with_a_separate_area_through_parent_coverage(runtime):
    h = runtime
    h.configure(
        profile(1, "entrance_exit"),
        profile(2, "open_space", role="internal_observation", relationship="contained", related=1),
        profile(3, "open_space", role="internal_observation"),
    )
    h.door(1)
    h.area(2, 0, NOW)
    h.area(3, 0, NOW)
    h.live(NOW)
    h.live(NOW + timedelta(seconds=1))
    result = h.summary()
    assert result["reconciliation_state"] != "configuration_required"
    assert result["days"][0]["unconfigured_camera_pairs"] == []
