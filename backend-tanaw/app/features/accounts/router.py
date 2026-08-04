"""Account-management router composition."""

from fastapi import APIRouter

from app.features.accounts.api_helpers import ensure_account_can_deactivate
from app.features.accounts.dev_router import ensure_dev_log_available
from app.features.accounts.dev_router import router as dev_router
from app.features.accounts.enterprise_router import router as enterprise_router
from app.features.accounts.lgu_router import router as lgu_router
from app.features.accounts.lgu_router import update_lgu_account
from app.features.accounts.requests_router import router as requests_router
from app.features.accounts.requests_router import update_account_status

router = APIRouter()
router.include_router(lgu_router)
router.include_router(enterprise_router)
router.include_router(requests_router)

__all__ = [
    "dev_router",
    "ensure_account_can_deactivate",
    "ensure_dev_log_available",
    "router",
    "update_account_status",
    "update_lgu_account",
]
