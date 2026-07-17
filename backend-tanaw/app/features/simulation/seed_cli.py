import argparse
import asyncio
import hashlib
import json
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4, uuid5

from sqlalchemy import bindparam, delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.db.schema_version import validate_database_schema
from app.db.session import AsyncSessionLocal, engine
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import generate_enterprise_id
from app.features.events.models import DomainEvent
from app.features.notifications.models import UserNotification
from app.features.reporting.contracts import CanonicalReportingPeriod, monthly_reporting_period
from app.features.reporting.envelopes import ReportSubmissionCommand
from app.features.reporting.models import (
    EnterpriseReport,
    ReportingObligation,
    ReportingPeriod,
)
from app.features.reporting.obligation_envelopes import ObligationFreezeCommand
from app.features.reporting.obligations import freeze_period_obligations
from app.features.reporting.service import submit_report_command
from app.features.simulation.models import SimulationRun, SimulationRunAccount
from app.features.topology.account_scope import (
    AccountTopology,
    require_account_topology,
)
from app.features.topology.models import (
    Camera,
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
_MOCK_NAMESPACE = UUID("ca1977bf-1b4c-45bd-8650-57e7f6a56df5")


@dataclass(frozen=True, slots=True)
class SeededEnterprise:
    account: Account
    enterprise: Enterprise
    site: EnterpriseSite
    location: SiteLocationVersion
    device: EdgeDevice
    camera: Camera


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
        "--target-enterprise-id",
        required=True,
        help="Canonical Enterprise ID, for example archies_001@tanaw.sanpedro.",
    )
    subparsers.add_parser("off", help="Remove active mock data.")
    subparsers.add_parser("status", help="Show mock-data status.")

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
        "--target-enterprise-id",
        required=True,
        help="Canonical Enterprise ID, for example archies_001@tanaw.sanpedro.",
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
                db, args.range, args.scenario, args.seed, args.target_enterprise_id
            )
        print(json.dumps({"removed": removed, "created": created}, indent=2, sort_keys=True))
        return

    async with AsyncSessionLocal() as db:
        active = await active_run(db)
        if active is not None:
            ensure_active_target_matches(active, args.target_enterprise_id)
            result = run_result(active, status="already-active")
        else:
            result = await generate_simulation_data(
                db, args.range, args.scenario, args.seed, args.target_enterprise_id
            )
    print(json.dumps(result, indent=2, sort_keys=True))


async def validate_schema() -> None:
    async with engine.connect() as connection:
        await validate_database_schema(connection)


def require_simulation_enabled() -> None:
    if not get_settings().allow_mock_data:
        raise SystemExit("Refusing to manage mock data because TANAW_ALLOW_MOCK_DATA is not true.")


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
            "generatedCounts": _public_counts(run.generated_counts_json),
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
        "counts": _public_counts(run.generated_counts_json),
    }


def _public_counts(raw_counts: str | None) -> dict[str, Any]:
    if not raw_counts:
        return {}
    parsed = json.loads(raw_counts)
    if not isinstance(parsed, dict):
        return {}
    return {key: value for key, value in parsed.items() if key != "mockOwnedResourceIds"}


def ensure_active_target_matches(run: SimulationRun, requested_enterprise_id: str) -> None:
    if not run.target_enterprise_id:
        raise SystemExit(
            "The active mockdata run does not identify an enterprise. "
            "Run mockdata reset with --target-enterprise-id."
        )
    if run.target_enterprise_id.lower() != requested_enterprise_id.strip().lower():
        raise SystemExit(
            f"The active mockdata run targets {run.target_enterprise_name} ({run.target_enterprise_id}). "
            "Use mockdata reset to select a different target."
        )


async def generate_simulation_data(
    db: AsyncSession, range_value: str, scenario: str, seed: str, target_enterprise_id: str
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

    accounts = await create_accounts(db, run.id, range_start)
    target = await resolve_target_enterprise(db, target_enterprise_id)
    run.target_account_id = target.account.id
    run.target_enterprise_id = target.enterprise.official_code
    run.target_enterprise_name = target.enterprise.name
    prepared_counts = create_prepared_report_counts(range_start, range_end, scenario, rng)[-1:]
    history = await create_reporting_history(
        db,
        run_id=run.id,
        range_start=range_start,
        range_end=range_end,
        rng=rng,
        generated=accounts["enterpriseTopologies"],
        target=target,
    )

    counts = {
        "lguAccounts": len(accounts["lgu"]),
        "generatedEnterpriseAccounts": len(accounts["enterprises"]),
        "participatingEnterprises": len(accounts["enterprises"]) + 1,
        "historicalReports": history["historicalReports"],
        "targetPreparedReportCounts": prepared_counts,
        "mockOwnedResourceIds": history["mockOwnedResourceIds"],
    }
    run.generated_counts_json = json.dumps(counts, sort_keys=True)
    await db.commit()
    return run_result(run, status="created")


async def create_accounts(db: AsyncSession, run_id: str, range_start: datetime) -> dict[str, Any]:
    password_hash = hash_password(validate_password_policy(TEST_ACCOUNT_PASSWORD))
    effective_at = range_start - timedelta(days=32)
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
            activated_at=effective_at,
        )
        db.add(account)
        await db.flush()
        db.add(SimulationRunAccount(run_id=run_id, account_id=account.id))
        lgu_accounts.append(account)

    enterprise_accounts: list[Account] = []
    enterprise_topologies: list[SeededEnterprise] = []
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
            activated_at=effective_at,
        )
        db.add(account)
        await db.flush()
        topology_enterprise = Enterprise(
            official_code=enterprise_id,
            name=enterprise.name,
            category=enterprise.category,
            classification="official",
            simulation_run_id=None,
            lifecycle_state="active",
        )
        db.add(topology_enterprise)
        await db.flush()
        site = EnterpriseSite(
            enterprise_id=topology_enterprise.id,
            classification="official",
            site_code="primary",
            name=f"{enterprise.name} Primary Site",
            registered_at=effective_at,
        )
        db.add_all(
            [
                EnterpriseMembership(
                    enterprise_id=topology_enterprise.id,
                    account_id=account.id,
                    classification="official",
                    membership_role="manager",
                    started_at=effective_at,
                ),
                site,
                SimulationRunAccount(run_id=run_id, account_id=account.id),
            ]
        )
        await db.flush()
        location = SiteLocationVersion(
            site_id=site.id,
            classification="official",
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
            coordinates_confirmed_at=effective_at,
            change_reason="mockdata_seeded",
            effective_from=effective_at,
        )
        db.add(location)
        device = EdgeDevice(
            site_id=site.id,
            classification="official",
            device_key=f"MOCK-GW-{run_id[:8]}-{index:02d}",
            display_name=f"{enterprise.name} Mock Gateway",
            paired_at=effective_at,
        )
        db.add(device)
        await db.flush()
        camera = Camera(
            site_id=site.id,
            edge_device_id=device.id,
            classification="official",
            camera_key="main-entrance",
            display_name=f"{enterprise.name} Main Entrance",
        )
        db.add(camera)
        enterprise_accounts.append(account)
        enterprise_topologies.append(
            SeededEnterprise(
                account=account,
                enterprise=topology_enterprise,
                site=site,
                location=location,
                device=device,
                camera=camera,
            )
        )

    await db.flush()
    return {
        "lgu": lgu_accounts,
        "enterprises": enterprise_accounts,
        "enterpriseTopologies": enterprise_topologies,
    }


def ensure_email_available(existing: Account | None, email: str) -> None:
    if existing is not None:
        raise SystemExit(
            f"Cannot seed mock account {email}; an account with that email already exists."
        )


async def resolve_target_enterprise(db: AsyncSession, enterprise_id: str) -> AccountTopology:
    normalized = enterprise_id.strip().lower()
    targets = list(
        await db.scalars(
            select(Account)
            .join(EnterpriseMembership, EnterpriseMembership.account_id == Account.id)
            .join(Enterprise, Enterprise.id == EnterpriseMembership.enterprise_id)
            .where(
                Account.role == AccountRole.ENTERPRISE,
                Account.status == AccountStatus.ACTIVE,
                Account.activated_at.is_not(None),
                Enterprise.classification == "official",
                Enterprise.lifecycle_state == "active",
                func.lower(Enterprise.official_code) == normalized,
            )
        )
    )
    if len(targets) != 1:
        raise SystemExit(
            f"Official Enterprise ID '{enterprise_id}' was not found or is not active. "
            "Copy the exact Enterprise ID from the IT portal or desktop Profile."
        )
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


async def create_reporting_history(
    db: AsyncSession,
    *,
    run_id: str,
    range_start: datetime,
    range_end: datetime,
    rng: random.Random,
    generated: list[SeededEnterprise],
    target: AccountTopology,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    all_months = month_starts(range_start, range_end)
    current_month = all_months[-1]
    report_months = all_months[:-1]
    created_period_ids: list[str] = []
    report_ids: list[str] = []
    obligation_ids: list[str] = []
    freeze_event_ids: list[str] = []
    frozen_period_ids: list[str] = []

    periods: dict[str, tuple[ReportingPeriod, CanonicalReportingPeriod]] = {}
    for month_start in all_months:
        period, created = await _ensure_reporting_period(db, month_start, now=now)
        canonical = monthly_reporting_period(month_start.year, month_start.month)
        periods[canonical.natural_key] = (period, canonical)
        if created:
            created_period_ids.append(period.id)
        obligation_ids_before = set(
            await db.scalars(
                select(ReportingObligation.id).where(
                    ReportingObligation.reporting_period_id == period.id
                )
            )
        )
        if period.obligations_frozen_at is None:
            freeze_command_id = uuid5(_MOCK_NAMESPACE, f"{run_id}:freeze:{period.id}")
            await freeze_period_obligations(
                db,
                account=None,
                reporting_period_id=UUID(period.id),
                command=ObligationFreezeCommand.model_validate(
                    {
                        "contractVersion": 2,
                        "commandId": str(freeze_command_id),
                    }
                ),
                frozen_at=now,
            )
            frozen_period_ids.append(period.id)
            freeze_event_ids.extend(
                await db.scalars(
                    select(DomainEvent.id).where(
                        DomainEvent.correlation_id == str(freeze_command_id)
                    )
                )
            )
        obligation_ids_after = set(
            await db.scalars(
                select(ReportingObligation.id).where(
                    ReportingObligation.reporting_period_id == period.id
                )
            )
        )
        obligation_ids.extend(sorted(obligation_ids_after - obligation_ids_before))

    for month_index, month_start in enumerate(all_months):
        canonical = monthly_reporting_period(month_start.year, month_start.month)
        period, _ = periods[canonical.natural_key]
        for enterprise_index, topology in enumerate(generated):
            obligation, obligation_created = await _ensure_reporting_obligation(
                db,
                period=period,
                enterprise=topology.enterprise,
                site=topology.site,
                location=topology.location,
            )
            if obligation_created:
                obligation_ids.append(obligation.id)
            if month_start == current_month:
                continue
            metrics = _mock_metrics(rng, month_index=month_index, enterprise_index=enterprise_index)
            report_id = await _submit_mock_report(
                db,
                run_id=run_id,
                account=topology.account,
                camera=topology.camera,
                canonical=canonical,
                metrics=metrics,
                sequence_start=(month_index + 1) * 1_000_000 + enterprise_index * 100_000,
                acknowledged_at=now,
            )
            report_ids.append(report_id)

    target_device, target_camera = await _create_target_mock_camera(db, run_id, target)
    if report_months:
        previous_month = report_months[-1]
        canonical = monthly_reporting_period(previous_month.year, previous_month.month)
        period, _ = periods[canonical.natural_key]
        target_obligation, target_obligation_created = await _ensure_reporting_obligation(
            db,
            period=period,
            enterprise=target.enterprise,
            site=target.site,
            location=target.location,
        )
        if target_obligation_created:
            obligation_ids.append(target_obligation.id)
        target_metrics = _mock_metrics(
            rng,
            month_index=max(0, len(report_months) - 1),
            enterprise_index=len(generated),
        )
        existing_target_report = await db.scalar(
            select(EnterpriseReport).where(
                EnterpriseReport.reporting_obligation_id == target_obligation.id
            )
        )
        if existing_target_report is None:
            report_ids.append(
                await _submit_mock_report(
                    db,
                    run_id=run_id,
                    account=target.account,
                    camera=target_camera,
                    canonical=canonical,
                    metrics=target_metrics,
                    sequence_start=9_000_000,
                    acknowledged_at=now,
                )
            )

    generated_report_count = len(report_months) * len(generated)
    return {
        "historicalReports": len(report_ids),
        "mockOwnedResourceIds": {
            "generatedEnterpriseIds": [topology.enterprise.id for topology in generated],
            "reportIds": report_ids,
            "obligationIds": sorted(set(obligation_ids)),
            "targetCameraIds": [target_camera.id],
            "targetDeviceIds": [target_device.id],
            "createdReportingPeriodIds": created_period_ids,
            "domainEventIds": sorted(set(freeze_event_ids)),
            "frozenReportingPeriodIds": sorted(set(frozen_period_ids)),
        },
        "generatedHistoricalReports": generated_report_count,
    }


async def _ensure_reporting_period(
    db: AsyncSession, month_start: datetime, *, now: datetime
) -> tuple[ReportingPeriod, bool]:
    canonical = monthly_reporting_period(month_start.year, month_start.month)
    existing = await db.scalar(
        select(ReportingPeriod).where(ReportingPeriod.natural_key == canonical.natural_key)
    )
    if existing is not None:
        return existing, False
    status = (
        "scheduled"
        if now < canonical.submission_opens_at
        else "open"
        if now < canonical.submission_closes_at
        else "closed"
    )
    period = ReportingPeriod(
        id=str(uuid5(_MOCK_NAMESPACE, canonical.natural_key)),
        natural_key=canonical.natural_key,
        cadence=canonical.cadence,
        timezone_name=canonical.timezone,
        local_start_date=canonical.local_start_date,
        local_end_date=canonical.local_end_date,
        starts_at=canonical.starts_at,
        ends_at=canonical.ends_at,
        submission_opens_at=canonical.submission_opens_at,
        submission_closes_at=canonical.submission_closes_at,
        status=status,
        label=canonical.label,
    )
    db.add(period)
    await db.flush([period])
    return period, True


async def _ensure_reporting_obligation(
    db: AsyncSession,
    *,
    period: ReportingPeriod,
    enterprise: Enterprise,
    site: EnterpriseSite,
    location: SiteLocationVersion,
) -> tuple[ReportingObligation, bool]:
    existing = await db.scalar(
        select(ReportingObligation).where(
            ReportingObligation.reporting_period_id == period.id,
            ReportingObligation.enterprise_id == enterprise.id,
            ReportingObligation.site_id == site.id,
        )
    )
    if existing is not None:
        return existing, False
    obligation = ReportingObligation(
        reporting_period_id=period.id,
        enterprise_id=enterprise.id,
        site_id=site.id,
        classification="official",
        eligibility_status="eligible",
        eligibility_basis="registry_snapshot",
        frozen_barangay=location.barangay,
        enterprise_official_code=enterprise.official_code,
        enterprise_name=enterprise.name,
        site_code=site.site_code,
        site_name=site.name,
        timezone_name=location.timezone_name,
        registration_effective_at=site.registered_at,
        acceptance_blocked=False,
    )
    db.add(obligation)
    await db.flush([obligation])
    return obligation, True


async def _create_target_mock_camera(
    db: AsyncSession, run_id: str, target: AccountTopology
) -> tuple[EdgeDevice, Camera]:
    device = EdgeDevice(
        site_id=target.site.id,
        classification="official",
        device_key=f"MOCK-TARGET-{run_id[:8]}",
        display_name="Mock Data Report Source",
        device_role="camera_node",
        paired_at=datetime.now(UTC),
    )
    db.add(device)
    await db.flush([device])
    camera = Camera(
        site_id=target.site.id,
        edge_device_id=device.id,
        classification="official",
        camera_key="mock-report-source",
        display_name="Mock Data Main Entrance",
    )
    db.add(camera)
    await db.flush([camera])
    return device, camera


def _mock_metrics(rng: random.Random, *, month_index: int, enterprise_index: int) -> dict[str, int]:
    entries = 430 + month_index * 47 + enterprise_index * 61 + rng.randint(0, 70)
    exits = max(0, entries - rng.randint(8, 45))
    return {
        "entries": entries,
        "exits": exits,
        "peak_occupancy": rng.randint(28, 96),
        "unique_visitor_estimate": max(1, int(entries * rng.uniform(0.62, 0.82))),
    }


async def _submit_mock_report(
    db: AsyncSession,
    *,
    run_id: str,
    account: Account,
    camera: Camera,
    canonical: CanonicalReportingPeriod,
    metrics: dict[str, int],
    sequence_start: int,
    acknowledged_at: datetime,
) -> str:
    identity = f"{run_id}:{account.id}:{canonical.natural_key}"
    command_id = uuid5(_MOCK_NAMESPACE, f"command:{identity}")
    revision_id = uuid5(_MOCK_NAMESPACE, f"revision:{identity}").hex
    event_count = metrics["entries"] + metrics["exits"]
    duration = int((canonical.ends_at - canonical.starts_at).total_seconds())
    demographic_values = _mock_demographics(metrics["unique_visitor_estimate"])
    metric_units = {
        "entries": "events",
        "exits": "events",
        "peak_occupancy": "people-estimate",
        "unique_visitor_estimate": "visitor-estimate",
    }
    command = ReportSubmissionCommand.model_validate(
        {
            "contractVersion": 2,
            "commandId": str(command_id),
            "idempotencyKey": f"report:mockdata-{run_id[:8]}:{revision_id}",
            "occurredAt": canonical.ends_at + timedelta(days=2),
            "expectedVersion": 0,
            "payload": {
                "periodKey": canonical.natural_key,
                "localRevisionId": revision_id,
                "sourceWindow": {
                    "start": canonical.starts_at,
                    "end": canonical.ends_at,
                },
                "sourceBatches": [
                    {
                        "batchId": str(uuid5(_MOCK_NAMESPACE, f"batch:{identity}")),
                        "cameraId": camera.id,
                        "eventCount": event_count,
                        "eventSequenceStart": sequence_start,
                        "eventSequenceEndExclusive": sequence_start + event_count,
                        "aggregateHash": f"sha256:{hashlib.sha256(identity.encode()).hexdigest()}",
                    }
                ],
                "metrics": [
                    {
                        "definition": definition,
                        "definitionVersion": 1,
                        "value": value,
                        "unit": metric_units[definition],
                        "grain": "site",
                        "windowStart": canonical.starts_at,
                        "windowEnd": canonical.ends_at,
                        "timezone": "Asia/Manila",
                        "provenance": "camera_derived",
                        "quality": "confirmed",
                        "coverage": {
                            "evidenceStatus": "recorded",
                            "monitoredSeconds": duration,
                            "expectedSeconds": duration,
                            "gapCount": 0,
                        },
                    }
                    for definition, value in metrics.items()
                ],
                "demographicFacts": [
                    {
                        "dimension": "visitor_origin_and_sex",
                        "value": value,
                        "count": count,
                        "provenance": "operator_entered",
                        "quality": "estimated",
                    }
                    for value, count in demographic_values.items()
                ],
                "coverage": {
                    "evidenceStatus": "recorded",
                    "monitoredSeconds": duration,
                    "expectedSeconds": duration,
                    "gaps": [],
                },
                "notes": "Generated by mockdata-on for workflow testing.",
            },
        }
    )
    acknowledgement = await submit_report_command(
        db,
        account=account,
        command=command,
        acknowledged_at=acknowledged_at,
        enforce_submission_window=False,
    )
    return str(acknowledgement.resource.enterpriseReportId)


def _mock_demographics(unique_count: int) -> dict[str, int]:
    this_province = unique_count * 60 // 100
    other_province = unique_count * 28 // 100
    foreign = unique_count - this_province - other_province
    return {
        "this_province_male": this_province // 2,
        "this_province_female": this_province - this_province // 2,
        "other_province_male": other_province // 2,
        "other_province_female": other_province - other_province // 2,
        "foreign_male": foreign // 2,
        "foreign_female": foreign - foreign // 2,
    }


async def remove_active_simulation_data(db: AsyncSession) -> dict:
    active_runs = (
        await db.scalars(select(SimulationRun).where(SimulationRun.status == "active"))
    ).all()
    run_ids = [run.id for run in active_runs]
    if not run_ids:
        return {"runs": 0}

    # The database keeps official history immutable for every normal request.
    # This transaction-local flag is recognized only by the three immutable
    # triggers needed to purge IDs recorded in the mock-data run manifest.
    await db.execute(text("SET LOCAL tanaw.mockdata_cleanup = 'on'"))

    owned_account_ids = list(
        await db.scalars(
            select(SimulationRunAccount.account_id).where(SimulationRunAccount.run_id.in_(run_ids))
        )
    )
    legacy_simulation_enterprise_ids = list(
        await db.scalars(
            select(Enterprise.id).where(
                Enterprise.classification == "simulation",
                Enterprise.simulation_run_id.in_(run_ids),
            )
        )
    )
    manifests = [_mock_resource_manifest(run.generated_counts_json) for run in active_runs]
    generated_enterprise_ids = _manifest_ids(manifests, "generatedEnterpriseIds")
    report_ids = _manifest_ids(manifests, "reportIds")
    obligation_ids = _manifest_ids(manifests, "obligationIds")
    target_camera_ids = _manifest_ids(manifests, "targetCameraIds")
    target_device_ids = _manifest_ids(manifests, "targetDeviceIds")
    created_period_ids = _manifest_ids(manifests, "createdReportingPeriodIds")
    domain_event_ids = _manifest_ids(manifests, "domainEventIds")
    frozen_period_ids = _manifest_ids(manifests, "frozenReportingPeriodIds")
    await _delete_mock_owned_official_records(
        db,
        owned_account_ids=owned_account_ids,
        generated_enterprise_ids=generated_enterprise_ids,
        report_ids=report_ids,
        obligation_ids=obligation_ids,
        target_camera_ids=target_camera_ids,
        target_device_ids=target_device_ids,
        created_period_ids=created_period_ids,
        domain_event_ids=domain_event_ids,
        frozen_period_ids=frozen_period_ids,
    )
    await _delete_target_simulation_records(db)
    await db.execute(delete(SimulationRunAccount).where(SimulationRunAccount.run_id.in_(run_ids)))
    accounts_result = await db.execute(delete(Account).where(Account.id.in_(owned_account_ids)))
    counts = {
        "generatedEnterprises": len(generated_enterprise_ids)
        + len(legacy_simulation_enterprise_ids),
        "accounts": affected_row_count(accounts_result),
    }
    await db.execute(
        update(SimulationRun)
        .where(SimulationRun.id.in_(run_ids))
        .values(status="removed", ended_at=datetime.now(UTC))
    )
    await db.commit()
    return {"runs": len(run_ids), **counts}


def _mock_resource_manifest(raw_counts: str | None) -> dict[str, Any]:
    if not raw_counts:
        return {}
    parsed = json.loads(raw_counts)
    manifest = parsed.get("mockOwnedResourceIds") if isinstance(parsed, dict) else None
    return manifest if isinstance(manifest, dict) else {}


def _manifest_ids(manifests: list[dict[str, Any]], key: str) -> list[str]:
    return sorted(
        {
            value
            for manifest in manifests
            for value in manifest.get(key, [])
            if isinstance(value, str)
        }
    )


async def _delete_mock_owned_official_records(
    db: AsyncSession,
    *,
    owned_account_ids: list[str],
    generated_enterprise_ids: list[str],
    report_ids: list[str],
    obligation_ids: list[str],
    target_camera_ids: list[str],
    target_device_ids: list[str],
    created_period_ids: list[str],
    domain_event_ids: list[str],
    frozen_period_ids: list[str],
) -> None:
    notification_conditions: list[ColumnElement[bool]] = [
        UserNotification.recipient_account_id.in_(owned_account_ids),
        UserNotification.created_by_account_id.in_(owned_account_ids),
    ]
    if generated_enterprise_ids:
        notification_conditions.append(
            UserNotification.recipient_enterprise_id.in_(generated_enterprise_ids)
        )
    notification_conditions.extend(
        UserNotification.source_id.contains(report_id) for report_id in report_ids
    )
    await db.execute(delete(UserNotification).where(or_(*notification_conditions)))

    generated_site_ids = (
        list(
            await db.scalars(
                select(EnterpriseSite.id).where(
                    EnterpriseSite.enterprise_id.in_(generated_enterprise_ids)
                )
            )
        )
        if generated_enterprise_ids
        else []
    )
    owned_report_ids = set(report_ids)
    if generated_enterprise_ids:
        owned_report_ids.update(
            await db.scalars(
                select(EnterpriseReport.id).where(
                    EnterpriseReport.enterprise_id.in_(generated_enterprise_ids)
                )
            )
        )

    event_conditions: list[str] = []
    parameters: dict[str, Any] = {}
    if generated_enterprise_ids:
        event_conditions.append("event.enterprise_id IN :enterprise_ids")
        parameters["enterprise_ids"] = generated_enterprise_ids
    if owned_report_ids:
        event_conditions.append("event.aggregate_id IN :report_ids")
        parameters["report_ids"] = sorted(owned_report_ids)
    if created_period_ids:
        event_conditions.append("event.aggregate_id IN :period_ids")
        parameters["period_ids"] = created_period_ids
    if domain_event_ids:
        event_conditions.append("event.id IN :event_ids")
        parameters["event_ids"] = domain_event_ids
    if event_conditions:
        event_filter = " OR ".join(event_conditions)
        for statement in (
            "DELETE FROM domain_event_delivery_attempts WHERE domain_event_delivery_id IN "
            f"(SELECT delivery.id FROM domain_event_deliveries delivery JOIN domain_events event ON event.id = delivery.domain_event_id WHERE {event_filter})",
            "DELETE FROM domain_event_consumer_receipts WHERE domain_event_id IN "
            f"(SELECT event.id FROM domain_events event WHERE {event_filter})",
            "DELETE FROM domain_event_deliveries WHERE domain_event_id IN "
            f"(SELECT event.id FROM domain_events event WHERE {event_filter})",
            f"DELETE FROM domain_events event WHERE {event_filter}",
        ):
            await _execute_expanding(db, statement, parameters)

    if owned_report_ids:
        report_parameters = {"report_ids": sorted(owned_report_ids)}
        for statement in (
            "DELETE FROM report_intake_receipts WHERE enterprise_report_id IN :report_ids",
            "DELETE FROM report_review_events WHERE enterprise_report_id IN :report_ids",
            "DELETE FROM report_source_batches WHERE report_revision_id IN "
            "(SELECT id FROM report_revisions WHERE enterprise_report_id IN :report_ids)",
            "DELETE FROM report_demographic_facts WHERE report_revision_id IN "
            "(SELECT id FROM report_revisions WHERE enterprise_report_id IN :report_ids)",
            "DELETE FROM report_metric_facts WHERE report_revision_id IN "
            "(SELECT id FROM report_revisions WHERE enterprise_report_id IN :report_ids)",
            "DELETE FROM report_revisions WHERE enterprise_report_id IN :report_ids",
            "DELETE FROM enterprise_reports WHERE id IN :report_ids",
        ):
            await _execute_expanding(db, statement, report_parameters)

    if obligation_ids:
        await _execute_expanding(
            db,
            "DELETE FROM reporting_obligations WHERE id IN :obligation_ids",
            {"obligation_ids": obligation_ids},
        )

    if generated_site_ids:
        site_parameters = {"site_ids": generated_site_ids}
        for statement in (
            "DELETE FROM site_live_state WHERE site_id IN :site_ids",
            "DELETE FROM site_telemetry_hourly_rollups WHERE site_id IN :site_ids",
            "DELETE FROM device_health_samples WHERE site_id IN :site_ids",
            "DELETE FROM telemetry_metric_facts WHERE telemetry_observation_id IN "
            "(SELECT id FROM telemetry_observations WHERE site_id IN :site_ids)",
            "DELETE FROM telemetry_observations WHERE site_id IN :site_ids",
            "DELETE FROM device_telemetry_epochs WHERE site_id IN :site_ids",
            "DELETE FROM cameras WHERE site_id IN :site_ids",
            "DELETE FROM edge_devices WHERE site_id IN :site_ids",
            "DELETE FROM site_location_versions WHERE site_id IN :site_ids",
            "DELETE FROM enterprise_sites WHERE id IN :site_ids",
        ):
            await _execute_expanding(db, statement, site_parameters)
    if generated_enterprise_ids:
        enterprise_parameters = {"enterprise_ids": generated_enterprise_ids}
        await _execute_expanding(
            db,
            "DELETE FROM enterprise_memberships WHERE enterprise_id IN :enterprise_ids",
            enterprise_parameters,
        )
        await _execute_expanding(
            db,
            "DELETE FROM enterprises WHERE id IN :enterprise_ids",
            enterprise_parameters,
        )
    if target_camera_ids:
        await _execute_expanding(
            db,
            "DELETE FROM cameras WHERE id IN :camera_ids",
            {"camera_ids": target_camera_ids},
        )
    if target_device_ids:
        await _execute_expanding(
            db,
            "DELETE FROM edge_devices WHERE id IN :device_ids",
            {"device_ids": target_device_ids},
        )
    if frozen_period_ids:
        await _execute_expanding(
            db,
            "UPDATE reporting_periods SET obligations_frozen_at = NULL "
            "WHERE id IN :period_ids "
            "AND NOT EXISTS (SELECT 1 FROM reporting_obligations obligation "
            "WHERE obligation.reporting_period_id = reporting_periods.id)",
            {"period_ids": frozen_period_ids},
        )
    if created_period_ids:
        await _execute_expanding(
            db,
            "DELETE FROM reporting_periods WHERE id IN :period_ids "
            "AND NOT EXISTS (SELECT 1 FROM reporting_obligations obligation "
            "WHERE obligation.reporting_period_id = reporting_periods.id)",
            {"period_ids": created_period_ids},
        )


async def _execute_expanding(db: AsyncSession, statement: str, parameters: dict[str, Any]) -> None:
    clause = text(statement)
    for key, value in parameters.items():
        if isinstance(value, list):
            clause = clause.bindparams(bindparam(key, expanding=True))
    await db.execute(clause, parameters)


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
        "DELETE FROM site_location_versions WHERE classification = 'simulation'",
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
