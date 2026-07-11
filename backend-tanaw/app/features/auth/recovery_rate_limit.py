import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import ceil

from sqlalchemy import case, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.features.auth.models import PasswordResetRateLimitBucket


@dataclass(frozen=True)
class PasswordResetRateContext:
    identifier_hash: str
    ip_hash: str


class PasswordResetRateLimitExceeded(ValueError):
    def __init__(
        self,
        *,
        retry_after_seconds: int,
        context: PasswordResetRateContext,
        exceeded_scopes: tuple[str, ...],
        should_record_event: bool,
    ) -> None:
        super().__init__("Too many password recovery requests.")
        self.retry_after_seconds = retry_after_seconds
        self.context = context
        self.exceeded_scopes = exceeded_scopes
        self.should_record_event = should_record_event


def password_reset_rate_context(
    settings: Settings, *, normalized_email: str, client_ip: str
) -> PasswordResetRateContext:
    return PasswordResetRateContext(
        identifier_hash=_fingerprint(settings, "identifier", normalized_email),
        ip_hash=_fingerprint(settings, "ip", client_ip.strip().lower() or "unavailable"),
    )


async def consume_password_reset_rate_limits(
    db: AsyncSession,
    settings: Settings,
    context: PasswordResetRateContext,
    *,
    now: datetime,
) -> None:
    window = timedelta(seconds=settings.password_reset_rate_window_seconds)
    rules = sorted(
        (
            ("global", "password-reset:global", settings.password_reset_global_limit),
            (
                "identifier",
                f"password-reset:identifier:{context.identifier_hash}",
                settings.password_reset_per_identifier_limit,
            ),
            (
                "ip",
                f"password-reset:ip:{context.ip_hash}",
                settings.password_reset_per_ip_limit,
            ),
        ),
        key=lambda rule: rule[1],
    )
    exceeded: list[tuple[str, int, bool]] = []
    for scope, bucket_key, limit in rules:
        request_count, window_started_at, first_blocked = await _increment_bucket(
            db,
            scope=scope,
            bucket_key=bucket_key,
            now=now,
            window=window,
            counter_cap=limit + 1,
            limit=limit,
        )
        if request_count > limit:
            retry_after = max(
                1,
                ceil((window_started_at + window - now).total_seconds()),
            )
            if scope == "global":
                raise PasswordResetRateLimitExceeded(
                    retry_after_seconds=retry_after,
                    context=context,
                    exceeded_scopes=(scope,),
                    should_record_event=first_blocked,
                )
            exceeded.append((scope, retry_after, first_blocked))

    if exceeded:
        raise PasswordResetRateLimitExceeded(
            retry_after_seconds=max(retry_after for _, retry_after, _ in exceeded),
            context=context,
            exceeded_scopes=tuple(scope for scope, _, _ in exceeded),
            should_record_event=any(first_block for _, _, first_block in exceeded),
        )


async def _increment_bucket(
    db: AsyncSession,
    *,
    scope: str,
    bucket_key: str,
    now: datetime,
    window: timedelta,
    counter_cap: int,
    limit: int,
) -> tuple[int, datetime, bool]:
    cutoff = now - window
    expired = PasswordResetRateLimitBucket.window_started_at <= cutoff
    statement = (
        insert(PasswordResetRateLimitBucket)
        .values(
            bucket_key=bucket_key,
            scope=scope,
            window_started_at=now,
            request_count=1,
            blocked_at=None,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[PasswordResetRateLimitBucket.bucket_key],
            set_={
                "scope": scope,
                "window_started_at": case(
                    (expired, now),
                    else_=PasswordResetRateLimitBucket.window_started_at,
                ),
                "request_count": case(
                    (expired, 1),
                    else_=func.least(
                        PasswordResetRateLimitBucket.request_count + 1,
                        counter_cap,
                    ),
                ),
                "blocked_at": case(
                    (expired, None),
                    (PasswordResetRateLimitBucket.request_count == limit, now),
                    else_=PasswordResetRateLimitBucket.blocked_at,
                ),
                "updated_at": now,
            },
        )
        .returning(
            PasswordResetRateLimitBucket.request_count,
            PasswordResetRateLimitBucket.window_started_at,
            PasswordResetRateLimitBucket.blocked_at,
        )
    )
    row = (await db.execute(statement)).one()
    window_started_at = row.window_started_at
    if window_started_at.tzinfo is None:
        window_started_at = window_started_at.replace(tzinfo=UTC)
    else:
        window_started_at = window_started_at.astimezone(UTC)
    blocked_at = row.blocked_at
    if blocked_at is not None:
        if blocked_at.tzinfo is None:
            blocked_at = blocked_at.replace(tzinfo=UTC)
        else:
            blocked_at = blocked_at.astimezone(UTC)
    return int(row.request_count), window_started_at, blocked_at == now


def _fingerprint(settings: Settings, scope: str, value: str) -> str:
    return hmac.new(
        settings.email_secret_key_value.encode(),
        f"password-reset-rate:{scope}:{value}".encode(),
        hashlib.sha256,
    ).hexdigest()
