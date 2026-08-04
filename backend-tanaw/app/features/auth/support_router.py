import hashlib
import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.models import AccountRole
from app.features.auth.schemas import (
    StatusResponse,
    SupportRequest,
)
from app.features.monitoring.alerts import create_operational_alert
from app.features.notifications.service import (
    create_role_notifications,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["support"])


@router.post("/support-request", response_model=StatusResponse)
async def create_support_request(
    payload: SupportRequest, db: Annotated[AsyncSession, Depends(get_db)]
) -> StatusResponse:
    requester_name = payload.name.strip()
    requester_email = str(payload.email).strip().lower()
    alert = await create_operational_alert(
        db,
        alert_type="Maintenance Request",
        severity="Warning",
        requester=f"{requester_name} <{requester_email}>",
        summary=payload.message.strip(),
        required_action=f"Review the login support request and contact {requester_email}.",
        resolution_mode="Remote Review",
        owner="IT",
        enterprise=None,
        source_id=f"login-support:{hashlib.sha256(requester_email.encode()).hexdigest()}",
    )
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.IT],
        title=f"Login support requested by {requester_name}.",
        message=f"{requester_email}: {payload.message.strip()}",
        notification_type="Login Support Request",
        severity="Warning",
        actor=None,
        source_type="operational.alert",
        source_id=alert.id,
        replace_existing_for_source=True,
    )
    return StatusResponse(status="ok")
