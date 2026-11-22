"""Replay a clip through the live Open Space pipeline and score its unique-visitor estimate.

The detector output comes from an existing detection cache, so runs are repeatable and
need no detector. Everything after detection is the shipped camera pipeline
(``CameraProcessingManager``): track continuity, appearance sampling, the lost-track linker,
zone visits, and the shared establishment gallery. ReID runs synchronously, with results
delivered one frame later as in a live camera.

Typical use::

    # 1. Write a labelling sheet: one crop per detector track and a JSON template.
    uv run python -m scripts.evaluate_unique_visitors \\
        --cache evaluation/cache/cctv-controlled-occlusion-balanced-5fps.jsonl \\
        --video evaluation/clips/cctv-controlled-occlusion-40s.mp4 \\
        --label-sheet evaluation/ground-truth/cctv-controlled-occlusion

    # 2. Fill each source track's person name in the template, then score it.
    uv run python -m scripts.evaluate_unique_visitors --cache ... --video ... \\
        --labels evaluation/ground-truth/cctv-controlled-occlusion/labels.json

``--legacy`` approximates counting before the occlusion fixes, for comparison.
"""

import argparse
import json
import os
import tempfile
from collections import defaultdict
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from typing import Any
from unittest.mock import patch

import cv2
import numpy as np

from app.camera import camera_manager as camera_module
from app.camera.camera_manager import CameraProcessingManager
from app.camera.models import ProcessingSession
from app.config.camera_config import CameraStartRequest, RegionOfInterest
from app.config.open_space_config import OpenSpaceConfig, ZonePoint
from app.detection.yolo_detector import TrackResult
from app.evaluation.detection_cache import CachedDetectionFrame, load_detection_cache
from app.evaluation.unique_visitors import score_unique_visitors
from app.identity import establishment_registry as establishment_module
from app.identity.unique_visitor_registry import UniqueVisitorRegistry
from app.reid import PersonReIdentifier
from app.reid.async_worker import ReIdResult
from app.storage.repositories.establishment_repository import business_date_for
from app.tracking import LostTrackLinker, ResolvedTrack

WALL_START = datetime(2026, 1, 15, 2, tzinfo=UTC)
MONOTONIC_START = 1_000.0
FULL_FRAME = ((0.02, 0.02), (0.98, 0.02), (0.98, 0.98), (0.02, 0.98))


class SynchronousReIdWorker:
    """Embeds at submission and hands results over at the next poll, like the live worker."""

    def __init__(self, reidentifier: PersonReIdentifier) -> None:
        self._reidentifier = reidentifier
        self._results: list[ReIdResult] = []

    def submit(
        self,
        *,
        session_id: int,
        track_id: int,
        source_track_id: int,
        crop: np.ndarray,
        quality: float,
        requested_at: float,
    ) -> bool:
        result = self._reidentifier.embed_crop(crop)
        self._results.append(
            ReIdResult(
                session_id,
                track_id,
                source_track_id,
                result.embedding if result is not None else None,
                quality,
                requested_at,
                requested_at,
            )
        )
        return True

    def poll(self, session_id: int) -> list[ReIdResult]:
        ready = [result for result in self._results if result.session_id == session_id]
        self._results = [result for result in self._results if result.session_id != session_id]
        return ready

    def begin_session(self, session_id: int) -> None:
        self._results.clear()

    def end_session(self, session_id: int) -> None:
        self._results.clear()

    def close(self) -> None:
        self._results.clear()


@contextmanager
def legacy_counting() -> Iterator[None]:
    """Counting as it behaved before the occlusion fixes, approximately."""
    with ExitStack() as stack:
        stack.enter_context(patch.object(camera_module, "FAST_REID_CONSENSUS_SAMPLES", 2))
        stack.enter_context(patch.object(establishment_module, "PROVISIONAL_DECISION_SECONDS", 0.0))
        stack.enter_context(
            patch.object(establishment_module, "RECONCILIATION_MATCH_THRESHOLD", 0.80)
        )
        stack.enter_context(
            patch.object(establishment_module, "CONSENSUS_RECONCILIATION_MATCH_THRESHOLD", 0.75)
        )
        stack.enter_context(
            patch.object(UniqueVisitorRegistry, "_learn_view", lambda *_args, **_kwargs: None)
        )
        yield


def video_frames(
    video: Path, frames: list[CachedDetectionFrame]
) -> Iterator[tuple[CachedDetectionFrame, np.ndarray]]:
    # The service's low-latency RTSP options (``nobuffer``, ``low_delay``) apply to every
    # capture and break decoding of recorded files partway through, so files open without them.
    options = os.environ.pop("OPENCV_FFMPEG_CAPTURE_OPTIONS", None)
    try:
        capture = cv2.VideoCapture(str(video))
    finally:
        if options is not None:
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = options
    position = 0
    try:
        for cached in frames:
            target = cached.frame_index
            image = None
            while position <= target:
                ok, image = capture.read()
                position += 1
                if not ok:
                    # A partial replay would silently understate every count.
                    raise RuntimeError(f"Could not decode frame {position - 1} of {video}.")
            if image is None:
                raise RuntimeError(f"The detection cache and {video} disagree on frame order.")
            yield cached, cv2.resize(image, (cached.frame_width, cached.frame_height))
    finally:
        capture.release()


def replay(
    cache: Path,
    video: Path,
    *,
    polygon: tuple[tuple[float, float], ...] = FULL_FRAME,
    reid_mode: str = "fast",
    legacy: bool = False,
    collect_crops: bool = False,
) -> dict[str, Any]:
    metadata, cached_frames = load_detection_cache(cache)
    frames = [cached_frames[index] for index in sorted(cached_frames)]
    fps = metadata.source_fps / max(metadata.sample_every, 1)
    track_sources: dict[int, set[int]] = defaultdict(set)
    source_spans: dict[int, list[float]] = {}
    crops: dict[int, tuple[int, np.ndarray]] = {}

    with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
        if legacy:
            stack.enter_context(legacy_counting())
        manager = CameraProcessingManager(directory, camera_id=1)
        manager.bind_enterprise("evaluation", restore_session=False)
        config = CameraStartRequest(
            stream_url="rtsp://192.168.1.20/stream2",
            camera_id=1,
            analysis_mode="open_space",
            reid_mode=reid_mode,  # type: ignore[arg-type]
            roi=RegionOfInterest(top=0.0, left=0.0, width=1.0, height=1.0),
            open_space=OpenSpaceConfig(polygon=[ZonePoint(x=x, y=y) for x, y in polygon]),
        )
        clock_now = [MONOTONIC_START]
        stack.enter_context(
            patch.object(camera_module.time, "monotonic", side_effect=lambda: clock_now[0])
        )
        wall = stack.enter_context(patch.object(camera_module, "datetime"))
        wall.now.side_effect = lambda *_args: (
            WALL_START + timedelta(seconds=clock_now[0] - MONOTONIC_START)
        )
        for worker in (manager._reid_worker, manager._quality_reid_worker):
            worker.close()
        fast_worker = SynchronousReIdWorker(manager._reidentifier)
        quality_worker = SynchronousReIdWorker(manager._quality_reidentifier)
        manager._reid_worker = fast_worker  # type: ignore[assignment]
        manager._quality_reid_worker = quality_worker  # type: ignore[assignment]
        manager._config = config
        manager._configure_reid_locked(config)
        manager._configure_tracking_locked(config, fps)
        if legacy:
            manager._area_linker = LostTrackLinker(match_threshold=2.0)
            for buffer in (manager._appearance_buffer, manager._quality_appearance_buffer):
                buffer.max_occlusion_fraction = 1.0
        session = ProcessingSession(1, config, Event(), "replay")
        manager._active_session = session
        manager._begin_area(config, "replay")

        resolve = manager._counting_track_resolver.resolve

        def recording_resolve(*args: Any, **kwargs: Any) -> list[ResolvedTrack]:
            resolved = resolve(*args, **kwargs)
            for track in resolved:
                track_sources[track.track_id].add(track.source_track_id)
            return resolved

        manager._counting_track_resolver.resolve = recording_resolve  # type: ignore[method-assign]
        current: list[CachedDetectionFrame] = []

        def cached_tracks(frame: np.ndarray, confidence: float) -> list[TrackResult]:
            return list(current[0].tracks)

        manager._tracker.track_people = cached_tracks  # type: ignore[method-assign]
        last_sweep = MONOTONIC_START
        try:
            for cached, image in video_frames(video, frames):
                clock_now[0] = MONOTONIC_START + cached.timestamp
                current[:] = [cached]
                for track in cached.tracks:
                    if track.track_id <= 0:
                        continue
                    span = source_spans.setdefault(track.track_id, [cached.timestamp] * 2)
                    span[1] = cached.timestamp
                    x1, y1, x2, y2 = track.bbox
                    best = crops.get(track.track_id)
                    if collect_crops and (best is None or y2 - y1 > best[0]):
                        crop = image[max(0, y1) : y2, max(0, x1) : x2]
                        if crop.size:
                            crops[track.track_id] = (y2 - y1, crop.copy())
                manager._detect_and_count(
                    session,
                    image,
                    config.tracking_confidence,
                    config.counting_confidence,
                    observed_at=clock_now[0],
                )
                if clock_now[0] - last_sweep >= camera_module.PENDING_IDENTITY_SWEEP_SECONDS:
                    manager._finalize_pending_identities()
                    last_sweep = clock_now[0]
            manager._finish_area("evaluation_end")
            clock_now[0] += establishment_module.PROVISIONAL_DECISION_SECONDS + 1
            manager._finalize_pending_identities()
            registry = manager._establishment_registry
            assert registry is not None
            business_date = business_date_for(WALL_START)
            with registry.database.connection() as db:
                rows = db.execute(
                    "select track_key,visitor_id,identity_confidence,qualified "
                    "from establishment_observations order by last_at"
                ).fetchall()
            predicted_unique = registry.repository.camera_unique_count(1, business_date)
        finally:
            manager.close()

    track_visitors: dict[str, str | None] = {}
    for row in rows:
        if not row["qualified"]:
            continue
        key = row["track_key"].rsplit(":", 1)[-1]
        confirmed = row["identity_confidence"] == "high"
        track_visitors.setdefault(key, None)
        if row["visitor_id"] is not None and confirmed:
            track_visitors[key] = row["visitor_id"]
    return {
        "cache": str(cache),
        "video": str(video),
        "legacy": legacy,
        "reid_mode": reid_mode,
        "processing_fps": round(fps, 2),
        "frames": len(frames),
        "detector_source_tracks": len(source_spans),
        "physical_tracks": len(track_sources),
        "qualified_zone_tracks": len(track_visitors),
        "unidentified_zone_tracks": sum(visitor is None for visitor in track_visitors.values()),
        "predicted_unique": predicted_unique,
        "track_visitors": track_visitors,
        "track_sources": {str(key): sorted(value) for key, value in track_sources.items()},
        "source_spans": {str(key): value for key, value in source_spans.items()},
        "_crops": crops,
    }


def write_label_sheet(result: dict[str, Any], output: Path) -> None:
    """A contact sheet of one crop per detector track, and a template to fill in."""
    output.mkdir(parents=True, exist_ok=True)
    crops: dict[int, tuple[int, np.ndarray]] = result["_crops"]
    tiles = []
    for source in sorted(crops):
        tile = cv2.resize(crops[source][1], (96, 192))
        start, end = result["source_spans"][str(source)]
        cv2.rectangle(tile, (0, 0), (96, 30), (0, 0, 0), -1)
        cv2.putText(tile, f"#{source}", (4, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1)
        cv2.putText(
            tile,
            f"{start:.1f}-{end:.1f}s",
            (4, 26),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.36,
            (200, 200, 200),
            1,
        )
        tiles.append(tile)
    columns = 10
    while len(tiles) % columns:
        tiles.append(np.zeros((192, 96, 3), dtype=np.uint8))
    rows = [np.hstack(tiles[index : index + columns]) for index in range(0, len(tiles), columns)]
    if rows:
        cv2.imwrite(str(output / "label-sheet.jpg"), np.vstack(rows))
    template = {
        "clip": result["video"],
        "cache": result["cache"],
        "instructions": (
            "Give every detector track (#ID in label-sheet.jpg) the name of the real person it "
            "shows, using the same name for the same person. Use null for a track that is not "
            "a person or shows several people."
        ),
        "source_people": {str(source): None for source in sorted(crops)},
        "source_spans": result["source_spans"],
    }
    (output / "labels.template.json").write_text(json.dumps(template, indent=2) + "\n")


def score(result: dict[str, Any], labels: Path) -> dict[str, Any]:
    raw = json.loads(labels.read_text())["source_people"]
    source_people = {int(source): person for source, person in raw.items()}
    track_sources = {key: set(value) for key, value in result["track_sources"].items()}
    return score_unique_visitors(
        result["track_visitors"], track_sources, source_people, result["predicted_unique"]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--reid-mode", choices=["fast", "quality"], default="fast")
    parser.add_argument("--legacy", action="store_true")
    parser.add_argument("--labels", type=Path)
    parser.add_argument("--label-sheet", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    result = replay(
        args.cache,
        args.video,
        reid_mode=args.reid_mode,
        legacy=args.legacy,
        collect_crops=args.label_sheet is not None,
    )
    if args.label_sheet is not None:
        write_label_sheet(result, args.label_sheet)
    result.pop("_crops")
    if args.labels is not None:
        result["score"] = score(result, args.labels)
    if args.output is not None:
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    summary = {key: value for key, value in result.items() if not isinstance(value, dict)}
    if "score" in result:
        summary["score"] = result["score"]
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
