from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.admin_requests.schemas import (
    AdminRequestMessageCreate,
    AdminRequestMessageResult,
)
from app.features.admin_requests.service import (
    find_request_source,
    send_admin_request_message,
)

router = APIRouter(prefix="/operational", tags=["admin requests"])

AdminAccount = Annotated[Account, Depends(require_roles({"admin"}))]


@router.post(
    "/requests/messages",
    response_model=AdminRequestMessageResult,
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_request_message(
    payload: AdminRequestMessageCreate,
    account: AdminAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AdminRequestMessageResult:
    """Send IT a message about an alert, support ticket or profile change request."""
    source = await find_request_source(db, account, payload.sourceType, payload.sourceId)
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found.")
    return await send_admin_request_message(db, account, source, payload.message)
