import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import get_settings
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.accounts.schemas import (
    DeliverySummary,
)
from app.features.accounts.service import (
    to_delivery_summary,
)
from app.features.mail.dev_log import get_dev_delivery as find_dev_delivery
from app.features.mail.dev_log import list_dev_deliveries as list_ephemeral_dev_deliveries

logger = logging.getLogger(__name__)

ITAccount = Annotated[Account, Depends(require_roles({"it"}))]
EnterpriseReadAccount = Annotated[Account, Depends(require_roles({"it", "admin"}))]

router = APIRouter(prefix="/dev", tags=["dev"])
dev_router = router


@dev_router.get("/deliveries", response_model=list[DeliverySummary])
async def get_dev_deliveries(
    _: ITAccount,
) -> list[DeliverySummary]:
    ensure_dev_log_available()
    deliveries = list_ephemeral_dev_deliveries()
    return [to_delivery_summary(delivery) for delivery in deliveries]


@dev_router.get("/deliveries/{delivery_id}", response_model=DeliverySummary)
async def get_dev_delivery(
    delivery_id: str,
    _: ITAccount,
) -> DeliverySummary:
    ensure_dev_log_available()
    delivery = find_dev_delivery(delivery_id)
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found.")
    return to_delivery_summary(delivery)


def ensure_dev_log_available() -> None:
    if get_settings().is_production:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
