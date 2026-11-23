"""Live occupancy is the shared Entry / Exit balance plus every Open Space zone."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from app.camera.pipeline_manager import CameraPipelineRegistry
from app.identity.establishment_registry import EstablishmentRegistry

NOW = datetime(2026, 11, 10, 2, tzinfo=UTC)
Setup = dict[str, list[dict[str, Any]]]


def door_state(camera_id: int, *, running: bool = True) -> dict[str, Any]:
    return {
        "camera_id": camera_id,
        "counts": {"running": running, "status": "running" if running else "stopped"},
        "health": {"processed_frame_stale_ms": 100 if running else None, "reid_model_ready": True},
        "area": None,
    }


def zone_state(camera_id: int, presence: int, *, running: bool = True) -> dict[str, Any]:
    return {
        "camera_id": camera_id,
        "counts": {"running": running, "status": "running" if running else "stopped"},
        "health": {"reid_model_ready": True},
        "area": {"available": running, "presence": presence, "observed_at": NOW.isoformat()},
    }


@pytest.fixture
def registry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[CameraPipelineRegistry, Setup]]:
    pipelines = CameraPipelineRegistry(str(tmp_path))
    pipelines.bind_enterprise("park")
    setup: Setup = {"profiles": [], "states": []}
    monkeypatch.setattr(pipelines, "list_camera_profiles", lambda: setup["profiles"])
    monkeypatch.setattr(
        pipelines,
        "camera_states",
        lambda: {"cameras": setup["states"], "enterprise_occupancy": 0},
    )
    yield pipelines, setup
    pipelines.close()


def cameras(setup: Setup, *items: tuple[int, str, dict[str, Any]]) -> None:
    setup["profiles"] = [
        {"id": camera_id, "name": f"Camera {camera_id}", "analysisMode": mode}
        for camera_id, mode, _ in items
    ]
    setup["states"] = [state for _, _, state in items]


def enter(service: EstablishmentRegistry, count: int) -> None:
    for index in range(count):
        service.observe(
            observation_id=f"entry:{index}",
            camera_id=1,
            track_key=f"entry:{index}",
            analysis_mode="entrance_exit",
            kind="entry",
            qualified=True,
            first_at=NOW,
            observed_at=NOW,
        )


def test_live_occupancy_adds_the_door_balance_and_zone_presence(registry):
    pipelines, setup = registry
    enter(pipelines._establishment_registry, 4)
    cameras(setup, (1, "entrance_exit", door_state(1)), (2, "open_space", zone_state(2, 3)))

    live = pipelines.establishment_live(NOW + timedelta(seconds=1))

    assert live["occupancy"] == 7
    assert live["state"] == "estimated"
    assert live["missing_camera_ids"] == []
    assert [item["basis"] for item in live["contributions"]] == [
        "entry_exit_balance",
        "observed_presence",
    ]


def test_offline_camera_is_left_out_and_reported(registry):
    pipelines, setup = registry
    enter(pipelines._establishment_registry, 4)
    cameras(
        setup,
        (1, "entrance_exit", door_state(1)),
        (2, "open_space", zone_state(2, 3, running=False)),
    )

    live = pipelines.establishment_live(NOW + timedelta(seconds=1))

    assert live["occupancy"] == 4
    assert live["state"] == "partial"
    assert live["missing_camera_ids"] == [2]


def test_no_running_camera_has_no_live_occupancy(registry):
    pipelines, setup = registry
    cameras(setup, (1, "entrance_exit", door_state(1, running=False)))

    live = pipelines.establishment_live(NOW)

    assert live["occupancy"] is None
    assert live["state"] == "unavailable"


def test_cameras_without_any_counting_setup_still_count(registry):
    pipelines, setup = registry
    enter(pipelines._establishment_registry, 2)
    setup["profiles"] = [{"id": 1, "name": "Front", "analysisMode": "entrance_exit"}]
    setup["states"] = [door_state(1)]

    assert pipelines.establishment_live(NOW + timedelta(seconds=1))["occupancy"] == 2


def test_fresh_video_with_stalled_analysis_does_not_count_as_available(registry):
    pipelines, setup = registry
    enter(pipelines._establishment_registry, 2)
    stalled = door_state(1)
    stalled["health"] = {"raw_frame_stale_ms": 50, "processed_frame_stale_ms": 60_000}
    cameras(setup, (1, "entrance_exit", stalled))

    live = pipelines.establishment_live(NOW + timedelta(seconds=1))

    assert live["missing_camera_ids"] == [1]
    assert live["occupancy"] is None
    assert live["state"] == "unavailable"
