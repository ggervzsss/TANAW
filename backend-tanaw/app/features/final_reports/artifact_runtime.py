"""Application lifecycle for deterministic final-report artifact generation."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from app.core.config import Settings, get_settings
from app.db.session import AsyncSessionLocal
from app.features.final_reports.artifact_service import FinalReportArtifactProcessor
from app.features.final_reports.artifact_storage import ArtifactStorage, LocalArtifactStorage

logger = logging.getLogger("uvicorn.error")
_storage: ArtifactStorage | None = None
_processor: FinalReportArtifactProcessor | None = None
_worker_task: asyncio.Task[None] | None = None
_stop_event: asyncio.Event | None = None


@asynccontextmanager
async def final_report_artifact_lifespan(_: object) -> AsyncIterator[None]:
    settings = get_settings()
    await start_final_report_artifact_worker(settings)
    try:
        yield
    finally:
        await stop_final_report_artifact_worker()


async def start_final_report_artifact_worker(settings: Settings) -> None:
    global _processor, _storage, _stop_event, _worker_task
    await stop_final_report_artifact_worker()
    storage = LocalArtifactStorage(
        settings.final_report_artifact_storage_root,
        max_bytes=settings.final_report_artifact_max_bytes,
    )
    processor = FinalReportArtifactProcessor(
        sessions=AsyncSessionLocal,
        storage=storage,
        settings=settings,
    )
    stop_event = asyncio.Event()
    _storage = storage
    _processor = processor
    _stop_event = stop_event
    _worker_task = asyncio.create_task(
        _worker_loop(processor, settings=settings, stop_event=stop_event),
        name="tanaw-final-report-artifacts",
    )


async def stop_final_report_artifact_worker() -> None:
    global _processor, _storage, _stop_event, _worker_task
    task = _worker_task
    stop_event = _stop_event
    _worker_task = None
    _stop_event = None
    _processor = None
    _storage = None
    if stop_event is not None:
        stop_event.set()
    if task is not None:
        await task


def get_final_report_artifact_storage() -> ArtifactStorage:
    if _storage is None:
        raise RuntimeError("Final-report artifact storage is not initialized.")
    return _storage


def final_report_artifact_worker_ready() -> bool:
    return _worker_task is not None and not _worker_task.done() and _storage is not None


async def _worker_loop(
    processor: FinalReportArtifactProcessor,
    *,
    settings: Settings,
    stop_event: asyncio.Event,
) -> None:
    while not stop_event.is_set():
        try:
            await processor.run_batch()
        except Exception:
            logger.exception("Final-report artifact worker batch failed.")
        try:
            await asyncio.wait_for(
                stop_event.wait(),
                timeout=settings.final_report_artifact_poll_interval_seconds,
            )
        except TimeoutError:
            pass
