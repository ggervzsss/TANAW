import logging
from datetime import UTC, datetime
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import (
    bearer_scheme,
    get_account_from_access_token,
    get_current_account,
)
from app.features.accounts.models import Account, AccountStatus, SystemConfiguration
from app.features.accounts.schemas import (
    AuthUser,
)
from app.features.accounts.service import (
    get_account_by_id,
    get_account_by_login_identifier,
    invalidate_account_tokens,
    to_auth_user,
)
from app.features.activity_logs.service import (
    get_actor_role_label,
)
from app.features.activity_logs.service import (
    record_activity_log as record_auth_log,
)
from app.features.auth.http_session import (
    AUTH_SESSION_COOKIE,
    clear_auth_session_cookie,
    create_session_token,
    set_auth_session_cookie,
    token_remember_preference,
    token_signed_in_at,
)
from app.features.auth.policies import (
    is_login_scope_allowed,
)
from app.features.auth.schemas import (
    CurrentSessionResponse,
    LoginRequest,
    LoginResponse,
    TwoFactorChallengeResponse,
    TwoFactorLoginRequest,
)
from app.features.auth.service import (
    LoginLockoutPolicy,
    authenticate_loaded_account,
    clear_login_failures,
    lockout_seconds_remaining,
    login_lockout_message,
    register_failed_login,
    resolve_login_lockout_policy,
)
from app.features.auth.system_settings import load_system_settings_values
from app.features.auth.two_factor import (
    TWO_FACTOR_CHALLENGE_SECONDS,
    consume_recovery_code,
    create_two_factor_challenge,
    is_challenge_still_valid,
    is_two_factor_enabled,
    read_two_factor_challenge,
    recovery_code_hashes,
    verify_two_factor_code,
)

logger = logging.getLogger(__name__)

SYSTEM_SETTINGS_ID = "default"
TWO_FACTOR_CHALLENGE_EXPIRED = "two_factor_challenge_expired"
TWO_FACTOR_CODE_INVALID = "two_factor_code_invalid"
router = APIRouter(prefix="/auth", tags=["authentication"])


async def record_account_lockout(
    db: AsyncSession,
    account: Account,
    policy: LoginLockoutPolicy,
    *,
    cause: str = "wrong passwords",
) -> None:
    """A lockout is a heads-up in Activity, not an alert: it ends by itself after the lock time."""
    await record_auth_log(
        db,
        group="Login & Security",
        severity="Warning",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Account Locked",
        target=account.email,
        summary=(
            f"{account.display_name}'s account was locked for {policy.lock_minutes} minutes "
            f"after too many {cause}."
        ),
        source_id=account.id,
        it_detail=(
            f"{policy.attempt_limit} failed sign-ins in a row. "
            f"Locked for {policy.lock_minutes} minutes."
        ),
        metadata={
            "attemptLimit": policy.attempt_limit,
            "lockMinutes": policy.lock_minutes,
        },
    )


async def get_login_lockout_policy(db: AsyncSession) -> LoginLockoutPolicy:
    record = await db.scalar(
        select(SystemConfiguration).where(SystemConfiguration.id == SYSTEM_SETTINGS_ID)
    )
    return resolve_login_lockout_policy(load_system_settings_values(record))


def raise_login_locked(policy: LoginLockoutPolicy, remaining: int) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "message": login_lockout_message(policy),
            "retryAfterSeconds": remaining,
        },
        headers={"Retry-After": str(remaining)},
    )


async def _complete_sign_in(
    db: AsyncSession,
    response: Response,
    account: Account,
    *,
    remember: bool,
    summary: str,
) -> LoginResponse:
    clear_login_failures(account)
    now = datetime.now(UTC)
    account.previous_login_at = account.last_login_at
    account.last_login_at = now
    token = create_session_token(account, remember=remember, signed_in_at=now)
    await record_auth_log(
        db,
        group="Login & Security",
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Login",
        target=account.email,
        summary=summary,
        source_id=account.id,
    )
    set_auth_session_cookie(response, token, remember=remember)
    return LoginResponse(token=token, user=to_auth_user(account))


@router.post("/login", response_model=LoginResponse | TwoFactorChallengeResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse | TwoFactorChallengeResponse:
    candidate = await get_account_by_login_identifier(db, payload.username, for_update=True)
    lockout_candidate = (
        candidate
        if candidate is not None
        and candidate.status == AccountStatus.ACTIVE
        and candidate.activated_at is not None
        and is_login_scope_allowed(candidate, payload.loginScope)
        else None
    )
    lockout_policy = (
        await get_login_lockout_policy(db)
        if lockout_candidate is not None
        else LoginLockoutPolicy()
    )
    if lockout_candidate is not None:
        remaining = lockout_seconds_remaining(lockout_candidate)
        if remaining > 0:
            raise_login_locked(lockout_policy, remaining)

    account = authenticate_loaded_account(candidate, payload.password)
    if (
        account is None
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is None
        or not is_login_scope_allowed(account, payload.loginScope)
    ):
        if lockout_candidate is not None:
            remaining = register_failed_login(lockout_candidate, policy=lockout_policy)
            if remaining > 0:
                await record_account_lockout(db, lockout_candidate, lockout_policy)
            await db.commit()
            if remaining > 0:
                raise_login_locked(lockout_policy, remaining)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password."
        )

    if is_two_factor_enabled(account):
        # The password alone is not enough. Failed attempts are kept until the code step
        # passes, so a right password cannot reset the count between wrong codes.
        return TwoFactorChallengeResponse(
            challengeToken=create_two_factor_challenge(
                account, remember=payload.rememberMe, now=datetime.now(UTC)
            ),
            expiresInSeconds=TWO_FACTOR_CHALLENGE_SECONDS,
        )

    return await _complete_sign_in(
        db,
        response,
        account,
        remember=payload.rememberMe,
        summary=f"{account.display_name} signed in to TANAW.",
    )


def _two_factor_rejection(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": code, "message": message},
    )


@router.post("/login/two-factor", response_model=LoginResponse)
async def login_two_factor(
    payload: TwoFactorLoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    """The second sign-in step: a code from the authenticator app, or a one-time recovery code."""
    expired = _two_factor_rejection(
        TWO_FACTOR_CHALLENGE_EXPIRED, "This sign-in has expired. Sign in again."
    )
    challenge = read_two_factor_challenge(payload.challengeToken)
    if challenge is None:
        raise expired
    account = await get_account_by_id(db, challenge.account_id, for_update=True)
    if (
        account is None
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is None
        or not is_challenge_still_valid(challenge, account)
    ):
        raise expired

    lockout_policy = await get_login_lockout_policy(db)
    remaining = lockout_seconds_remaining(account)
    if remaining > 0:
        raise_login_locked(lockout_policy, remaining)

    now = datetime.now(UTC)
    used_recovery_code = payload.recoveryCode is not None
    accepted = (
        consume_recovery_code(account, payload.recoveryCode)
        if payload.recoveryCode is not None
        else verify_two_factor_code(account, payload.code or "", now=now)
    )
    if not accepted:
        remaining = register_failed_login(account, policy=lockout_policy)
        if remaining > 0:
            await record_account_lockout(db, account, lockout_policy, cause="wrong sign-in codes")
        await db.commit()
        if remaining > 0:
            raise_login_locked(lockout_policy, remaining)
        raise _two_factor_rejection(
            TWO_FACTOR_CODE_INVALID,
            "That recovery code is not valid or was already used."
            if used_recovery_code
            else "That code did not work. Enter the newest code from your authenticator app.",
        )

    if used_recovery_code:
        codes_left = len(recovery_code_hashes(account))
        await record_auth_log(
            db,
            group="Login & Security",
            severity="Warning",
            actor=account.display_name,
            actor_role=get_actor_role_label(account),
            action="Recovery Code Used",
            target=account.email,
            summary=(
                f"{account.display_name} signed in with a recovery code instead of the "
                "authenticator app."
            ),
            source_id=account.id,
            it_detail=f"{codes_left} recovery codes left.",
            metadata={"recoveryCodesLeft": codes_left},
        )
    return await _complete_sign_in(
        db,
        response,
        account,
        remember=challenge.remember,
        summary=f"{account.display_name} signed in to TANAW with two-step verification.",
    )


@router.post("/session", response_model=LoginResponse)
async def restore_session(
    request: Request,
    response: Response,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    token = (
        credentials.credentials
        if credentials is not None
        else request.cookies.get(AUTH_SESSION_COOKIE)
    )
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    try:
        account = await get_account_from_access_token(token, db)
    except HTTPException:
        clear_auth_session_cookie(response)
        raise
    remember = token_remember_preference(token)
    refreshed_token = create_session_token(
        account, remember=remember, signed_in_at=token_signed_in_at(token)
    )
    set_auth_session_cookie(response, refreshed_token, remember=remember)
    return LoginResponse(token=refreshed_token, user=to_auth_user(account))


@router.get("/me", response_model=AuthUser)
async def me(account: Annotated[Account, Depends(get_current_account)]) -> AuthUser:
    return to_auth_user(account)


@router.get("/sessions/current", response_model=CurrentSessionResponse)
async def current_session(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    account: Annotated[Account, Depends(get_current_account)],
) -> CurrentSessionResponse:
    """When this device signed in. Sessions from before the sign-in time was kept fall back to
    the account's latest sign-in."""
    signed_in_at = token_signed_in_at(credentials.credentials) if credentials else None
    return CurrentSessionResponse(signedInAt=signed_in_at or account.last_login_at)


@router.post("/sessions/revoke-others", response_model=LoginResponse)
async def revoke_other_sessions(
    response: Response,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    """Sign out every other device: all earlier tokens stop working, and this device gets a
    fresh one so it stays signed in."""
    token = credentials.credentials if credentials is not None else ""
    remember = token_remember_preference(token)
    signed_in_at = token_signed_in_at(token)
    await invalidate_account_tokens(db, account)
    await record_auth_log(
        db,
        group="Login & Security",
        severity="Success",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Other Devices Signed Out",
        target=account.email,
        summary=f"{account.display_name} signed out of TANAW on every other device.",
        source_id=account.id,
    )
    fresh_token = create_session_token(account, remember=remember, signed_in_at=signed_in_at)
    set_auth_session_cookie(response, fresh_token, remember=remember)
    return LoginResponse(token=fresh_token, user=to_auth_user(account))


@router.post("/logout")
async def logout(
    response: Response,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    await record_auth_log(
        db,
        group="Login & Security",
        severity="Info",
        actor=account.display_name,
        actor_role=get_actor_role_label(account),
        action="Logout",
        target=account.email,
        summary=f"{account.display_name} signed out of TANAW.",
        source_id=account.id,
    )
    await invalidate_account_tokens(db, account)
    clear_auth_session_cookie(response)
    return {"status": "ok"}
