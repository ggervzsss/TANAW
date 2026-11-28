"""Turning two-step verification on and off from General Settings (LGU accounts only)."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.accounts.schemas import AuthUser
from app.features.accounts.service import get_account_by_id, to_auth_user
from app.features.activity_logs.service import (
    get_actor_role_label,
)
from app.features.activity_logs.service import (
    record_activity_log as record_auth_log,
)
from app.features.auth.schemas import (
    TwoFactorConfirmRequest,
    TwoFactorConfirmResponse,
    TwoFactorDisableRequest,
    TwoFactorSetupResponse,
)
from app.features.auth.service import (
    clear_login_failures,
    lockout_seconds_remaining,
    register_failed_login,
)
from app.features.auth.session_router import (
    get_login_lockout_policy,
    raise_login_locked,
    record_account_lockout,
)
from app.features.auth.two_factor import (
    TWO_FACTOR_ROLES,
    TwoFactorError,
    confirm_two_factor_setup,
    disable_two_factor,
    is_two_factor_enabled,
    start_two_factor_setup,
)

router = APIRouter(prefix="/auth/two-factor", tags=["two-step verification"])
TwoFactorAccount = Annotated[
    Account, Depends(require_roles({role.value for role in TWO_FACTOR_ROLES}))
]


async def _locked_account(db: AsyncSession, account: Account) -> Account:
    """The signed-in account, re-read under a row lock so two tabs cannot race a change."""
    locked = await get_account_by_id(db, account.id, for_update=True)
    if locked is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found.")
    return locked


def _bad_request(error: TwoFactorError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))


@router.post("/setup", response_model=TwoFactorSetupResponse)
async def start_setup(
    account: TwoFactorAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TwoFactorSetupResponse:
    """A new key for the authenticator app. Nothing changes at sign-in until it is confirmed."""
    locked = await _locked_account(db, account)
    try:
        setup = start_two_factor_setup(locked)
    except TwoFactorError as exc:
        raise _bad_request(exc) from exc
    return TwoFactorSetupResponse(secret=setup.secret, otpauthUri=setup.otpauth_uri)


@router.post("/confirm", response_model=TwoFactorConfirmResponse)
async def confirm_setup(
    payload: TwoFactorConfirmRequest,
    account: TwoFactorAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TwoFactorConfirmResponse:
    """Turn it on with a code from the app; the recovery codes are returned this once."""
    locked = await _locked_account(db, account)
    try:
        recovery_codes = confirm_two_factor_setup(locked, payload.code, now=datetime.now(UTC))
    except TwoFactorError as exc:
        raise _bad_request(exc) from exc
    await record_auth_log(
        db,
        group="Login & Security",
        severity="Success",
        actor=locked.display_name,
        actor_role=get_actor_role_label(locked),
        action="Two-Step Verification Turned On",
        target=locked.email,
        summary=(
            f"{locked.display_name} turned on two-step verification with an authenticator app."
        ),
        source_id=locked.id,
    )
    return TwoFactorConfirmResponse(recoveryCodes=recovery_codes, user=to_auth_user(locked))


@router.post("/disable", response_model=AuthUser)
async def disable(
    payload: TwoFactorDisableRequest,
    account: TwoFactorAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthUser:
    """Turn it off after the current password is confirmed. A wrong password is a 400, not a
    401, so the web portal does not read it as an expired session."""
    locked = await _locked_account(db, account)
    # Wrong passwords here count toward the same lockout as the sign-in screen, so a borrowed
    # session cannot be used to guess the password.
    policy = await get_login_lockout_policy(db)
    remaining = lockout_seconds_remaining(locked)
    if remaining > 0:
        raise_login_locked(policy, remaining)
    if not verify_password(payload.currentPassword, locked.password_hash):
        remaining = register_failed_login(locked, policy=policy)
        if remaining > 0:
            await record_account_lockout(db, locked, policy)
        await db.commit()
        if remaining > 0:
            raise_login_locked(policy, remaining)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect."
        )
    clear_login_failures(locked)
    if not is_two_factor_enabled(locked):
        return to_auth_user(locked)
    disable_two_factor(locked)
    await record_auth_log(
        db,
        group="Login & Security",
        severity="Warning",
        actor=locked.display_name,
        actor_role=get_actor_role_label(locked),
        action="Two-Step Verification Turned Off",
        target=locked.email,
        summary=f"{locked.display_name} turned off two-step verification.",
        source_id=locked.id,
    )
    return to_auth_user(locked)
