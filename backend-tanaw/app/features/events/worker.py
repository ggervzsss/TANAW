"""Lifecycle wrapper for the durable domain-event delivery engine."""

import asyncio
import logging

from app.features.events.delivery import DeliveryBatchResult, DomainEventDeliveryEngine

logger = logging.getLogger("uvicorn.error")


class DomainEventDeliveryWorker:
    """Runs an explicitly configured delivery engine without process-global handlers."""

    def __init__(
        self,
        engine: DomainEventDeliveryEngine,
        *,
        poll_interval_seconds: float = 1.0,
    ) -> None:
        if not 0.05 <= poll_interval_seconds <= 60:
            raise ValueError("Domain-event poll interval must be between 0.05 and 60 seconds.")
        self._engine = engine
        self._poll_interval_seconds = poll_interval_seconds
        self._task: asyncio.Task[None] | None = None
        self._stop_event: asyncio.Event | None = None

    @property
    def ready(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        await self.stop()
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(
            self._run(self._stop_event),
            name=f"tanaw-domain-events-{self._engine.worker_id}",
        )

    async def stop(self) -> None:
        task = self._task
        stop_event = self._stop_event
        self._task = None
        self._stop_event = None
        if stop_event is not None:
            stop_event.set()
        if task is not None:
            await task

    async def run_once(self) -> DeliveryBatchResult:
        return await self._engine.run_batch()

    async def _run(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            processed = 0
            try:
                result = await self.run_once()
                processed = result.claimed
            except Exception:
                logger.exception("Domain-event delivery worker batch failed.")
            if processed > 0:
                continue
            try:
                await asyncio.wait_for(
                    stop_event.wait(),
                    timeout=self._poll_interval_seconds,
                )
            except TimeoutError:
                pass
