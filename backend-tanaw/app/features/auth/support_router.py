import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.models import AccountRole
from app.features.accounts.service import get_account_by_email
from app.features.activity_logs.service import get_actor_role_label, record_activity_log
from app.features.auth.schemas import StatusResponse, SupportRequest
from app.features.notifications.service import create_role_notifications
from app.features.requests.schemas import SignInHelpCreate
from app.features.requests.service import create_sign_in_help_request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["support"])


@router.post("/support-request", response_model=StatusResponse)
async def create_support_request(
    payload: SupportRequest, db: Annotated[AsyncSession, Depends(get_db)]
) -> StatusResponse:
    """The sign-in page's Contact support form: a Sign-in help request for IT."""
    email = str(payload.email).strip().lower()
    matched = await get_account_by_email(db, email)
    request = await create_sign_in_help_request(
        db,
        SignInHelpCreate(name=payload.name, email=email, message=payload.message),
        matched_account=matched
        if matched is not None and matched.role == AccountRole.ENTERPRISE
        else None,
    )
    place = request.enterprise_name or request.requester_name
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.IT],
        title=f"{request.requester_name} needs help signing in.",
        message=f"{email}: {request.description}",
        notification_type="Request",
        severity="Info",
        actor=None,
        source_type="request",
        source_id=request.id,
        replace_existing_for_source=True,
    )
    await record_activity_log(
        db,
        group="Requests",
        severity="Info",
        actor=request.requester_name,
        actor_role=get_actor_role_label(matched) if matched is not None else "System",
        action="Send Request",
        target=request.request_code,
        summary=f"{place} asked for help signing in.",
        source_id=request.id,
        it_detail=f"{request.request_code} · Sign-in help · Reply to {email}",
        metadata={"requestCode": request.request_code, "requestGroup": request.request_group},
    )
    return StatusResponse(status="ok")
