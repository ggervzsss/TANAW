from datetime import datetime
from pathlib import Path
from threading import Event

import numpy as np

from app.camera.camera_manager import CameraProcessingManager
from app.camera.models import ProcessingSession
from app.config.camera_config import CameraStartRequest
from app.config.camera_coverage import CameraCoverage
from app.config.open_space_config import OpenSpaceConfig, ZonePoint
from app.counting.geometry import Centroid
from app.identity.establishment_registry import EstablishmentRegistry
from app.storage.repositories.establishment_repository import day_bounds
from app.tracking import ResolvedTrack


def test_doorway_and_area_camera_paths_link_to_one_establishment_visitor(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    door = CameraProcessingManager(str(tmp_path), camera_id=1)
    area = CameraProcessingManager(str(tmp_path), camera_id=2)
    vector = np.array([1, 0, 0], dtype=np.float32)
    try:
        for manager in (door, area):
            manager.bind_enterprise("park", restore_session=False)
            manager.use_establishment_registry(service)
            for frame in (1, 2):
                manager._appearance_buffer.record_sample(1, vector, 0.9, frame)
        door_config = CameraStartRequest(
            camera_id=1,
            stream_url="rtsp://192.168.1.10/stream2",
            coverage=CameraCoverage(role="external_boundary", relationship="independent"),
        )
        door._config = door_config
        session = ProcessingSession(1, door_config, Event(), "door-run")
        door._active_session = session
        track = ResolvedTrack(
            1,
            1,
            (10, 10, 80, 180),
            0.9,
            Centroid(40, 90),
            Centroid(40, 90),
            "tracked",
            1.0,
            "motion",
        )
        door._persist_count_event(session, track, "entry", event_id="crossing")

        config = CameraStartRequest(
            camera_id=2,
            stream_url="rtsp://192.168.1.11/stream2",
            analysis_mode="open_space",
            coverage=CameraCoverage(
                role="internal_observation", relationship="contained", related_camera_id=1
            ),
            open_space=OpenSpaceConfig(
                polygon=[
                    ZonePoint(x=0.2, y=0.2),
                    ZonePoint(x=0.8, y=0.2),
                    ZonePoint(x=0.8, y=0.8),
                    ZonePoint(x=0.2, y=0.8),
                ]
            ),
        )
        area._config = config
        area._begin_area(config)
        tracker = area._area_tracker
        assert tracker is not None
        for frame in (1, 2):
            area._appearance_buffer.record_sample(1, vector, 0.9, frame)
        for second in range(4):
            tracker.update({1: (0.5, 0.5)}, tracker.anchor + second)
        area._save_area(tracker.anchor + 3, force=True)
        # Query by the actual observation's local business date.
        with service.database.connection() as db:
            records = db.execute(
                "select business_date,visitor_id from establishment_observations"
            ).fetchall()
        assert len(records) == 2
        assert len({record["visitor_id"] for record in records}) == 1
        begin, end = (
            datetime.fromisoformat(value) for value in day_bounds(records[0]["business_date"])
        )
        result = service.repository.summary(begin, end)
        assert result["unique_count"] == 1
        assert result["entries"] == 1
        assert result["exits"] == 0
    finally:
        door.close()
        area.close()
