import argparse
import asyncio
import json
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.db.migrations import validate_database_migration_head
from app.db.session import AsyncSessionLocal, engine
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import generate_enterprise_id
from app.features.operational.models import (
    MockDataRun,
    MockDataRunAccount,
)
from app.features.reporting.contracts import monthly_reporting_period
from app.features.topology.account_scope import (
    AccountTopology,
    require_account_topology,
)
from app.features.topology.models import (
    EdgeDevice,
    Enterprise,
    EnterpriseMembership,
    EnterpriseSite,
)

TEST_ACCOUNT_PASSWORD = "Visitor simulation access phrase 2026"
DEFAULT_SCENARIO = "full-workflow"
DEFAULT_SEED = "tanaw-testing-v2"
REPORTING_STAFF_NAME = "Carla Mendoza"


@dataclass(frozen=True)
class MockEnterprise:
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
    MockEnterprise(
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
    MockEnterprise(
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
    MockEnterprise(
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
    MockEnterprise(
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
    MockEnterprise(
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
    parser = argparse.ArgumentParser(description="Manage TANAW mock data.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    on_parser = subparsers.add_parser("on", help="Generate mock data.")
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
    on_parser.add_argument("--desktop-url")

    off_parser = subparsers.add_parser("off", help="Remove active mock data.")
    off_parser.add_argument("--desktop-url")

    status_parser = subparsers.add_parser("status", help="Show mock data status.")
    status_parser.add_argument("--desktop-url")

    reset_parser = subparsers.add_parser(
        "reset", help="Remove active mock data, then regenerate it."
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
    reset_parser.add_argument("--desktop-url")

    args = parser.parse_args()
    asyncio.run(run(args))


async def run(args: argparse.Namespace) -> None:
    await validate_schema()

    if args.command == "status":
        async with AsyncSessionLocal() as db:
            runs = await list_runs(db)
        print(json.dumps({"runs": runs}, indent=2, sort_keys=True))
        await desktop_status(args.desktop_url)
        return

    require_mock_data_enabled()

    if args.command == "off":
        async with AsyncSessionLocal() as db:
            removed = await remove_active_mock_data(db)
        await desktop_reset(args.desktop_url)
        print(json.dumps({"removed": removed}, indent=2, sort_keys=True))
        return

    if args.command == "reset":
        async with AsyncSessionLocal() as db:
            removed = await remove_active_mock_data(db)
            created = await generate_mock_data(
                db, args.range, args.scenario, args.seed, args.target_enterprise
            )
        await desktop_prepare(args.desktop_url, created)
        print(json.dumps({"removed": removed, "created": created}, indent=2, sort_keys=True))
        return

    async with AsyncSessionLocal() as db:
        active = await active_run(db)
        if active is not None:
            await ensure_active_target_matches(db, active, args.target_enterprise)
            result = run_result(active, status="already-active")
        else:
            result = await generate_mock_data(
                db, args.range, args.scenario, args.seed, args.target_enterprise
            )
    await desktop_prepare(args.desktop_url, result)
    print(json.dumps(result, indent=2, sort_keys=True))


async def validate_schema() -> None:
    async with engine.connect() as connection:
        await validate_database_migration_head(connection)


def require_mock_data_enabled() -> None:
    if not get_settings().allow_mock_data:
        raise SystemExit("Refusing to manage mock data because TANAW_ALLOW_MOCK_DATA is not true.")


async def active_run(db: AsyncSession) -> MockDataRun | None:
    result = await db.scalars(
        select(MockDataRun)
        .where(MockDataRun.status == "active")
        .order_by(MockDataRun.created_at.desc())
    )
    return result.first()


async def list_runs(db: AsyncSession) -> list[dict]:
    runs = (
        await db.scalars(select(MockDataRun).order_by(MockDataRun.created_at.desc()).limit(20))
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


def run_result(run: MockDataRun, status: str) -> dict:
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
    db: AsyncSession, run: MockDataRun, requested_identifier: str | None
) -> None:
    if not run.target_enterprise_id:
        raise SystemExit(
            "The active mock-data run predates target-enterprise support. Run mock-data reset with --target-enterprise."
        )
    if not requested_identifier:
        return

    requested_target = await resolve_target_enterprise(db, requested_identifier, [])
    if requested_target.account.id != run.target_account_id:
        raise SystemExit(
            f"The active mock-data run targets {run.target_enterprise_name} ({run.target_enterprise_id}). "
            "Use mock-data reset to select a different target."
        )


async def generate_mock_data(
    db: AsyncSession, range_value: str, scenario: str, seed: str, target_identifier: str | None
) -> dict:
    rng = random.Random(seed)
    range_start, range_end = reporting_range(range_value)
    run = MockDataRun(
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
        "targetPreparedCounts": prepared_counts[0],
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
        db.add(MockDataRunAccount(run_id=run_id, account_id=account.id))
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
            barangay=enterprise.barangay,
            address=enterprise.address,
            building_capacity=100,
            latitude=enterprise.latitude,
            longitude=enterprise.longitude,
            location_source="geocoded",
            location_confidence=1.0,
            geocoded_address=enterprise.address,
            coordinates_updated_at=datetime.now(UTC),
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
                MockDataRunAccount(run_id=run_id, account_id=account.id),
            ]
        )
        await db.flush()
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
            f"Cannot seed mock account {email}; an account with that email already exists."
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
            mock_preparation_counts(
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


async def remove_active_mock_data(db: AsyncSession) -> dict:
    active_runs = (
        await db.scalars(select(MockDataRun).where(MockDataRun.status == "active"))
    ).all()
    run_ids = [run.id for run in active_runs]
    if not run_ids:
        return {"runs": 0}

    owned_account_ids = list(
        await db.scalars(
            select(MockDataRunAccount.account_id).where(MockDataRunAccount.run_id.in_(run_ids))
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
    await db.execute(delete(MockDataRunAccount).where(MockDataRunAccount.run_id.in_(run_ids)))
    accounts_result = await db.execute(delete(Account).where(Account.id.in_(owned_account_ids)))
    counts = {
        "simulationEnterprises": len(simulation_enterprise_ids),
        "accounts": affected_row_count(accounts_result),
    }
    await db.execute(
        update(MockDataRun)
        .where(MockDataRun.id.in_(run_ids))
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
        "DELETE FROM report_migration_exceptions WHERE classification = 'simulation'",
        "DELETE FROM report_intake_receipts WHERE classification = 'simulation'",
        "DELETE FROM report_review_events WHERE classification = 'simulation'",
        "DELETE FROM report_source_batches WHERE classification = 'simulation'",
        "DELETE FROM report_demographic_facts WHERE classification = 'simulation'",
        "DELETE FROM report_metric_facts WHERE classification = 'simulation'",
        "DELETE FROM report_revisions WHERE classification = 'simulation'",
        "DELETE FROM enterprise_reports WHERE classification = 'simulation'",
        "DELETE FROM reporting_obligations WHERE classification = 'simulation'",
        "DELETE FROM telemetry_migration_exceptions WHERE classification = 'simulation'",
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


def mock_preparation_counts(
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


def desktop_preparation_payload(
    *,
    run_id: str,
    enterprise_id: str,
    enterprise_name: object,
    prepared: dict[str, Any],
) -> dict[str, Any]:
    return {
        "mock_run_id": run_id,
        "enterprise_id": enterprise_id,
        "enterprise_name": enterprise_name,
        "entries": prepared["entries"],
        "exits": prepared["exits"],
        "unique_count": prepared["uniqueCount"],
        "peak_occupancy": prepared["peakOccupancy"],
        "period_id": prepared["periodKey"],
        "source_window": prepared["sourceWindow"],
    }


def _utc_contract_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def desktop_prepare(desktop_url: str | None, result: dict) -> None:
    if not desktop_url:
        return

    raw_target = result.get("target")
    target: dict[str, Any] = raw_target if isinstance(raw_target, dict) else {}
    raw_counts = result.get("counts")
    counts: dict[str, Any] = raw_counts if isinstance(raw_counts, dict) else {}
    raw_prepared_reports = counts.get("targetPreparedReportCounts")
    prepared_reports = raw_prepared_reports if isinstance(raw_prepared_reports, list) else []
    raw_prepared = prepared_reports[0] if prepared_reports else counts.get("targetPreparedCounts")
    prepared: dict[str, Any] = raw_prepared if isinstance(raw_prepared, dict) else {}
    enterprise_id = target.get("enterpriseId")
    if not isinstance(enterprise_id, str) or not enterprise_id:
        raise SystemExit(
            "The mock-data run has no target enterprise ID. Reset the run before preparing desktop data."
        )
    if not prepared:
        raise SystemExit(
            "The mock-data run has no prepared desktop count package. Reset the run before preparing desktop data."
        )

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                f"{desktop_url.rstrip('/')}/mock/prepare",
                json=desktop_preparation_payload(
                    run_id=result["runId"],
                    enterprise_id=enterprise_id,
                    enterprise_name=target.get("enterpriseName"),
                    prepared=prepared,
                ),
            )
            response.raise_for_status()
            result["desktop"] = response.json()
    except Exception as exc:
        result["desktop"] = {
            "prepared": False,
            "delivery": "authenticated-desktop-pull",
            "message": (
                f"Direct desktop callback was unavailable ({type(exc).__name__}: {exc}). "
                "The authenticated target desktop will pull the prepared count package automatically."
            ),
        }


async def desktop_reset(desktop_url: str | None) -> None:
    if not desktop_url:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(f"{desktop_url.rstrip('/')}/mock/reset")
            response.raise_for_status()
    except Exception as exc:
        print(f"Desktop mock reset skipped: {exc}")


async def desktop_status(desktop_url: str | None) -> None:
    if not desktop_url:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{desktop_url.rstrip('/')}/mock/status")
            response.raise_for_status()
            print(json.dumps({"desktop": response.json()}, indent=2, sort_keys=True))
    except Exception as exc:
        print(f"Desktop mock status unavailable: {exc}")


def affected_row_count(result: Any) -> int:
    return int(getattr(result, "rowcount", 0) or 0)
