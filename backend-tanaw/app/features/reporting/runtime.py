"""Automatic canonical reporting-period lifecycle runtime."""

from __future__ import annotations

import asyncio
import logging

from app.core.config import Settings
from app.db.session import AsyncSessionLocal
from app.features.reporting.periods import run_reporting_period_lifecycle

logger = logging.getLogger("uvicorn.error")
_worker_task: asyncio.Task[None] | None = None
_worker_stop_event: asyncio.Event | None = None


async def start_reporting_period_lifecycle_worker(settings: Settings) -> None:
    global _worker_stop_event, _worker_task
    await stop_reporting_period_lifecycle_worker()
    _worker_stop_event = asyncio.Event()
    _worker_task = asyncio.create_task(
        _worker_loop(settings, _worker_stop_event),
        name="tanaw-reporting-period-lifecycle",
    )


async def stop_reporting_period_lifecycle_worker() -> None:
    global _worker_stop_event, _worker_task
    stop_event = _worker_stop_event
    task = _worker_task
    _worker_stop_event = None
    _worker_task = None
    if stop_event is not None:
        stop_event.set()
    if task is not None:
        await task


def reporting_period_lifecycle_worker_ready() -> bool:
    return _worker_task is not None and not _worker_task.done()


async def run_reporting_period_lifecycle_now() -> None:
    async with AsyncSessionLocal() as session:
        try:
            result = await run_reporting_period_lifecycle(session, account=None)
            await session.commit()
        except Exception:
            await session.rollback()
            logger.exception("Reporting-period lifecycle reconciliation failed.")
            raise
    logger.info(
        "Reporting-period lifecycle reconciled ensured=%d created=%d transitioned=%d frozen=%d",
        result.ensuredPeriodCount,
        result.createdCount,
        result.transitionedCount,
        result.frozenCount,
    )


async def _worker_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await run_reporting_period_lifecycle_now()
        except Exception:
            pass
        try:
            await asyncio.wait_for(
                stop_event.wait(),
                timeout=settings.reporting_period_lifecycle_interval_seconds,
            )
        except TimeoutError:
            pass
