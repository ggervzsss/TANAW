from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.dashboard.service import get_operational_summary
from app.features.monitoring.schemas import OperationalSummary

router = APIRouter(prefix="/operational", tags=["dashboard"])

OperationalReadAccount = Annotated[
    Account, Depends(require_roles({"admin", "it", "staff", "enterprise"}))
]


@router.get("/telemetry/summary", response_model=OperationalSummary)
async def get_summary(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperationalSummary:
    return await get_operational_summary(db, account)
