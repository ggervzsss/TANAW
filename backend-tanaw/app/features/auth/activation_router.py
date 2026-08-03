import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.activity_logs.service import (
    get_actor_role_label,
)
from app.features.activity_logs.service import (
    record_activity_log as record_auth_log,
)
from app.features.auth.account_activation import (
    AccountActivationError,
    complete_account_activation,
    validate_account_activation,
)
from app.features.auth.email_change import (
    AccountEmailChangeError,
    verify_account_email_change,
)
from app.features.auth.policies import (
    get_auth_log_category,
)
from app.features.auth.schemas import (
    AccountActivationCompleteRequest,
    AccountActivationCompleteResponse,
    AccountActivationValidateRequest,
    AccountActivationValidateResponse,
    AccountEmailChangeVerifyRequest,
    AccountEmailChangeVerifyResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["account activation"])


@router.post(
    "/account-activation/validate",
    response_model=AccountActivationValidateResponse,
)
async def validate_activation_link(
    payload: AccountActivationValidateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountActivationValidateResponse:
    try:
        activation = await validate_account_activation(db, payload.token)
    except AccountActivationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return AccountActivationValidateResponse(
        displayName=activation.display_name,
        role=activation.role,
        expiresAt=activation.expires_at,
    )


@router.post(
    "/account-activation/complete",
    response_model=AccountActivationCompleteResponse,
)
async def complete_activation(
    payload: AccountActivationCompleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountActivationCompleteResponse:
    try:
        account = await complete_account_activation(
            db,
            payload.token,
            payload.newPassword,
            commit=False,
        )
    except AccountActivationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await record_auth_log(
        db,
        category=get_auth_log_category(account),
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Account Activated",
        target=account.email,
        summary=f"{account.display_name} activated their TANAW account.",
        source_id=account.id,
    )
    return AccountActivationCompleteResponse(status="ok", role=account.role.value)


@router.post(
    "/email-change/verify",
    response_model=AccountEmailChangeVerifyResponse,
)
async def verify_email_change_link(
    payload: AccountEmailChangeVerifyRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountEmailChangeVerifyResponse:
    try:
        verification = await verify_account_email_change(db, payload.token, commit=False)
    except AccountEmailChangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email verification link is invalid or expired.",
        ) from exc

    await record_auth_log(
        db,
        category="System",
        severity="Success",
        actor=verification.display_name,
        actor_role="Account Email Owner",
        action="Verify Proposed Account Email",
        target=verification.requested_email,
        summary=f"{verification.display_name} verified ownership of a proposed email address.",
        source_id=verification.account_id,
    )
    return AccountEmailChangeVerifyResponse(
        displayName=verification.display_name,
        requestedEmail=verification.requested_email,
        status="verified",
    )
