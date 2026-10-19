from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from typing import Any
from unittest.mock import Mock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.camera.camera_manager import CameraProcessingManager
from app.camera.models import ProcessingSession
from app.camera.pipeline_manager import CameraPipelineRegistry
from app.config.camera_config import CameraStartRequest, RegionOfInterest
from app.config.open_space_config import OpenSpaceConfig
from app.counting.geometry import Centroid
from app.detection.yolo_detector import TrackResult
from app.main import create_app
from app.storage.local_database import LocalDatabase
from app.storage.repositories.area_repository import AreaRepository

POLYGON = [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.2}, {"x": 0.8, "y": 0.8}, {"x": 0.2, "y": 0.8}]


def configuration(**changes: Any) -> CameraStartRequest:
    return CameraStartRequest(
        stream_url="rtsp://192.168.1.20/stream2",
        camera_id=1,
        analysis_mode="open_space",
        roi=RegionOfInterest(top=0, left=0, width=1, height=1),
        open_space=OpenSpaceConfig.model_validate({"polygon": POLYGON}),
        **changes,
    )


def test_mode_validation_and_preview_only_setup() -> None:
    with pytest.raises(ValueError):
        CameraStartRequest(stream_url="rtsp://192.168.1.20/stream2", analysis_mode="open_space")
    request = CameraStartRequest(
        stream_url="rtsp://192.168.1.20/stream2", analysis_mode="open_space", preview_only=True
    )
    assert request.open_space is None
    with pytest.raises(ValueError):
        CameraStartRequest(
            stream_url="rtsp://192.168.1.20/stream2",
            open_space=OpenSpaceConfig.model_validate({"polygon": POLYGON}),
        )


def test_live_camera_path_writes_area_visits_and_never_doorway_events(tmp_path: Path) -> None:
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    manager.bind_enterprise("park", restore_session=False)
    config = configuration()
    manager._config = config
    manager._begin_area(config)
    tracker = manager._area_tracker
    assert tracker is not None
    anchor = tracker.anchor
    session = ProcessingSession(1, config, Event(), "session")
    manager._active_session = session
    manager._state.running = True
    manager._state.status = "running"
    # Keep the source ID stable, with small physical movements outside/inside the zone.
    track_patch = patch.object(manager._tracker, "track_people")
    track_people = track_patch.start()
    gallery_patch = patch.object(
        manager._visitor_registry,
        "resolve_entry",
        side_effect=AssertionError("Area visits must not enter the doorway gallery"),
    )
    resolve_entry = gallery_patch.start()
    motion_patch = patch.object(manager._counting_track_resolver, "resolve")
    resolve_motion = motion_patch.start()
    try:
        for second, x in [
            (0, 0.18),
            (1, 0.22),
            (2, 0.24),
            (3, 0.26),
            (4, 0.28),
            (5, 0.81),
            (6, 0.83),
        ]:
            track = TrackResult(
                track_id=1,
                bbox=(int(x * 100) - 5, 20, int(x * 100) + 5, 50),
                confidence=0.9,
                centroid=Centroid(x * 100, 35),
                counting_point=Centroid(x * 100, 50),
            )
            # The large exit movement is intentional here; directly use a stable physical ID.
            resolve_motion.return_value = [
                Mock(
                    track_id=1,
                    source_track_id=1,
                    bbox=track.bbox,
                    confidence=0.9,
                    centroid=track.centroid,
                    counting_point=track.counting_point,
                )
            ]
            track_people.return_value = [track]
            with (
                patch("app.camera.camera_manager.time.monotonic", return_value=anchor + second),
                patch("app.camera.camera_manager.datetime") as clock,
            ):
                clock.now.return_value = tracker.wall_anchor + timedelta(seconds=second)
                manager._detect_and_count(
                    session,
                    np.zeros((100, 100, 3), dtype=np.uint8),
                    0.15,
                    0.35,
                    observed_at=anchor + second,
                )
        repo = AreaRepository(LocalDatabase(str(tmp_path), "park"))
        start = tracker.wall_anchor - timedelta(seconds=1)
        result = repo.query(1, start, start + timedelta(hours=1))
        assert result["completed_count"] == 1
        assert result["median_dwell_ms"] == 3000
        assert manager.counts()["entry"] is None
        assert manager.counts()["occupancy"] is None
        with repo.database.connection() as db:
            assert db.execute("select count(*) from count_events").fetchone()[0] == 0
        resolve_entry.assert_not_called()
    finally:
        motion_patch.stop()
        gallery_patch.stop()
        track_patch.stop()
        manager.close()


def test_local_api_scope_authentication_and_coverage_ranges(tmp_path: Path) -> None:
    registry = CameraPipelineRegistry(str(tmp_path))
    registry.bind_enterprise("park")
    now = datetime.now(UTC)
    repo = registry.area_repository()
    repo.start("run", 1, "Park", {"polygon": POLYGON, "zone_name": "Seats"}, now.isoformat())
    client = TestClient(create_app(registry))
    result = client.get("/metrics/open-space/summary", params={"camera_id": 1})
    assert result.status_code == 200
    assert result.json()["median_dwell_ms"] is None
    assert result.json()["coverage_ratio"] == 0
    assert (
        client.get(
            "/metrics/open-space/summary",
            params={
                "camera_id": 1,
                "start": now.isoformat(),
                "end": (now - timedelta(days=1)).isoformat(),
            },
        ).status_code
        == 422
    )
    assert (
        client.get("/metrics/open-space/summary", params={"camera_id": 1, "limit": 501}).status_code
        == 422
    )
    registry.bind_enterprise("other")
    assert (
        client.get("/metrics/open-space/summary", params={"camera_id": 1}).json()["revisions"] == []
    )
    registry.close()


def test_restarting_same_config_reuses_revision_but_geometry_revert_is_new(tmp_path: Path) -> None:
    repo = AreaRepository(LocalDatabase(str(tmp_path), "park"))
    first = {"polygon": POLYGON, "zone_name": "Seats"}
    second = {**first, "zone_name": "Walkway"}
    at = datetime.now(UTC)
    a = repo.start("a", 1, "Park", first, at.isoformat())
    b = repo.start("b", 1, "Park", first, (at + timedelta(seconds=1)).isoformat())
    c = repo.start("c", 1, "Park", second, (at + timedelta(seconds=2)).isoformat())
    d = repo.start("d", 1, "Park", first, (at + timedelta(seconds=3)).isoformat())
    assert a == b and len({a, c, d}) == 3


def test_zone_calibration_preview_does_not_require_detector_assets(tmp_path: Path) -> None:
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    manager.bind_enterprise("park", restore_session=False)
    request = CameraStartRequest(
        stream_url="rtsp://192.168.1.20/stream2",
        camera_id=1,
        analysis_mode="open_space",
        preview_only=True,
    )
    try:
        with (
            patch.object(manager, "_validate_config_stream", return_value=(True, "Reachable")),
            patch.object(manager._tracker, "warmup") as warmup,
            patch("app.camera.camera_manager.threading.Thread.start"),
        ):
            manager.start(request)
            warmup.assert_not_called()
            assert manager.running
            assert manager.area_state() is None
            assert manager.counts()["entry"] is None
    finally:
        manager.close()


def test_stream_interruption_rotates_run_and_never_reuses_person_timer(tmp_path: Path) -> None:
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    manager.bind_enterprise("park", restore_session=False)
    config = configuration()
    manager._config = config
    manager._begin_area(config)
    tracker = manager._area_tracker
    assert tracker is not None
    anchor = tracker.anchor
    old_run = manager._area_run_id
    tracker.update({1: (0.1, 0.5)}, anchor)
    for second in range(1, 5):
        tracker.update({1: (0.5, 0.5)}, anchor + second)
    manager._save_area(anchor + 4, force=True)
    with (
        patch("app.camera.camera_manager.time.monotonic", return_value=anchor + 10),
        patch("app.camera.camera_manager.datetime") as clock,
    ):
        clock.now.return_value = tracker.wall_anchor + timedelta(seconds=10)
        manager._tick_area(anchor + 10)
    assert manager._area_run_id != old_run
    state = manager.area_state()
    assert state is not None and state["active_visits"] == []
    repo = AreaRepository(LocalDatabase(str(tmp_path), "park"))
    result = repo.query(
        1, tracker.wall_anchor - timedelta(seconds=1), tracker.wall_anchor + timedelta(minutes=1)
    )
    assert result["completed_count"] == 0
    assert result["incomplete_count"] == 1
    manager.close()
