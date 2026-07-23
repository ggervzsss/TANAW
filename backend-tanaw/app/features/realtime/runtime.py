from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

import asyncpg  # type: ignore[import-untyped]
from sqlalchemy import select, text

from app.core.config import Settings
from app.db.session import AsyncSessionLocal
from app.features.realtime.contracts import RealtimeActor, RealtimeEnvelope, RealtimeScope
from app.features.realtime.manager import realtime_manager
from app.features.realtime.models import RealtimeOutbox

POSTGRES_REALTIME_CHANNEL = "tanaw_application_realtime_v1"
logger = logging.getLogger("uvicorn.error")


class RealtimeRuntime:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._stop_event: asyncio.Event | None = None
        self._worker_task: asyncio.Task[None] | None = None
        self._subscriber_task: asyncio.Task[None] | None = None
        self._subscriber_connection: asyncpg.Connection | None = None
        self._notification_queue: asyncio.Queue[str] = asyncio.Queue(maxsize=2048)
        self._listener_ready = asyncio.Event()

    @property
    def ready(self) -> bool:
        if not self._settings.realtime_enabled:
            return True
        connection = self._subscriber_connection
        return bool(
            self._worker_task is not None
            and not self._worker_task.done()
            and self._subscriber_task is not None
            and not self._subscriber_task.done()
            and connection is not None
            and not connection.is_closed()
        )

    @property
    def broker_ready(self) -> bool:
        connection = self._subscriber_connection
        return bool(connection is not None and not connection.is_closed())

    async def start(self) -> None:
        await self.stop()
        if not self._settings.realtime_enabled:
            return
        stop_event = asyncio.Event()
        self._stop_event = stop_event
        self._subscriber_task = asyncio.create_task(
            self._subscriber_loop(stop_event),
            name="tanaw-realtime-subscriber",
        )
        await asyncio.wait_for(self._listener_ready.wait(), timeout=10)
        self._worker_task = asyncio.create_task(
            self._outbox_loop(stop_event),
            name="tanaw-realtime-outbox",
        )

    async def stop(self) -> None:
        stop_event = self._stop_event
        worker_task = self._worker_task
        subscriber_task = self._subscriber_task
        self._stop_event = None
        self._worker_task = None
        self._subscriber_task = None
        self._listener_ready.clear()
        if stop_event is not None:
            stop_event.set()
        tasks = [task for task in (worker_task, subscriber_task) if task is not None]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        await self._disconnect_subscriber()
        await realtime_manager.close_all()

    async def _outbox_loop(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            try:
                processed = await self.dispatch_batch()
            except Exception:
                logger.exception("Realtime outbox batch failed.")
                processed = 0
            timeout = 0.05 if processed else self._settings.realtime_outbox_poll_seconds
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=timeout)
            except TimeoutError:
                pass

    async def dispatch_batch(self) -> int:
        async with AsyncSessionLocal() as db:
            rows = list(
                (
                    await db.scalars(
                        select(RealtimeOutbox)
                        .where(RealtimeOutbox.published_at.is_(None))
                        .order_by(RealtimeOutbox.sequence.asc())
                        .limit(self._settings.realtime_outbox_batch_size)
                        .with_for_update(skip_locked=True)
                    )
                ).all()
            )
            if not rows:
                return 0
            published_at = datetime.now(UTC)
            for row in rows:
                await db.execute(
                    text("SELECT pg_notify(:channel, :payload)"),
                    {"channel": POSTGRES_REALTIME_CHANNEL, "payload": row.event_id},
                )
                row.published_at = published_at
                row.attempt_count += 1
                row.last_error = None
            await db.commit()
            return len(rows)

    async def _subscriber_loop(self, stop_event: asyncio.Event) -> None:
        first_connection = True
        while not stop_event.is_set():
            try:
                await self._connect_subscriber()
                self._listener_ready.set()
                if not first_connection:
                    await realtime_manager.require_resynchronization()
                first_connection = False
                await self._consume_notifications(stop_event)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Realtime PostgreSQL subscriber unavailable; reconnecting.")
            finally:
                await self._disconnect_subscriber()
            try:
                await asyncio.wait_for(
                    stop_event.wait(),
                    timeout=self._settings.realtime_broker_reconnect_seconds,
                )
            except TimeoutError:
                pass

    async def _connect_subscriber(self) -> None:
        connection = await asyncpg.connect(_asyncpg_dsn(self._settings.database_url), timeout=5)
        await connection.add_listener(POSTGRES_REALTIME_CHANNEL, self._on_notification)
        self._subscriber_connection = connection

    async def _disconnect_subscriber(self) -> None:
        connection = self._subscriber_connection
        self._subscriber_connection = None
        if connection is None or connection.is_closed():
            return
        try:
            await connection.remove_listener(POSTGRES_REALTIME_CHANNEL, self._on_notification)
        finally:
            await connection.close()

    def _on_notification(
        self,
        _: asyncpg.Connection,
        _process_id: int,
        channel: str,
        payload: str,
    ) -> None:
        if channel != POSTGRES_REALTIME_CHANNEL:
            return
        try:
            self._notification_queue.put_nowait(payload)
        except asyncio.QueueFull:
            logger.error("Realtime subscriber queue overflow; requesting client resynchronization.")
            asyncio.create_task(realtime_manager.require_resynchronization())

    async def _consume_notifications(self, stop_event: asyncio.Event) -> None:
        connection = self._subscriber_connection
        while not stop_event.is_set() and connection is not None and not connection.is_closed():
            try:
                event_id = await asyncio.wait_for(self._notification_queue.get(), timeout=1)
            except TimeoutError:
                continue
            await self._dispatch_event(event_id)

    async def _dispatch_event(self, event_id: str) -> None:
        async with AsyncSessionLocal() as db:
            row = await db.scalar(select(RealtimeOutbox).where(RealtimeOutbox.event_id == event_id))
        if row is None:
            logger.warning("Realtime event missing event_id=%s", event_id)
            return
        try:
            envelope = RealtimeEnvelope.model_validate(
                {
                    "schema_version": row.schema_version,
                    "event_id": row.event_id,
                    "event_type": row.event_type,
                    "occurred_at": row.occurred_at,
                    "sequence": row.sequence,
                    "scope": RealtimeScope.model_validate(row.scope),
                    "actor": RealtimeActor.model_validate(row.actor) if row.actor else None,
                    "payload": row.payload,
                }
            )
        except ValueError:
            logger.exception("Invalid realtime outbox event event_id=%s", event_id)
            return
        await realtime_manager.dispatch(envelope, row.audience_roles)


def _asyncpg_dsn(database_url: str) -> str:
    normalized = database_url.strip()
    if normalized.startswith("postgresql+asyncpg://"):
        return normalized.replace("postgresql+asyncpg://", "postgresql://", 1)
    if normalized.startswith("postgres://"):
        return f"postgresql://{normalized.removeprefix('postgres://')}"
    if normalized.startswith("postgresql://"):
        return normalized
    raise ValueError("Realtime requires a PostgreSQL database URL.")


_runtime: RealtimeRuntime | None = None


async def start_realtime_runtime(settings: Settings) -> None:
    global _runtime
    await stop_realtime_runtime()
    runtime = RealtimeRuntime(settings)
    await runtime.start()
    _runtime = runtime


async def stop_realtime_runtime() -> None:
    global _runtime
    runtime = _runtime
    _runtime = None
    if runtime is not None:
        await runtime.stop()


def realtime_runtime_ready() -> bool:
    return bool(_runtime is not None and _runtime.ready)


def realtime_runtime_health() -> dict[str, object]:
    return {
        "status": "ready" if realtime_runtime_ready() else "not_ready",
        "active_connections": realtime_manager.active_count,
        "connections_by_role": realtime_manager.connections_by_role(),
        "broker": "ready" if _runtime is not None and _runtime.broker_ready else "not_ready",
    }
