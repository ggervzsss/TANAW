"""Application lifecycle for concrete durable domain-event consumers."""

from __future__ import annotations

import os
import socket
from datetime import timedelta
from uuid import uuid4

from app.core.config import Settings
from app.db.session import AsyncSessionLocal
from app.features.events.contracts import (
    DomainEventDestinationHandler,
    ProjectionDestinationHandler,
)
from app.features.events.delivery import DeliveryEngineConfig, DomainEventDeliveryEngine
from app.features.events.notification_projection import ReportingNotificationProjection
from app.features.events.realtime import (
    OperationalRealtimeSubscriber,
    PostgresOperationalRealtimePublisher,
    RealtimeBroadcastHandler,
)
from app.features.events.worker import DomainEventDeliveryWorker

_worker: DomainEventDeliveryWorker | None = None
_realtime_subscriber: OperationalRealtimeSubscriber | None = None


def create_domain_event_delivery_worker(settings: Settings) -> DomainEventDeliveryWorker:
    publisher = PostgresOperationalRealtimePublisher()
    handlers: tuple[DomainEventDestinationHandler, ...] = (
        ProjectionDestinationHandler(
            destination="notification_projection",
            projection=ReportingNotificationProjection(),
        ),
        RealtimeBroadcastHandler(publisher),
    )
    engine = DomainEventDeliveryEngine(
        sessions=AsyncSessionLocal,
        handlers=handlers,
        worker_id=(f"{socket.gethostname()}:{os.getpid()}:{str(uuid4())[:8]}")[:120],
        config=DeliveryEngineConfig(
            batch_size=settings.domain_event_batch_size,
            lease_duration=timedelta(seconds=settings.domain_event_lease_seconds),
            max_attempts=settings.domain_event_max_attempts,
        ),
    )
    return DomainEventDeliveryWorker(
        engine,
        poll_interval_seconds=settings.domain_event_poll_interval_seconds,
    )


def create_domain_event_realtime_subscriber(settings: Settings) -> OperationalRealtimeSubscriber:
    return OperationalRealtimeSubscriber(settings.database_url)


async def start_domain_event_delivery_worker(settings: Settings) -> None:
    global _realtime_subscriber, _worker
    await stop_domain_event_delivery_worker()
    realtime_subscriber = create_domain_event_realtime_subscriber(settings)
    worker = create_domain_event_delivery_worker(settings)
    try:
        await realtime_subscriber.start()
        await worker.start()
    except Exception:
        await worker.stop()
        await realtime_subscriber.stop()
        raise
    _realtime_subscriber = realtime_subscriber
    _worker = worker


async def stop_domain_event_delivery_worker() -> None:
    global _realtime_subscriber, _worker
    worker = _worker
    realtime_subscriber = _realtime_subscriber
    _worker = None
    _realtime_subscriber = None
    try:
        if worker is not None:
            await worker.stop()
    finally:
        if realtime_subscriber is not None:
            await realtime_subscriber.stop()


def domain_event_delivery_worker_ready() -> bool:
    return bool(
        _worker is not None
        and _worker.ready
        and _realtime_subscriber is not None
        and _realtime_subscriber.ready
    )
