import argparse
import asyncio
import json
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.db.migrations import validate_database_migration_head
from app.db.session import AsyncSessionLocal, engine
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import generate_enterprise_id
from app.features.activity_logs.models import ActivityLog
from app.features.operational.models import (
    EnterpriseReportSubmission,
    EnterpriseTelemetrySnapshot,
    FinalReport,
    FinalReportSource,
    MockDataRun,
)
from app.features.operational.service import generate_final_report_code

TEST_ACCOUNT_PASSWORD = "Visitor simulation access phrase 2026"
DEFAULT_SCENARIO = "full-workflow"
DEFAULT_SEED = "tanaw-testing-v2"
REPORTING_STAFF_NAME = "Carla Mendoza"
DEMOGRAPHIC_FIELDS = (
    "thisProvMale",
    "thisProvFemale",
    "otherProvMale",
    "otherProvFemale",
    "foreignMale",
    "foreignFemale",
)


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
    if requested_target.id != run.target_account_id:
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
    enterprises = await list_active_enterprises(db)
    target = await resolve_target_enterprise(db, target_identifier, accounts["enterprises"])
    run.target_account_id = target.id
    run.target_enterprise_id = target.enterprise_id or target.id
    run.target_enterprise_name = target.enterprise_name or target.display_name
    reports = await create_operational_history(
        db, run.id, range_start, range_end, scenario, rng, enterprises, target
    )
    final_reports = await create_final_reports(db, run.id, reports)
    logs = await create_activity_logs(db, run.id, reports, final_reports)

    counts = {
        "lguAccounts": len(accounts["lgu"]),
        "generatedEnterpriseAccounts": len(accounts["enterprises"]),
        "participatingEnterprises": len(enterprises),
        "telemetrySnapshots": len(reports["telemetry"]),
        "intakeReports": len(reports["reports"]),
        "finalReports": len(final_reports),
        "activityLogs": logs,
        "targetPreparedCounts": reports["targetPreparedCounts"],
        "targetPreparedReportCounts": reports["targetPreparedReportCounts"],
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
            source_kind="mock",
            mock_run_id=run_id,
        )
        db.add(account)
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
            enterprise_name=enterprise.name,
            category=enterprise.category,
            manager_name=enterprise.manager,
            barangay=enterprise.barangay,
            address=enterprise.address,
            latitude=enterprise.latitude,
            longitude=enterprise.longitude,
            location_updated_at=datetime.now(UTC),
            enterprise_id=enterprise_id,
            gateway_id=f"GW-SP-{index:04d}",
            gateway_status="Connected",
            password_hash=password_hash,
            role=AccountRole.ENTERPRISE,
            display_name=enterprise.name,
            title="Enterprise Account",
            status=AccountStatus.ACTIVE,
            activated_at=datetime.now(UTC),
            source_kind="mock",
            mock_run_id=run_id,
        )
        db.add(account)
        enterprise_accounts.append(account)

    await db.flush()
    return {"lgu": lgu_accounts, "enterprises": enterprise_accounts}


def ensure_email_available(existing: Account | None, email: str) -> None:
    if existing is not None:
        raise SystemExit(
            f"Cannot seed mock account {email}; an account with that email already exists."
        )


async def list_active_enterprises(db: AsyncSession) -> list[Account]:
    return list(
        (
            await db.scalars(
                select(Account)
                .where(
                    Account.role == AccountRole.ENTERPRISE,
                    Account.status == AccountStatus.ACTIVE,
                    Account.activated_at.is_not(None),
                )
                .order_by(Account.enterprise_name.asc(), Account.display_name.asc())
            )
        ).all()
    )


async def resolve_target_enterprise(
    db: AsyncSession, identifier: str | None, generated_enterprises: list[Account]
) -> Account:
    if not identifier:
        if not generated_enterprises:
            raise SystemExit("No generated enterprise is available as the default target.")
        return generated_enterprises[0]

    normalized = identifier.strip().lower()
    target = await db.scalar(
        select(Account).where(
            Account.role == AccountRole.ENTERPRISE,
            Account.status == AccountStatus.ACTIVE,
            Account.activated_at.is_not(None),
            or_(
                func.lower(Account.id) == normalized,
                func.lower(Account.email) == normalized,
                func.lower(Account.enterprise_id) == normalized,
                func.lower(Account.enterprise_name) == normalized,
            ),
        )
    )
    if target is None:
        raise SystemExit(f"Target enterprise '{identifier}' was not found or is not active.")
    return target


async def create_operational_history(
    db: AsyncSession,
    run_id: str,
    range_start: datetime,
    range_end: datetime,
    scenario: str,
    rng: random.Random,
    enterprises: list[Account],
    target: Account,
) -> dict:
    reports: list[EnterpriseReportSubmission] = []
    telemetry: list[EnterpriseTelemetrySnapshot] = []
    months = month_starts(range_start, range_end)
    current_month = months[-1]
    target_prepared_counts: list[dict[str, int | str]] = []

    for month_index, month_start in enumerate(months):
        period = period_label(month_start)
        month_name = month_start.strftime("%B")
        for enterprise_index, enterprise in enumerate(enterprises):
            base_entries = 460 + month_index * 42 + enterprise_index * 67 + rng.randint(0, 80)
            if (
                scenario == "peak-traffic"
                and enterprise_index == 0
                and month_start == current_month
            ):
                base_entries *= 2
            exits = max(0, base_entries - rng.randint(8, 55))
            unique_count = max(1, int(base_entries * rng.uniform(0.62, 0.82)))
            peak = max(8, rng.randint(24, 96))
            current_occupancy = max(0, base_entries - exits)
            submitted_at = month_start.replace(
                day=min(18 + enterprise_index, 24), hour=9 + enterprise_index, minute=15
            )
            should_skip = should_skip_target_report(
                month_start, current_month, enterprise.id, target.id
            )
            if should_skip:
                target_prepared_counts.append(
                    {
                        "entries": base_entries,
                        "exits": exits,
                        "uniqueCount": unique_count,
                        "peakOccupancy": peak,
                        "period": period,
                    }
                )

            demographics = build_demographic_breakdown(unique_count, enterprise_index, month_index)

            snapshot = EnterpriseTelemetrySnapshot(
                enterprise_account_id=enterprise.id,
                enterprise_id=enterprise.enterprise_id or enterprise.id,
                enterprise_name=enterprise.enterprise_name or enterprise.display_name,
                camera_id=f"camera-{enterprise_index + 1}",
                camera_name=f"{enterprise.enterprise_name} Main Entrance",
                captured_at=latest_capture_time(month_start, range_end),
                entries=base_entries,
                exits=exits,
                current_occupancy=current_occupancy,
                peak_occupancy=peak,
                unique_count=unique_count,
                confirmed_unique_count=int(unique_count * 0.86),
                degraded_unique_count=unique_count - int(unique_count * 0.86),
                total_events=base_entries + exits,
                unsubmitted_events=0 if not should_skip else base_entries + exits,
                unsynced_events=12 if scenario == "camera-health" and enterprise_index == 1 else 0,
                running=month_start == current_month,
                status="error"
                if scenario == "camera-health"
                and enterprise_index == 2
                and month_start == current_month
                else "running",
                error="Desktop app synchronization delayed. Retrying automatically."
                if scenario == "camera-health"
                and enterprise_index == 2
                and month_start == current_month
                else None,
                analytics_fps=8.0 + rng.random() * 5.0,
                payload_json=json.dumps(
                    {"source": "desktop-camera", "period": period}, sort_keys=True
                ),
                source_kind="mock",
                mock_run_id=run_id,
            )
            db.add(snapshot)
            telemetry.append(snapshot)

            if should_skip:
                continue

            review_status = seeded_review_status(month_start, current_month)

            report = EnterpriseReportSubmission(
                report_id=f"REP-{month_start:%y%m}{enterprise_index + 1:02d}",
                enterprise_account_id=enterprise.id,
                enterprise_id=enterprise.enterprise_id or enterprise.id,
                enterprise_name=enterprise.enterprise_name or enterprise.display_name,
                category=category_label(enterprise.category),
                barangay=enterprise.barangay,
                period=period,
                month=month_name,
                submitted_at=submitted_at,
                entries=base_entries,
                exits=exits,
                peak_occupancy=peak,
                unique_count=unique_count,
                status="Submitted",
                review_status=review_status,
                notes="Monthly visitor count submitted for LGU review.",
                remarks="Please verify the entry and exit variance before resubmission."
                if review_status == "Returned"
                else None,
                sync_status="synced",
                payload_json=json.dumps(
                    {
                        "demo": demographics,
                        "metrics": {
                            "entries": base_entries,
                            "exits": exits,
                            "peak": peak,
                            "unique": unique_count,
                        },
                        "period": period,
                        "source": "desktop-reporting",
                        "status": "Submitted",
                    },
                    sort_keys=True,
                ),
                source_kind="mock",
                mock_run_id=run_id,
            )
            db.add(report)
            reports.append(report)

    await db.flush()
    if not target_prepared_counts:
        raise SystemExit(
            "The target enterprise did not receive prepared count packages for the reporting scenario."
        )
    return {
        "reports": reports,
        "telemetry": telemetry,
        "targetPreparedCounts": target_prepared_counts[0],
        "targetPreparedReportCounts": target_prepared_counts,
    }


def build_demographic_breakdown(
    unique_count: int, enterprise_index: int, month_index: int
) -> dict[str, str]:
    this_province_share = 58 + (enterprise_index % 4) * 2
    other_province_share = 27 + (month_index % 3) * 2
    this_province_total = unique_count * this_province_share // 100
    other_province_total = unique_count * other_province_share // 100
    if this_province_total + other_province_total > unique_count:
        other_province_total = max(0, unique_count - this_province_total)
    foreign_total = unique_count - this_province_total - other_province_total

    this_prov_male, this_prov_female = split_gender(
        this_province_total, 48 + ((enterprise_index + month_index) % 5)
    )
    other_prov_male, other_prov_female = split_gender(
        other_province_total, 49 + ((enterprise_index * 2 + month_index) % 4)
    )
    foreign_male, foreign_female = split_gender(
        foreign_total, 52 + ((enterprise_index + month_index * 2) % 4)
    )
    return {
        "thisProvMale": str(this_prov_male),
        "thisProvFemale": str(this_prov_female),
        "otherProvMale": str(other_prov_male),
        "otherProvFemale": str(other_prov_female),
        "foreignMale": str(foreign_male),
        "foreignFemale": str(foreign_female),
    }


def split_gender(total: int, male_percent: int) -> tuple[int, int]:
    male = max(0, min(total, total * male_percent // 100))
    return male, total - male


async def create_final_reports(db: AsyncSession, run_id: str, history: dict) -> list[FinalReport]:
    reports_by_period: dict[str, list[EnterpriseReportSubmission]] = {}
    for report in history["reports"]:
        if report.review_status == "Consolidated":
            reports_by_period.setdefault(f"{report.month} {report.submitted_at.year}", []).append(
                report
            )

    final_reports: list[FinalReport] = []
    for period, reports in sorted(reports_by_period.items()):
        final_report = FinalReport(
            report_code=await generate_final_report_code(db, period),
            title="Citywide Tourism Aggregation",
            period=period,
            generated_on=max(report.submitted_at for report in reports) + timedelta(days=2),
            prepared_by=REPORTING_STAFF_NAME,
            prepared_role="Staff Processing Division",
            status="Finalized",
            total_entry=sum(report.entries for report in reports),
            total_exit=sum(report.exits for report in reports),
            total_unique=sum(report.unique_count for report in reports),
            enterprise_count=len({report.enterprise_id for report in reports}),
            source_kind="mock",
            mock_run_id=run_id,
        )
        db.add(final_report)
        await db.flush()
        for report in reports:
            db.add(
                FinalReportSource(
                    final_report_id=final_report.id,
                    intake_report_id=report.id,
                    enterprise_id=report.enterprise_id,
                    enterprise=report.enterprise_name,
                    code=report.report_id,
                    unique_count=report.unique_count,
                    entries=report.entries,
                    exits=report.exits,
                )
            )
        final_reports.append(final_report)
    await db.flush()
    return final_reports


async def create_activity_logs(
    db: AsyncSession, run_id: str, history: dict, final_reports: list[FinalReport]
) -> int:
    count = 0
    for report in history["reports"]:
        db.add(
            ActivityLog(
                timestamp=report.submitted_at,
                category="Staff Submission",
                severity="Success",
                actor=report.enterprise_name,
                actor_role="Enterprise Account",
                action="Submit Enterprise Report",
                target=report.enterprise_name,
                summary=f"{report.enterprise_name} submitted {report.report_id} for {report.period}.",
                source_id=report.id,
                metadata_json=json.dumps(
                    {"enterpriseId": report.enterprise_id, "period": report.period}, sort_keys=True
                ),
                source_kind="mock",
                mock_run_id=run_id,
            )
        )
        count += 1
    for final_report in final_reports:
        db.add(
            ActivityLog(
                timestamp=final_report.generated_on,
                category="Staff Operation",
                severity="Success",
                actor=REPORTING_STAFF_NAME,
                actor_role="LGU Staff",
                action="Generate Final Report",
                target=final_report.report_code,
                summary=f"{REPORTING_STAFF_NAME} generated {final_report.report_code} for {final_report.period}.",
                source_id=final_report.report_code,
                metadata_json=json.dumps(
                    {"period": final_report.period, "reportCount": final_report.enterprise_count},
                    sort_keys=True,
                ),
                source_kind="mock",
                mock_run_id=run_id,
            )
        )
        count += 1
    await db.flush()
    return count


async def remove_active_mock_data(db: AsyncSession) -> dict:
    active_runs = (
        await db.scalars(select(MockDataRun).where(MockDataRun.status == "active"))
    ).all()
    run_ids = [run.id for run in active_runs]
    if not run_ids:
        return {"runs": 0}

    final_report_ids = list(
        await db.scalars(select(FinalReport.id).where(FinalReport.mock_run_id.in_(run_ids)))
    )
    if final_report_ids:
        await db.execute(
            delete(FinalReportSource).where(FinalReportSource.final_report_id.in_(final_report_ids))
        )
    final_reports_result = await db.execute(
        delete(FinalReport).where(FinalReport.mock_run_id.in_(run_ids))
    )
    intake_reports_result = await db.execute(
        delete(EnterpriseReportSubmission).where(
            EnterpriseReportSubmission.mock_run_id.in_(run_ids)
        )
    )
    telemetry_snapshots_result = await db.execute(
        delete(EnterpriseTelemetrySnapshot).where(
            EnterpriseTelemetrySnapshot.mock_run_id.in_(run_ids)
        )
    )
    activity_logs_result = await db.execute(
        delete(ActivityLog).where(ActivityLog.mock_run_id.in_(run_ids))
    )
    accounts_result = await db.execute(delete(Account).where(Account.mock_run_id.in_(run_ids)))
    counts = {
        "finalReportSources": len(final_report_ids),
        "finalReports": affected_row_count(final_reports_result),
        "intakeReports": affected_row_count(intake_reports_result),
        "telemetrySnapshots": affected_row_count(telemetry_snapshots_result),
        "activityLogs": affected_row_count(activity_logs_result),
        "accounts": affected_row_count(accounts_result),
    }
    await db.execute(
        update(MockDataRun)
        .where(MockDataRun.id.in_(run_ids))
        .values(status="removed", ended_at=datetime.now(UTC))
    )
    await db.commit()
    return {"runs": len(run_ids), **counts}


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


def latest_capture_time(month_start: datetime, range_end: datetime) -> datetime:
    if month_start.year == range_end.year and month_start.month == range_end.month:
        return range_end
    return add_months(month_start, 1) - timedelta(hours=12)


def category_label(value: str | None) -> str:
    return {"events venue": "Events Venue", "tourism": "Tourism", "business": "Business"}.get(
        value or "", "Uncategorized"
    )


def should_skip_target_report(
    month_start: datetime,
    current_month: datetime,
    enterprise_account_id: str,
    target_account_id: str,
) -> bool:
    previous_month = add_months(current_month, -1)
    return enterprise_account_id == target_account_id and month_start in {
        previous_month,
        current_month,
    }


def seeded_review_status(month_start: datetime, current_month: datetime) -> str:
    previous_month = add_months(current_month, -1)
    return (
        "Ready to Consolidate" if month_start in {previous_month, current_month} else "Consolidated"
    )


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
                json={
                    "mock_run_id": result["runId"],
                    "enterprise_id": enterprise_id,
                    "enterprise_name": target.get("enterpriseName"),
                    "entries": prepared["entries"],
                    "exits": prepared["exits"],
                    "unique_count": prepared["uniqueCount"],
                    "peak_occupancy": prepared["peakOccupancy"],
                    "period": prepared["period"],
                },
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
