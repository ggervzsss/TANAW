"""Target-only account ownership projection for normalized enterprise topology."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.alerts.models import SiteSyncAlertState
from app.features.telemetry.models import SiteLiveState
from app.features.telemetry.sync_health import evaluate_sync_health
from app.features.topology.models import (
    EdgeDevice,
    Enterprise,
    EnterpriseMembership,
    EnterpriseSite,
)


class AccountTopologyInvariantError(RuntimeError):
    """Normalized ownership cannot be resolved without guessing."""


@dataclass(frozen=True, slots=True)
class AccountTopology:
    """The effective normalized topology owned by one enterprise principal."""

    account: Account
    membership: EnterpriseMembership
    enterprise: Enterprise
    site: EnterpriseSite
    active_devices: tuple[EdgeDevice, ...]
    live_state: SiteLiveState | None
    evaluated_at: datetime
    sync_alert_state: SiteSyncAlertState | None = None

    @property
    def official_code(self) -> str:
        return self.enterprise.official_code

    @property
    def gateway_status(self) -> str:
        if not self.active_devices:
            return "Not Linked"
        if len(self.active_devices) != 1 or self.live_state is None:
            return "Offline"

        state = self.live_state
        if state.edge_device_id != self.active_devices[0].id:
            return "Offline"
        evaluated_at = _as_utc(self.evaluated_at)
        if evaluated_at >= _as_utc(state.offline_after_at) or state.service_state == "unavailable":
            return "Offline"
        sync_health = evaluate_sync_health(
            evaluated_at=evaluated_at,
            pending_count=state.pending_count,
            oldest_pending_at=state.oldest_pending_at,
            alert_is_active=(
                self.sync_alert_state is not None and self.sync_alert_state.status == "active"
            ),
        )
        if (
            evaluated_at >= _as_utc(state.freshness_expires_at)
            or state.service_state == "degraded"
            or sync_health.state in {"delayed", "recovering"}
        ):
            return "Sync Delayed"
        return "Connected"


async def load_account_topology(
    db: AsyncSession,
    account: Account,
    *,
    evaluated_at: datetime | None = None,
    lock: bool = False,
) -> AccountTopology | None:
    """Load one account's topology and reject every incomplete or extra mapping."""

    return (await load_account_topologies(db, [account], evaluated_at=evaluated_at, lock=lock))[
        account.id
    ]


async def require_account_topology(
    db: AsyncSession,
    account: Account,
    *,
    evaluated_at: datetime | None = None,
    lock: bool = False,
) -> AccountTopology:
    topology = await load_account_topology(
        db,
        account,
        evaluated_at=evaluated_at,
        lock=lock,
    )
    if topology is None:
        raise AccountTopologyInvariantError(
            f"Enterprise account {account.id} has no effective normalized topology."
        )
    return topology


async def enterprise_official_code_for_account(
    db: AsyncSession,
    account: Account,
) -> str | None:
    """Return the target business login code, or none for an LGU principal."""

    if account.role != AccountRole.ENTERPRISE:
        return None
    return (await require_account_topology(db, account)).official_code


async def load_account_topologies(
    db: AsyncSession,
    accounts: Sequence[Account],
    *,
    evaluated_at: datetime | None = None,
    lock: bool = False,
) -> dict[str, AccountTopology | None]:
    """Batch-load authoritative normalized account ownership."""

    if not accounts:
        return {}
    evaluated_at = _as_utc(evaluated_at or datetime.now(UTC))
    account_by_id = {account.id: account for account in accounts}
    if len(account_by_id) != len(accounts):
        raise AccountTopologyInvariantError("Duplicate account identity in topology projection.")

    membership_statement = select(EnterpriseMembership).where(
        EnterpriseMembership.account_id.in_(account_by_id)
    )
    memberships = list(
        await db.scalars(_with_lock(membership_statement, EnterpriseMembership, lock))
    )
    memberships_by_account: dict[str, list[EnterpriseMembership]] = defaultdict(list)
    for membership in memberships:
        memberships_by_account[membership.account_id].append(membership)

    effective_memberships: dict[str, EnterpriseMembership] = {}
    for account in accounts:
        account_memberships = memberships_by_account.get(account.id, [])
        if account.role != AccountRole.ENTERPRISE:
            if account_memberships:
                raise AccountTopologyInvariantError(
                    f"Non-enterprise account {account.id} owns enterprise topology."
                )
            continue
        if account.is_protected_system_account:
            raise AccountTopologyInvariantError(
                f"Protected account {account.id} cannot own enterprise topology."
            )
        effective = [
            membership
            for membership in account_memberships
            if _effective_at(
                membership.started_at,
                membership.ended_at,
                evaluated_at,
            )
        ]
        if len(effective) != 1:
            raise AccountTopologyInvariantError(
                f"Enterprise account {account.id} must have exactly one effective membership."
            )
        effective_memberships[account.id] = effective[0]

    enterprise_ids = {membership.enterprise_id for membership in effective_memberships.values()}
    enterprise_statement = select(Enterprise).where(Enterprise.id.in_(enterprise_ids))
    enterprises = list(await db.scalars(_with_lock(enterprise_statement, Enterprise, lock)))
    enterprise_by_id = {enterprise.id: enterprise for enterprise in enterprises}

    site_statement = select(EnterpriseSite).where(
        EnterpriseSite.enterprise_id.in_(enterprise_ids),
        EnterpriseSite.site_code == "primary",
    )
    sites = list(await db.scalars(_with_lock(site_statement, EnterpriseSite, lock)))
    sites_by_enterprise: dict[str, list[EnterpriseSite]] = defaultdict(list)
    for site in sites:
        if _effective_at(site.effective_from, site.effective_to, evaluated_at):
            sites_by_enterprise[site.enterprise_id].append(site)

    current_site_by_account: dict[str, EnterpriseSite] = {}
    for account_id, membership in effective_memberships.items():
        account = account_by_id[account_id]
        enterprise = enterprise_by_id.get(membership.enterprise_id)
        if enterprise is None or enterprise.classification != membership.classification:
            raise AccountTopologyInvariantError(
                f"Enterprise account {account_id} has an invalid enterprise membership scope."
            )
        expected_lifecycle = "active" if account.status == AccountStatus.ACTIVE else "inactive"
        if enterprise.lifecycle_state != expected_lifecycle:
            raise AccountTopologyInvariantError(
                f"Enterprise account {account_id} lifecycle disagrees with its enterprise."
            )
        current_sites = sites_by_enterprise.get(enterprise.id, [])
        if len(current_sites) != 1:
            raise AccountTopologyInvariantError(
                f"Enterprise {enterprise.id} must have exactly one effective primary site."
            )
        site = current_sites[0]
        if site.classification != enterprise.classification:
            raise AccountTopologyInvariantError(
                f"Enterprise {enterprise.id} has a classification-mismatched primary site."
            )
        current_site_by_account[account_id] = site

    site_ids = {site.id for site in current_site_by_account.values()}
    device_statement = select(EdgeDevice).where(
        EdgeDevice.site_id.in_(site_ids), EdgeDevice.lifecycle_state == "active"
    )
    devices = list(await db.scalars(_with_lock(device_statement, EdgeDevice, lock)))
    devices_by_site: dict[str, list[EdgeDevice]] = defaultdict(list)
    for device in devices:
        devices_by_site[device.site_id].append(device)

    live_states = list(
        await db.scalars(select(SiteLiveState).where(SiteLiveState.site_id.in_(site_ids)))
    )
    live_state_by_site = {state.site_id: state for state in live_states}
    sync_alert_states = list(
        await db.scalars(
            _with_lock(
                select(SiteSyncAlertState).where(SiteSyncAlertState.site_id.in_(site_ids)),
                SiteSyncAlertState,
                lock,
            )
        )
    )
    sync_alert_state_by_site = {state.site_id: state for state in sync_alert_states}

    resolved: dict[str, AccountTopology | None] = {}
    for account in accounts:
        effective_membership = effective_memberships.get(account.id)
        if effective_membership is None:
            resolved[account.id] = None
            continue
        enterprise = enterprise_by_id[effective_membership.enterprise_id]
        site = current_site_by_account[account.id]
        active_devices = tuple(sorted(devices_by_site.get(site.id, []), key=lambda item: item.id))
        if any(device.classification != enterprise.classification for device in active_devices):
            raise AccountTopologyInvariantError(
                f"Enterprise {enterprise.id} has a classification-mismatched active device."
            )
        resolved[account.id] = AccountTopology(
            account=account,
            membership=effective_membership,
            enterprise=enterprise,
            site=site,
            active_devices=active_devices,
            live_state=live_state_by_site.get(site.id),
            evaluated_at=evaluated_at,
            sync_alert_state=sync_alert_state_by_site.get(site.id),
        )
    return resolved


async def get_account_by_official_code(
    db: AsyncSession,
    official_code: str,
    *,
    for_update: bool = False,
) -> Account | None:
    """Resolve a login principal from the unique target enterprise code."""

    now = datetime.now(UTC)
    statement = (
        select(Account)
        .join(EnterpriseMembership, EnterpriseMembership.account_id == Account.id)
        .join(
            Enterprise,
            (Enterprise.id == EnterpriseMembership.enterprise_id)
            & (Enterprise.classification == EnterpriseMembership.classification),
        )
        .where(
            Account.role == AccountRole.ENTERPRISE,
            func.lower(Enterprise.official_code) == official_code.strip().lower(),
            Enterprise.lifecycle_state == "active",
            EnterpriseMembership.started_at <= now,
            or_(
                EnterpriseMembership.ended_at.is_(None),
                EnterpriseMembership.ended_at > now,
            ),
        )
        .limit(2)
    )
    if for_update:
        statement = statement.with_for_update(of=Account).execution_options(populate_existing=True)
    accounts = list(await db.scalars(statement))
    if len(accounts) > 1:
        raise AccountTopologyInvariantError(
            f"Enterprise code {official_code!r} resolves to multiple principals."
        )
    return accounts[0] if accounts else None


async def get_enterprise_account_by_identifier(
    db: AsyncSession,
    identifier: str,
) -> Account | None:
    """Resolve an enterprise principal by target official code or account UUID."""

    normalized = identifier.strip().lower()
    statement = (
        select(Account)
        .join(EnterpriseMembership, EnterpriseMembership.account_id == Account.id)
        .join(Enterprise, Enterprise.id == EnterpriseMembership.enterprise_id)
        .where(
            Account.role == AccountRole.ENTERPRISE,
            or_(
                func.lower(Account.id) == normalized,
                func.lower(Enterprise.official_code) == normalized,
            ),
        )
        .limit(2)
    )
    accounts = list(await db.scalars(statement))
    if len(accounts) > 1:
        raise AccountTopologyInvariantError(f"Enterprise identifier {identifier!r} is ambiguous.")
    return accounts[0] if accounts else None


def invalidate_site_coordinates(site: EnterpriseSite) -> None:
    """Invalidate coordinate evidence after the address meaning changes."""

    site.latitude = None
    site.longitude = None
    site.location_source = None
    site.location_confidence = None
    site.geocoded_address = None
    site.coordinates_updated_at = None
    site.location_version += 1


def _with_lock[ModelT](
    statement: Select[tuple[ModelT]], model: type[ModelT], lock: bool
) -> Select[tuple[ModelT]]:
    return statement.with_for_update(of=model) if lock else statement


def _effective_at(start: datetime, end: datetime | None, evaluated_at: datetime) -> bool:
    start = _as_utc(start)
    end = _as_utc(end) if end is not None else None
    return start <= evaluated_at and (end is None or evaluated_at < end)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
