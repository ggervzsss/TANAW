from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.core.password_policy import normalize_password

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(normalize_password(password))


def verify_password(password: str, hashed_password: str) -> bool:
    normalized = normalize_password(password)
    if password_hash.verify(normalized, hashed_password):
        return True
    return normalized != password and password_hash.verify(password, hashed_password)


def create_access_token(subject: str, claims: dict[str, Any] | None = None) -> str:
    settings = get_settings()
    issued_at = datetime.now(UTC)
    expires_at = issued_at + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": issued_at.timestamp(),
        "exp": expires_at,
    }
    if claims:
        payload.update(claims)

    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
