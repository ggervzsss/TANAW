from collections import deque
from dataclasses import dataclass
from datetime import datetime
from threading import Lock
from uuid import uuid4

MAX_DEV_DELIVERIES = 250


@dataclass(frozen=True)
class DevDeliveryEvent:
    id: str
    account_id: str
    recipient: str
    subject: str
    body: str
    status: str
    created_at: datetime


_deliveries: deque[DevDeliveryEvent] = deque(maxlen=MAX_DEV_DELIVERIES)
_lock = Lock()


def record_dev_delivery(
    *,
    account_id: str,
    recipient: str,
    subject: str,
    body: str,
    status: str,
    created_at: datetime,
) -> DevDeliveryEvent:
    delivery = DevDeliveryEvent(
        id=str(uuid4()),
        account_id=account_id,
        recipient=recipient,
        subject=subject,
        body=body,
        status=status,
        created_at=created_at,
    )
    with _lock:
        _deliveries.appendleft(delivery)
    return delivery


def list_dev_deliveries() -> list[DevDeliveryEvent]:
    with _lock:
        return list(_deliveries)


def get_dev_delivery(delivery_id: str) -> DevDeliveryEvent | None:
    with _lock:
        return next((item for item in _deliveries if item.id == delivery_id), None)


def clear_dev_deliveries() -> None:
    with _lock:
        _deliveries.clear()
