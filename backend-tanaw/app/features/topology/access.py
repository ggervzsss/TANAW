"""Fail-closed authorization helpers for effective enterprise topology."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.topology.models import Enterprise, EnterpriseMembership


class EnterpriseTopologyAccessError(Exception):
    """An account cannot resolve to one currently authorized enterprise scope."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class EnterpriseAccessScope:
    """The one membership and enterprise authorized at an evaluation instant."""

    membership: EnterpriseMembership
    enterprise: Enterprise
    evaluated_at: datetime

    @property
    def enterprise_id(self) -> str:
        return self.enterprise.id

    @property
    def classification(self) -> str:
        return self.enterprise.classification


def is_effective_at(
    *,
    started_at: datetime,
    ended_at: datetime | None,
    evaluated_at: datetime,
) -> bool:
    """Return whether ``evaluated_at`` is inside the half-open effective interval."""

    evaluated_at = _as_utc(evaluated_at)
    started_at = _as_utc(started_at)
    ended_at = _as_utc(ended_at) if ended_at is not None else None
    return started_at <= evaluated_at and (ended_at is None or evaluated_at < ended_at)


async def require_effective_enterprise_access(
    db: AsyncSession,
    *,
    account_id: str,
    evaluated_at: datetime,
    lock: bool = False,
) -> EnterpriseAccessScope:
    """Resolve exactly one effective membership backed by one active enterprise.

    Membership validity is evaluated using ``[started_at, ended_at)``. The
    optional row locks keep an accepted write scope stable until its transaction
    commits, so a concurrent membership or enterprise retirement cannot race a
    telemetry command after authorization.
    """

    evaluated_at = _as_utc(evaluated_at)
    membership_statement = (
        select(EnterpriseMembership)
        .where(
            EnterpriseMembership.account_id == account_id,
            EnterpriseMembership.started_at <= evaluated_at,
            or_(
                EnterpriseMembership.ended_at.is_(None),
                EnterpriseMembership.ended_at > evaluated_at,
            ),
        )
        .order_by(EnterpriseMembership.id)
        .limit(2)
    )
    if lock:
        membership_statement = membership_statement.with_for_update(of=EnterpriseMembership)
    memberships = list(await db.scalars(membership_statement))
    if len(memberships) != 1:
        raise EnterpriseTopologyAccessError(
            "ENTERPRISE_MEMBERSHIP_INVALID",
            "The authenticated account must have exactly one enterprise membership "
            "effective at the server evaluation time.",
        )

    membership = memberships[0]
    if not is_effective_at(
        started_at=membership.started_at,
        ended_at=membership.ended_at,
        evaluated_at=evaluated_at,
    ):
        # Defensive revalidation also protects non-SQL test/session adapters.
        raise EnterpriseTopologyAccessError(
            "ENTERPRISE_MEMBERSHIP_INVALID",
            "The authenticated account's enterprise membership is not currently effective.",
        )

    enterprise_statement = select(Enterprise).where(
        Enterprise.id == membership.enterprise_id,
        Enterprise.classification == membership.classification,
        Enterprise.lifecycle_state == "active",
    )
    if lock:
        enterprise_statement = enterprise_statement.with_for_update(of=Enterprise)
    enterprise = await db.scalar(enterprise_statement)
    if enterprise is None:
        raise EnterpriseTopologyAccessError(
            "ENTERPRISE_SCOPE_INVALID",
            "The effective membership must reference a classification-matching active enterprise.",
        )

    return EnterpriseAccessScope(
        membership=membership,
        enterprise=enterprise,
        evaluated_at=evaluated_at,
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Topology evaluation timestamps must include a UTC offset.")
    return value.astimezone(UTC)
