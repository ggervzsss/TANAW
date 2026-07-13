"""Durable transactional domain-event persistence and delivery."""

from app.features.events.contracts import (
    BrokerDestinationHandler,
    DeliveryResult,
    DomainEventDeliveryError,
    DomainEventDestinationHandler,
    DomainEventEnvelope,
    EventBrokerPublisher,
    ProjectionDestinationHandler,
    TransactionalProjection,
)
from app.features.events.delivery import (
    ClaimBatch,
    DeliveryBatchResult,
    DeliveryClaim,
    DeliveryEngineConfig,
    DeliveryQueueMetrics,
    DispatchOutcome,
    DomainEventDeliveryEngine,
    read_delivery_queue_metrics,
)
from app.features.events.models import (
    DomainEvent,
    DomainEventConsumerReceipt,
    DomainEventDelivery,
    DomainEventDeliveryAttempt,
)

__all__ = [
    "DomainEvent",
    "DomainEventDeliveryEngine",
    "DomainEventDeliveryError",
    "DomainEventDestinationHandler",
    "DomainEventEnvelope",
    "DomainEventConsumerReceipt",
    "DomainEventDelivery",
    "DomainEventDeliveryAttempt",
    "BrokerDestinationHandler",
    "ClaimBatch",
    "DeliveryBatchResult",
    "DeliveryClaim",
    "DeliveryEngineConfig",
    "DeliveryQueueMetrics",
    "DeliveryResult",
    "DispatchOutcome",
    "EventBrokerPublisher",
    "ProjectionDestinationHandler",
    "TransactionalProjection",
    "read_delivery_queue_metrics",
]
