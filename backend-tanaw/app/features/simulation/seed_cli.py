import argparse
import asyncio
import json
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.db.migrations import validate_database_migration_head
from app.db.session import AsyncSessionLocal, engine
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import generate_enterprise_id
from app.features.reporting.contracts import monthly_reporting_period
from app.features.simulation.models import SimulationRun, SimulationRunAccount
from app.features.topology.account_scope import (
    AccountTopology,
    require_account_topology,
)
from app.features.topology.models import (
    EdgeDevice,
    Enterprise,
    EnterpriseMembership,
    EnterpriseSite,
    SiteLocationVersion,
)

TEST_ACCOUNT_PASSWORD = "Visitor simulation access phrase 2026"
DEFAULT_SCENARIO = "full-workflow"
DEFAULT_SEED = "tanaw-testing-v2"
REPORTING_STAFF_NAME = "Carla Mendoza"


@dataclass(frozen=True)
class SimulationEnterprise:
    name: str
    category: str
    manager: str
    barangay: str
    address: str
    latitude: float
    longitude: float
    email: str
    phone: str


ENTERPRISES = (
    SimulationEnterprise(
        "Balon ni Lolo Uweng",
        "tourism",
        "Ma Regine Javier",
        "Landayan",
        "Barangay Landayan, San Pedro, Laguna 4023",
        14.352361,
        121.067985,
        "balon.lolo.uweng@tanaw.test",
        "+639171110001",
    ),
    SimulationEnterprise(
        "San Pedro Apostol Parish",
        "tourism",
        "Irish May Arabaca",
        "Nueva",
        "Barangay Nueva, San Pedro, Laguna 4023",
        14.363881,
        121.056564,
        "sanpedro.apostol@tanaw.test",
        "+639171110002",
    ),
    SimulationEnterprise(
        "Lolo Uweng Pilgrim Church",
        "tourism",
        "David Kristian Vallejera",
        "Landayan",
        "Barangay Landayan, San Pedro, Laguna 4023",
        14.350951,
        121.066450,
        "lolo.uweng.church@tanaw.test",
        "+639171110003",
    ),
    SimulationEnterprise(
        "Tricia's Bar & Lounge",
        "business",
        "Kenneth Delicano",
        "Nueva",
        "Barangay Nueva, San Pedro, Laguna 4023",
        14.348207,
        121.064359,
        "tricias.bar@tanaw.test",
        "+639171110004",
    ),
    SimulationEnterprise(
        "Hallow Ridge Filipinas Golf Inc.",
        "tourism",
        "Sebastien Bercasio",
        "San Antonio",
        "Barangay San Antonio, San Pedro, Laguna 4023",
        14.357021,
        121.028243,
        "hallowridge.golf@tanaw.test",
        "+639171110005",
    ),
)


LGU_ACCOUNTS = (
    (
        "it.operations@tanaw.test",
        AccountRole.IT,
        "Coco Martin",
        "IT Personnel",
        "Coco",
        "Martin",
    ),
    (
        "system.admin@tanaw.test",
        AccountRole.ADMIN,
        "Marissa Delgado",
        "Admin",
        "Marissa",
        "Delgado",
    ),
    (
        "reports.staff@tanaw.test",
        AccountRole.STAFF,
        REPORTING_STAFF_NAME,
        "LGU Staff",
        "Carla",
        "Mendoza",
    ),
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage TANAW simulation data.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    on_parser = subparsers.add_parser("on", help="Generate simulation data.")
    on_parser.add_argument("--range", default="6m", choices=["30d", "6m", "12m"])
    on_parser.add_argument(
        "--scenario",
        default=DEFAULT_SCENARIO,
        choices=["full-workflow", "peak-traffic", "camera-health"],
    )
    on_parser.add_argument("--seed", default=DEFAULT_SEED)
    on_parser.add_argument(
        "--target-enterprise", help="Enterprise ID, email, account ID, or exact enterprise name."
    )
    subparsers.add_parser("off", help="Remove active simulation data.")
    subparsers.add_parser("status", help="Show simulation data status.")

    reset_parser = subparsers.add_parser(
        "reset", help="Remove active simulation data, then regenerate it."
    )
    reset_parser.add_argument("--range", default="6m", choices=["30d", "6m", "12m"])
    reset_parser.add_argument(
        "--scenario",
        default=DEFAULT_SCENARIO,
        choices=["full-workflow", "peak-traffic", "camera-health"],
    )
    reset_parser.add_argument("--seed", default=DEFAULT_SEED)
    reset_parser.add_argument(
        "--target-enterprise", help="Enterprise ID, email, account ID, or exact enterprise name."
    )
    args = parser.parse_args()
    asyncio.run(run(args))


async def run(args: argparse.Namespace) -> None:
    await validate_schema()

    if args.command == "status":
        async with AsyncSessionLocal() as db:
            runs = await list_runs(db)
        print(json.dumps({"runs": runs}, indent=2, sort_keys=True))
        return

    require_simulation_enabled()

    if args.command == "off":
        async with AsyncSessionLocal() as db:
            removed = await remove_active_simulation_data(db)
        print(json.dumps({"removed": removed}, indent=2, sort_keys=True))
        return

    if args.command == "reset":
        async with AsyncSessionLocal() as db:
            removed = await remove_active_simulation_data(db)
            created = await generate_simulation_data(
                db, args.range, args.scenario, args.seed, args.target_enterprise
            )
        print(json.dumps({"removed": removed, "created": created}, indent=2, sort_keys=True))
        return

    async with AsyncSessionLocal() as db:
        active = await active_run(db)
        if active is not None:
            await ensure_active_target_matches(db, active, args.target_enterprise)
            result = run_result(active, status="already-active")
        else:
            result = await generate_simulation_data(
                db, args.range, args.scenario, args.seed, args.target_enterprise
            )
    print(json.dumps(result, indent=2, sort_keys=True))


async def validate_schema() -> None:
    async with engine.connect() as connection:
        await validate_database_migration_head(connection)


def require_simulation_enabled() -> None:
    if not get_settings().allow_simulation_data:
        raise SystemExit(
            "Refusing to manage simulation data because TANAW_ALLOW_SIMULATION_DATA is not true."
        )


async def active_run(db: AsyncSession) -> SimulationRun | None:
    result = await db.scalars(
        select(SimulationRun)
        .where(SimulationRun.status == "active")
        .order_by(SimulationRun.created_at.desc())
    )
    return result.first()


async def list_runs(db: AsyncSession) -> list[dict]:
    runs = (
        await db.scalars(select(SimulationRun).order_by(SimulationRun.created_at.desc()).limit(20))
    ).all()
    return [
        {
            "id": run.id,
            "scenario": run.scenario,
            "seed": run.seed,
            "status": run.status,
            "rangeStart": run.range_start.isoformat(),
            "rangeEnd": run.range_end.isoformat(),
            "targetAccountId": run.target_account_id,
            "targetEnterpriseId": run.target_enterprise_id,
            "targetEnterpriseName": run.target_enterprise_name,
            "createdAt": run.created_at.isoformat() if run.created_at else None,
            "endedAt": run.ended_at.isoformat() if run.ended_at else None,
            "generatedCounts": json.loads(run.generated_counts_json)
            if run.generated_counts_json
            else {},
        }
        for run in runs
    ]


def run_result(run: SimulationRun, status: str) -> dict:
    return {
        "runId": run.id,
        "status": status,
        "scenario": run.scenario,
        "rangeStart": run.range_start.isoformat(),
        "rangeEnd": run.range_end.isoformat(),
        "target": {
            "accountId": run.target_account_id,
            "enterpriseId": run.target_enterprise_id,
            "enterpriseName": run.target_enterprise_name,
        },
        "counts": json.loads(run.generated_counts_json) if run.generated_counts_json else {},
    }


async def ensure_active_target_matches(
    db: AsyncSession, run: SimulationRun, requested_identifier: str | None
) -> None:
    if not run.target_enterprise_id:
        raise SystemExit(
            "The active simulation-data run predates target-enterprise support. Run simulation-data reset with --target-enterprise."
        )
    if not requested_identifier:
        return

    requested_target = await resolve_target_enterprise(db, requested_identifier, [])
    if requested_target.account.id != run.target_account_id:
        raise SystemExit(
            f"The active simulation-data run targets {run.target_enterprise_name} ({run.target_enterprise_id}). "
            "Use simulation-data reset to select a different target."
        )


async def generate_simulation_data(
    db: AsyncSession, range_value: str, scenario: str, seed: str, target_identifier: str | None
) -> dict:
    rng = random.Random(seed)
    range_start, range_end = reporting_range(range_value)
    run = SimulationRun(
        id=str(uuid4()),
        scenario=scenario,
        seed=seed,
        range_start=range_start,
        range_end=range_end,
        status="active",
    )
    db.add(run)
    await db.flush()

    accounts = await create_accounts(db, run.id)
    target = await resolve_target_enterprise(db, target_identifier, accounts["enterprises"])
    run.target_account_id = target.account.id
    run.target_enterprise_id = target.enterprise.official_code
    run.target_enterprise_name = target.enterprise.name
    prepared_counts = create_prepared_report_counts(range_start, range_end, scenario, rng)

    counts = {
        "lguAccounts": len(accounts["lgu"]),
        "generatedEnterpriseAccounts": len(accounts["enterprises"]),
        "simulationEnterprises": len(accounts["enterprises"]),
        "targetPreparedReportCounts": prepared_counts,
    }
    run.generated_counts_json = json.dumps(counts, sort_keys=True)
    await db.commit()
    return run_result(run, status="created")


async def create_accounts(db: AsyncSession, run_id: str) -> dict[str, list[Account]]:
    password_hash = hash_password(validate_password_policy(TEST_ACCOUNT_PASSWORD))
    lgu_accounts: list[Account] = []
    for email, role, display_name, title, first_name, last_name in LGU_ACCOUNTS:
        ensure_email_available(
            await db.scalar(select(Account).where(Account.email == email)), email
        )
        account = Account(
            email=email,
            first_name=first_name,
            last_name=last_name,
            password_hash=password_hash,
            role=role,
            display_name=display_name,
            title=title,
            status=AccountStatus.ACTIVE,
            activated_at=datetime.now(UTC),
        )
        db.add(account)
        await db.flush()
        db.add(SimulationRunAccount(run_id=run_id, account_id=account.id))
        lgu_accounts.append(account)

    enterprise_accounts: list[Account] = []
    for index, enterprise in enumerate(ENTERPRISES, start=1):
        ensure_email_available(
            await db.scalar(select(Account).where(Account.email == enterprise.email)),
            enterprise.email,
        )
        enterprise_id = await generate_enterprise_id(db, enterprise.name)
        account = Account(
            email=enterprise.email,
            phone=enterprise.phone,
            password_hash=password_hash,
            role=AccountRole.ENTERPRISE,
            display_name=enterprise.manager,
            title="Enterprise Account",
            status=AccountStatus.ACTIVE,
            activated_at=datetime.now(UTC),
        )
        db.add(account)
        await db.flush()
        topology_enterprise = Enterprise(
            official_code=enterprise_id,
            name=enterprise.name,
            category=enterprise.category,
            classification="simulation",
            simulation_run_id=run_id,
            lifecycle_state="active",
        )
        db.add(topology_enterprise)
        await db.flush()
        site = EnterpriseSite(
            enterprise_id=topology_enterprise.id,
            classification="simulation",
            site_code="primary",
            name=f"{enterprise.name} Primary Site",
        )
        db.add_all(
            [
                EnterpriseMembership(
                    enterprise_id=topology_enterprise.id,
                    account_id=account.id,
                    classification="simulation",
                    membership_role="manager",
                ),
                site,
                SimulationRunAccount(run_id=run_id, account_id=account.id),
            ]
        )
        await db.flush()
        db.add(
            SiteLocationVersion(
                site_id=site.id,
                classification="simulation",
                version=1,
                barangay=enterprise.barangay,
                address=enterprise.address,
                timezone_name="Asia/Manila",
                building_capacity=100,
                latitude=enterprise.latitude,
                longitude=enterprise.longitude,
                location_source="geocoded",
                location_confidence=1.0,
                geocoded_address=enterprise.address,
                coordinates_confirmed_at=datetime.now(UTC),
                change_reason="simulation_seeded",
            )
        )
        db.add(
            EdgeDevice(
                site_id=site.id,
                classification="simulation",
                device_key=f"GW-SP-{index:04d}",
                display_name=f"GW-SP-{index:04d}",
                paired_at=datetime.now(UTC),
            )
        )
        enterprise_accounts.append(account)

    await db.flush()
    return {"lgu": lgu_accounts, "enterprises": enterprise_accounts}


def ensure_email_available(existing: Account | None, email: str) -> None:
    if existing is not None:
        raise SystemExit(
            f"Cannot seed simulation account {email}; an account with that email already exists."
        )


async def resolve_target_enterprise(
    db: AsyncSession, identifier: str | None, generated_enterprises: list[Account]
) -> AccountTopology:
    if not identifier:
        if not generated_enterprises:
            raise SystemExit("No generated enterprise is available as the default target.")
        return await require_account_topology(db, generated_enterprises[0])

    normalized = identifier.strip().lower()
    targets = list(
        await db.scalars(
            select(Account)
            .join(EnterpriseMembership, EnterpriseMembership.account_id == Account.id)
            .join(Enterprise, Enterprise.id == EnterpriseMembership.enterprise_id)
            .where(
                Account.role == AccountRole.ENTERPRISE,
                Account.status == AccountStatus.ACTIVE,
                Account.activated_at.is_not(None),
                Enterprise.classification == "simulation",
                Enterprise.lifecycle_state == "active",
                or_(
                    func.lower(Account.id) == normalized,
                    func.lower(Account.email) == normalized,
                    func.lower(Enterprise.official_code) == normalized,
                    func.lower(Enterprise.name) == normalized,
                ),
            )
        )
    )
    if len(targets) != 1:
        raise SystemExit(f"Target enterprise '{identifier}' was not found or is not active.")
    return await require_account_topology(db, targets[0])


def create_prepared_report_counts(
    range_start: datetime,
    range_end: datetime,
    scenario: str,
    rng: random.Random,
) -> list[dict[str, Any]]:
    months = month_starts(range_start, range_end)[-2:]
    prepared: list[dict[str, Any]] = []
    for month_index, month_start in enumerate(months):
        entries = 620 + month_index * 73 + rng.randint(0, 80)
        if scenario == "peak-traffic" and month_index == len(months) - 1:
            entries *= 2
        exits = max(0, entries - rng.randint(8, 55))
        prepared.append(
            simulation_preparation_counts(
                month_start=month_start,
                entries=entries,
                exits=exits,
                unique_count=max(1, int(entries * rng.uniform(0.62, 0.82))),
                peak_occupancy=max(8, rng.randint(24, 96)),
                period_label_value=period_label(month_start),
            )
        )
    if not prepared:
        raise SystemExit("The requested range produced no canonical reporting periods.")
    return prepared


async def remove_active_simulation_data(db: AsyncSession) -> dict:
    active_runs = (
        await db.scalars(select(SimulationRun).where(SimulationRun.status == "active"))
    ).all()
    run_ids = [run.id for run in active_runs]
    if not run_ids:
        return {"runs": 0}

    owned_account_ids = list(
        await db.scalars(
            select(SimulationRunAccount.account_id).where(SimulationRunAccount.run_id.in_(run_ids))
        )
    )
    simulation_enterprise_ids = list(
        await db.scalars(
            select(Enterprise.id).where(
                Enterprise.classification == "simulation",
                Enterprise.simulation_run_id.in_(run_ids),
            )
        )
    )
    await _delete_target_simulation_records(db)
    await db.execute(delete(SimulationRunAccount).where(SimulationRunAccount.run_id.in_(run_ids)))
    accounts_result = await db.execute(delete(Account).where(Account.id.in_(owned_account_ids)))
    counts = {
        "simulationEnterprises": len(simulation_enterprise_ids),
        "accounts": affected_row_count(accounts_result),
    }
    await db.execute(
        update(SimulationRun)
        .where(SimulationRun.id.in_(run_ids))
        .values(status="removed", ended_at=datetime.now(UTC))
    )
    await db.commit()
    return {"runs": len(run_ids), **counts}


async def _delete_target_simulation_records(db: AsyncSession) -> None:
    statements = (
        "DELETE FROM domain_event_delivery_attempts WHERE domain_event_delivery_id IN "
        "(SELECT delivery.id FROM domain_event_deliveries delivery JOIN domain_events event "
        "ON event.id = delivery.domain_event_id WHERE event.classification = 'simulation')",
        "DELETE FROM domain_event_consumer_receipts WHERE domain_event_id IN "
        "(SELECT id FROM domain_events WHERE classification = 'simulation')",
        "DELETE FROM domain_event_deliveries WHERE domain_event_id IN "
        "(SELECT id FROM domain_events WHERE classification = 'simulation')",
        "DELETE FROM domain_events WHERE classification = 'simulation'",
        "DELETE FROM final_report_command_receipts WHERE classification = 'simulation'",
        "DELETE FROM final_report_events WHERE classification = 'simulation'",
        "DELETE FROM final_report_artifacts WHERE classification = 'simulation'",
        "DELETE FROM final_report_demographic_facts WHERE classification = 'simulation'",
        "DELETE FROM final_report_metric_facts WHERE classification = 'simulation'",
        "DELETE FROM final_report_items WHERE classification = 'simulation'",
        "DELETE FROM final_report_scope_members WHERE classification = 'simulation'",
        "DELETE FROM final_report_versions WHERE classification = 'simulation'",
        "DELETE FROM final_report_source_claims WHERE classification = 'simulation'",
        "DELETE FROM report_finalizations WHERE classification = 'simulation'",
        "DELETE FROM report_intake_receipts WHERE classification = 'simulation'",
        "DELETE FROM report_review_events WHERE classification = 'simulation'",
        "DELETE FROM report_source_batches WHERE classification = 'simulation'",
        "DELETE FROM report_demographic_facts WHERE classification = 'simulation'",
        "DELETE FROM report_metric_facts WHERE classification = 'simulation'",
        "DELETE FROM report_revisions WHERE classification = 'simulation'",
        "DELETE FROM enterprise_reports WHERE classification = 'simulation'",
        "DELETE FROM reporting_obligations WHERE classification = 'simulation'",
        "DELETE FROM site_live_state WHERE classification = 'simulation'",
        "DELETE FROM site_telemetry_hourly_rollups WHERE classification = 'simulation'",
        "DELETE FROM device_health_samples WHERE classification = 'simulation'",
        "DELETE FROM telemetry_metric_facts WHERE classification = 'simulation'",
        "DELETE FROM telemetry_observations WHERE classification = 'simulation'",
        "DELETE FROM device_telemetry_epochs WHERE classification = 'simulation'",
        "DELETE FROM cameras WHERE classification = 'simulation'",
        "DELETE FROM edge_devices WHERE classification = 'simulation'",
        "DELETE FROM enterprise_sites WHERE classification = 'simulation'",
        "DELETE FROM enterprise_memberships WHERE classification = 'simulation'",
        "DELETE FROM enterprises WHERE classification = 'simulation'",
    )
    for statement in statements:
        await db.execute(text(statement))


def reporting_range(range_value: str) -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    if range_value == "30d":
        start = now - timedelta(days=30)
        return start.replace(hour=0, minute=0, second=0, microsecond=0), now

    months = 12 if range_value == "12m" else 6
    current_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return add_months(current_month_start, -(months - 1)), now


def month_starts(start: datetime, end: datetime) -> list[datetime]:
    first = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last = end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    months = []
    current = first
    while current <= last:
        months.append(current)
        current = add_months(current, 1)
    return months


def add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return value.replace(year=year, month=month)


def period_label(month_start: datetime) -> str:
    next_month = add_months(month_start, 1)
    last_day = (next_month - timedelta(days=1)).day
    short = month_start.strftime("%b")
    return f"{short} 1 - {short} {last_day}, {month_start.year}"


def simulation_preparation_counts(
    *,
    month_start: datetime,
    entries: int,
    exits: int,
    unique_count: int,
    peak_occupancy: int,
    period_label_value: str,
) -> dict[str, Any]:
    reporting_period = monthly_reporting_period(month_start.year, month_start.month)
    return {
        "entries": entries,
        "exits": exits,
        "uniqueCount": unique_count,
        "peakOccupancy": peak_occupancy,
        "period": period_label_value,
        "periodKey": reporting_period.natural_key,
        "sourceWindow": {
            "start": _utc_contract_timestamp(reporting_period.starts_at),
            "end": _utc_contract_timestamp(reporting_period.ends_at),
        },
    }


def _utc_contract_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def affected_row_count(result: Any) -> int:
    return int(getattr(result, "rowcount", 0) or 0)
