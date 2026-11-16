"""A doorway crossing carries the track's male/female evidence into the daily counts."""

from datetime import datetime
from pathlib import Path
from threading import Event

import numpy as np

from app.attributes import SexEstimator, write_sex_head
from app.camera.camera_manager import CameraProcessingManager
from app.camera.models import ProcessingSession
from app.config.camera_config import CameraStartRequest
from app.counting.geometry import Centroid
from app.identity.establishment_registry import EstablishmentRegistry
from app.storage.repositories.establishment_repository import day_bounds
from app.tracking import ResolvedTrack

VECTOR = np.array([1, 0, 0], dtype=np.float32)


def estimator(
    tmp_path: Path, manager: CameraProcessingManager, fast: float, quality: float
) -> SexEstimator:
    """Heads that score VECTOR as female (positive) or male (negative) per embedding space."""
    heads = [
        write_sex_head(
            tmp_path / f"{name}.npz",
            embedding_space=space,
            weights=np.array([sign * 4.0, 0.0, 0.0]),
            bias=0.0,
            temperature=1.0,
        )
        for name, space, sign in (
            ("fast", manager._reidentifier.embedding_space, fast),
            ("quality", manager._quality_reidentifier.embedding_space, quality),
        )
    ]
    return SexEstimator(heads)


def test_evidence_prefers_the_quality_embedding_space(tmp_path: Path) -> None:
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    try:
        manager._sex_estimator = estimator(tmp_path, manager, fast=1, quality=-1)
        manager._appearance_buffer.record_sample(1, VECTOR, 0.9, 1)
        fast_only = manager._sex_evidence(1)
        assert fast_only is not None and fast_only.logit_sum > 0
        manager._quality_appearance_buffer.record_sample(1, VECTOR, 0.8, 2)
        preferred = manager._sex_evidence(1)
        assert preferred is not None and preferred.logit_sum < 0
        assert manager._sex_evidence(99) is not None
        assert manager.model_status()["sex_estimation_available"] is True
    finally:
        manager.close()


def test_without_heads_no_evidence_is_attached(tmp_path: Path) -> None:
    manager = CameraProcessingManager(str(tmp_path), camera_id=1)
    try:
        manager._sex_estimator = SexEstimator()
        manager._appearance_buffer.record_sample(1, VECTOR, 0.9, 1)
        assert manager._sex_evidence(1) is None
        assert manager.model_status()["sex_estimation_available"] is False
    finally:
        manager.close()


def test_doorway_entry_is_counted_as_female_from_its_evidence(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    door = CameraProcessingManager(str(tmp_path), camera_id=1)
    try:
        door.bind_enterprise("park", restore_session=False)
        door.use_establishment_registry(service)
        door._sex_estimator = estimator(tmp_path, door, fast=1, quality=1)
        for frame in (1, 2):
            door._appearance_buffer.record_sample(1, VECTOR, 0.9, frame)
        config = CameraStartRequest(camera_id=1, stream_url="rtsp://192.168.1.10/stream2")
        door._config = config
        session = ProcessingSession(1, config, Event(), "door-run")
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
        with service.database.connection() as db:
            record = db.execute(
                "select business_date,sex_weight,sex_model from establishment_observations"
            ).fetchone()
        assert record["sex_weight"] > 0 and record["sex_model"].startswith("sex-head@")
        begin, end = (
            datetime.fromisoformat(value) for value in day_bounds(record["business_date"])
        )
        result = service.repository.summary(begin, end)
        assert (result["unique_count"], result["female_count"], result["male_count"]) == (1, 1, 0)
        assert result["entries"] == 1
    finally:
        door.close()
