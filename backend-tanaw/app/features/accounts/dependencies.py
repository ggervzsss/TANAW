from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import get_db
from app.features.accounts.models import Account, AccountStatus
from app.features.accounts.service import get_account_by_id

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_account(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Account:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required."
        )

    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token."
        ) from exc

    account_id = payload.get("sub")
    if not isinstance(account_id, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject."
        )

    account = await get_account_by_id(db, account_id)
    if account is None or account.status != AccountStatus.ACTIVE or account.activated_at is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is not active."
        )
    if is_token_invalidated(payload, account):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token."
        )

    return account


def is_token_invalidated(payload: dict, account: Account) -> bool:
    if account.token_invalid_before is None:
        return False

    issued_at = payload.get("iat")
    if not isinstance(issued_at, int | float):
        return True

    invalid_before = account.token_invalid_before
    if invalid_before.tzinfo is None:
        invalid_before = invalid_before.replace(tzinfo=UTC)

    return datetime.fromtimestamp(issued_at, UTC) <= invalid_before


def require_roles(allowed_roles: set[str]) -> Callable[[Account], Awaitable[Account]]:
    async def dependency(account: Annotated[Account, Depends(get_current_account)]) -> Account:
        if account.role.value not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient account permissions."
            )
        return account

    return dependency


async def get_current_operational_account(
    account: Annotated[Account, Depends(get_current_account)],
) -> Account:
    return account
