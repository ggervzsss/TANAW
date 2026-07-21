import argparse
import asyncio
import json
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid5

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.db.migrations import validate_database_migration_head
from app.db.session import AsyncSessionLocal, engine
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.accounts.service import generate_enterprise_id
from app.features.activity_logs.models import ActivityLog
from app.features.operational.models import (
    EnterpriseReportSubmission,
    EnterpriseTelemetrySnapshot,
    FinalReport,
    FinalReportSource,
    OperationalAlert,
    SupportTicket,
    UserNotification,
)
from app.features.operational.service import (
    STAFF_REPORT_RESUBMITTED_NOTIFICATION,
    STAFF_REPORT_SUBMITTED_NOTIFICATION,
)
from app.features.sample_data.dataset import (
    SAMPLE_ACCOUNT_EMAILS,
    SAMPLE_CAMERA_PREFIX,
    SAMPLE_DATASET_VERSION,
    SAMPLE_FINAL_REPORT_PREFIX,
    SAMPLE_REPORT_PREFIX,
    SAMPLE_SOURCE_PREFIX,
    prepared_counts,
    sample_dataset_marker_email,
)

TEST_ACCOUNT_PASSWORD = "Visitor sample access phrase 2026"
DEFAULT_SCENARIO = "full-workflow"
DEFAULT_SEED = "tanaw-sample-v1"
REPORTING_STAFF_NAME = "Carla Mendoza"
SAMPLE_UUID_NAMESPACE = UUID("b8df7e73-013f-4d10-8554-e8d54f90086f")
DEMOGRAPHIC_FIELDS = (
    "thisProvMale",
    "thisProvFemale",
    "otherProvMale",
    "otherProvFemale",
    "foreignMale",
    "foreignFemale",
)


@dataclass(frozen=True)
class SampleEnterprise:
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
    SampleEnterprise(
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
    SampleEnterprise(
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
    SampleEnterprise(
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
    SampleEnterprise(
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
    SampleEnterprise(
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
    parser = argparse.ArgumentParser(description="Manage deterministic TANAW sample data.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    on_parser = subparsers.add_parser("on", help="Generate sample data.")
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

    subparsers.add_parser("off", help="Remove the deterministic sample dataset.")

    subparsers.add_parser("status", help="Show sample-data status.")

    reset_parser = subparsers.add_parser(
        "reset", help="Remove and regenerate the deterministic sample dataset."
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
            result = await sample_dataset_status(db)
        print(json.dumps(result, indent=2, sort_keys=True))
        return

    require_development_environment()

    if args.command == "off":
        async with AsyncSessionLocal() as db:
            removed = await remove_sample_data(db)
        print(json.dumps({"removed": removed}, indent=2, sort_keys=True))
        return

    if args.command == "reset":
        async with AsyncSessionLocal() as db:
            removed = await remove_sample_data(db)
            created = await generate_sample_data(
                db, args.range, args.scenario, args.seed, args.target_enterprise
            )
        print(json.dumps({"removed": removed, "created": created}, indent=2, sort_keys=True))
        return

    async with AsyncSessionLocal() as db:
        if await sample_dataset_present(db):
            raise SystemExit(
                "Sample data already exists. Run mockdata-off or mockdata-reset first."
            )
        result = await generate_sample_data(
            db, args.range, args.scenario, args.seed, args.target_enterprise
        )
    print(json.dumps(result, indent=2, sort_keys=True))


async def validate_schema() -> None:
    async with engine.connect() as connection:
        await validate_database_migration_head(connection)


def require_development_environment() -> None:
    if get_settings().is_production:
        raise SystemExit("Refusing to manage sample data in production.")


async def sample_dataset_present(db: AsyncSession) -> bool:
    return (
        await db.scalar(select(Account.id).where(Account.email == sample_dataset_marker_email()))
        is not None
    )


async def sample_dataset_status(db: AsyncSession) -> dict:
    accounts = list(
        await db.scalars(select(Account.email).where(Account.email.in_(SAMPLE_ACCOUNT_EMAILS)))
    )
    return {
        "active": bool(accounts),
        "sampleAccounts": sorted(accounts),
        "expectedSampleAccounts": len(SAMPLE_ACCOUNT_EMAILS),
    }


async def generate_sample_data(
    db: AsyncSession, range_value: str, scenario: str, seed: str, target_identifier: str | None
) -> dict:
    rng = random.Random(seed)
    range_start, range_end = reporting_range(range_value)
    accounts = await create_accounts(db)
    target = await resolve_target_enterprise(db, target_identifier, accounts["enterprises"])
    target_profile = target.enterprise_profile
    if target_profile is None:
        raise SystemExit("The selected target account has no enterprise profile.")
    enterprises = [target, *accounts["enterprises"]]
    reports = await create_operational_history(
        db, range_start, range_end, scenario, rng, enterprises, target
    )
    operations = await create_admin_operations_data(
        db,
        accounts["lgu"],
        accounts["enterprises"],
        range_end,
    )
    notifications = await create_staff_report_notifications(
        db, accounts["lgu"], reports["staffNotificationReports"]
    )
    final_reports = await create_final_reports(db, reports)
    logs = await create_activity_logs(db, reports, final_reports)

    counts = {
        "lguAccounts": len(accounts["lgu"]),
        "generatedEnterpriseAccounts": len(accounts["enterprises"]),
        "participatingEnterprises": len(enterprises),
        "telemetrySnapshots": len(reports["telemetry"]),
        "intakeReports": len(reports["reports"]),
        "finalReports": len(final_reports),
        "staffNotifications": notifications,
        "adminNotifications": operations["adminNotifications"],
        "itNotifications": operations["itNotifications"],
        "operationalAlerts": operations["operationalAlerts"],
        "supportTickets": operations["supportTickets"],
        "activityLogs": logs,
        "targetPreparedReportCounts": prepared_counts(target_profile.enterprise_id),
    }
    await db.commit()
    return {
        "status": "created",
        "scenario": scenario,
        "rangeStart": range_start.isoformat(),
        "rangeEnd": range_end.isoformat(),
        "target": {
            "accountId": target.id,
            "enterpriseId": target_profile.enterprise_id,
            "enterpriseName": target_profile.enterprise_name,
        },
        "counts": counts,
    }


async def create_accounts(db: AsyncSession) -> dict[str, list[Account]]:
    password_hash = hash_password(validate_password_policy(TEST_ACCOUNT_PASSWORD))
    lgu_accounts: list[Account] = []
    for email, role, display_name, title, first_name, last_name in LGU_ACCOUNTS:
        ensure_email_available(
            await db.scalar(select(Account).where(Account.email == email)), email
        )
        account = Account(
            id=sample_uuid("account", email),
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
        lgu_accounts.append(account)

    enterprise_accounts: list[Account] = []
    for index, enterprise in enumerate(ENTERPRISES, start=1):
        ensure_email_available(
            await db.scalar(select(Account).where(Account.email == enterprise.email)),
            enterprise.email,
        )
        enterprise_id = await generate_enterprise_id(db, enterprise.name)
        account = Account(
            id=sample_uuid("account", enterprise.email),
            email=enterprise.email,
            phone=enterprise.phone,
            password_hash=password_hash,
            role=AccountRole.ENTERPRISE,
            display_name=enterprise.name,
            title="Enterprise Account",
            status=AccountStatus.ACTIVE,
            activated_at=datetime.now(UTC),
            enterprise_profile=EnterpriseProfile(
                enterprise_name=enterprise.name,
                category=enterprise.category,
                manager_name=enterprise.manager,
                barangay=enterprise.barangay,
                address=enterprise.address,
                latitude=enterprise.latitude,
                longitude=enterprise.longitude,
                location_updated_at=datetime.now(UTC),
                enterprise_id=enterprise_id,
                building_capacity=180 + index * 40,
                gateway_id=f"GW-SP-{index:04d}",
                gateway_status="Connected",
            ),
        )
        if index == 3:
            account.preferences_json = json.dumps(
                {
                    "pendingContactNumberChange": {
                        "phone": "+639171119999",
                        "requestedAt": datetime.now(UTC).isoformat(),
                    }
                },
                sort_keys=True,
            )
        db.add(account)
        enterprise_accounts.append(account)

    await db.flush()
    return {"lgu": lgu_accounts, "enterprises": enterprise_accounts}


async def create_admin_operations_data(
    db: AsyncSession,
    lgu_accounts: list[Account],
    enterprises: list[Account],
    range_end: datetime,
) -> dict[str, int]:
    admin = next(account for account in lgu_accounts if account.role == AccountRole.ADMIN)
    it_account = next(account for account in lgu_accounts if account.role == AccountRole.IT)
    if len(enterprises) < 3:
        raise SystemExit("At least three generated enterprises are required for operations data.")

    busy_enterprise, support_enterprise, routine_support_enterprise = enterprises[:3]
    busy_profile = busy_enterprise.enterprise_profile
    support_profile = support_enterprise.enterprise_profile
    routine_support_profile = routine_support_enterprise.enterprise_profile
    if busy_profile is None or support_profile is None or routine_support_profile is None:
        raise SystemExit("Sample operations data requires enterprise profiles.")

    alert_created_at = range_end - timedelta(minutes=18)
    alert = OperationalAlert(
        id=sample_uuid("operations-alert", busy_enterprise.id),
        alert_code="ALT-SAMPLE-001",
        alert_type="Threshold Breach",
        severity="Critical",
        enterprise=busy_profile.enterprise_name,
        requester=busy_profile.enterprise_name,
        summary=(
            f"Live occupancy reached {busy_profile.building_capacity - 5} of "
            f"{busy_profile.building_capacity} people and is close to the establishment capacity."
        ),
        required_action="Review the live map and apply the establishment's crowd-management procedure.",
        resolution_mode="Admin Monitoring",
        status="New",
        owner="Admin",
        source_id=f"{SAMPLE_SOURCE_PREFIX}operations:occupancy:{busy_enterprise.id}",
        created_at=alert_created_at,
        updated_at=alert_created_at,
    )
    db.add(alert)

    high_ticket_created_at = range_end - timedelta(hours=2)
    high_ticket = SupportTicket(
        id=sample_uuid("operations-ticket", support_enterprise.id, "high"),
        ticket_code="TCK-SAMPLE-001",
        enterprise_profile_id=support_enterprise.id,
        enterprise_name=support_profile.enterprise_name,
        category="Camera Issue",
        priority="High",
        subject="Entrance camera has an intermittent view",
        description=(
            "The entrance camera view becomes unavailable several times during operating hours."
        ),
        affected_area="Main entrance",
        camera_node="Entrance Camera",
        status="In Review",
        created_at=high_ticket_created_at,
        updated_at=range_end - timedelta(hours=1),
    )
    routine_ticket = SupportTicket(
        id=sample_uuid("operations-ticket", routine_support_enterprise.id, "normal"),
        ticket_code="TCK-SAMPLE-002",
        enterprise_profile_id=routine_support_enterprise.id,
        enterprise_name=routine_support_profile.enterprise_name,
        category="Report Concern",
        priority="Normal",
        subject="Question about the monthly report notes",
        description="The enterprise requested guidance on the notes included in its report.",
        affected_area="Reports",
        status="Open",
        created_at=range_end - timedelta(hours=5),
        updated_at=range_end - timedelta(hours=5),
    )
    db.add_all([high_ticket, routine_ticket])

    admin_notifications = [
        UserNotification(
            id=sample_uuid("operations-notification", admin.id, alert.id),
            recipient_account_id=admin.id,
            recipient_role=admin.role.value,
            title=f"{busy_profile.enterprise_name} needs attention.",
            message=alert.summary,
            notification_type="Crowd Level Alert",
            severity="Critical",
            source_type="operational.alert",
            source_id=alert.alert_code,
            created_by_account_id=busy_enterprise.id,
            created_by_name=busy_profile.enterprise_name,
            created_at=alert_created_at,
        ),
        UserNotification(
            id=sample_uuid("operations-notification", admin.id, high_ticket.id),
            recipient_account_id=admin.id,
            recipient_role=admin.role.value,
            title=f"{support_profile.enterprise_name} submitted an important support request.",
            message=f"{high_ticket.subject}. IT is reviewing the request.",
            notification_type="Enterprise Support Ticket",
            severity="Warning",
            source_type="support.ticket",
            source_id=high_ticket.id,
            created_by_account_id=support_enterprise.id,
            created_by_name=support_profile.enterprise_name,
            created_at=high_ticket_created_at,
        ),
    ]
    it_notifications = [
        UserNotification(
            id=sample_uuid("operations-notification", it_account.id, ticket.id),
            recipient_account_id=it_account.id,
            recipient_role=it_account.role.value,
            title=f"{ticket.enterprise_name} submitted support ticket {ticket.ticket_code}.",
            message=ticket.subject,
            notification_type="Enterprise Support Ticket",
            severity="Warning" if ticket.priority == "High" else "Info",
            source_type="support.ticket",
            source_id=ticket.id,
            created_by_account_id=ticket.enterprise_profile_id,
            created_by_name=ticket.enterprise_name,
            created_at=ticket.created_at,
        )
        for ticket in (high_ticket, routine_ticket)
    ]
    db.add_all([*admin_notifications, *it_notifications])
    await db.flush()
    return {
        "adminNotifications": len(admin_notifications),
        "itNotifications": len(it_notifications),
        "operationalAlerts": 1,
        "supportTickets": 2,
    }


def ensure_email_available(existing: Account | None, email: str) -> None:
    if existing is not None:
        raise SystemExit(
            f"Cannot create sample account {email}; an account with that email already exists."
        )


async def list_active_enterprises(db: AsyncSession) -> list[Account]:
    return list(
        (
            await db.scalars(
                select(Account)
                .join(Account.enterprise_profile)
                .where(
                    Account.role == AccountRole.ENTERPRISE,
                    Account.status == AccountStatus.ACTIVE,
                    Account.activated_at.is_not(None),
                )
                .order_by(EnterpriseProfile.enterprise_name.asc(), Account.display_name.asc())
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
        select(Account)
        .join(Account.enterprise_profile)
        .where(
            Account.role == AccountRole.ENTERPRISE,
            Account.status == AccountStatus.ACTIVE,
            Account.activated_at.is_not(None),
            or_(
                func.lower(Account.id) == normalized,
                func.lower(Account.email) == normalized,
                func.lower(EnterpriseProfile.enterprise_id) == normalized,
                func.lower(EnterpriseProfile.enterprise_name) == normalized,
            ),
        )
    )
    if target is None:
        raise SystemExit(f"Target enterprise '{identifier}' was not found or is not active.")
    return target


async def create_operational_history(
    db: AsyncSession,
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
            profile = enterprise.enterprise_profile
            if profile is None:
                raise SystemExit("A sample enterprise account has no enterprise profile.")
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
                id=sample_uuid(
                    "telemetry",
                    profile.account_id,
                    month_start.isoformat(),
                ),
                enterprise_profile_id=profile.account_id,
                enterprise_name=profile.enterprise_name,
                camera_id=f"{SAMPLE_CAMERA_PREFIX}{enterprise_index + 1}",
                camera_name=f"{profile.enterprise_name} Main Entrance",
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
                error="Desktop app updates delayed. Retrying automatically."
                if scenario == "camera-health"
                and enterprise_index == 2
                and month_start == current_month
                else None,
                analytics_fps=8.0 + rng.random() * 5.0,
                payload_json=json.dumps(
                    {"source": "desktop-camera", "period": period}, sort_keys=True
                ),
            )
            db.add(snapshot)
            telemetry.append(snapshot)

            if should_skip:
                continue

            review_status = seeded_review_status(month_start, current_month)

            report = EnterpriseReportSubmission(
                id=sample_uuid(
                    "report",
                    profile.account_id,
                    month_start.isoformat(),
                ),
                report_id=(f"{SAMPLE_REPORT_PREFIX}{month_start:%y%m}{enterprise_index + 1:02d}"),
                enterprise_profile_id=profile.account_id,
                enterprise_name=profile.enterprise_name,
                category=category_label(profile.category),
                barangay=profile.barangay,
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
            )
            db.add(report)
            reports.append(report)

    staff_notification_reports = prepare_staff_notification_reports(reports, current_month)
    await db.flush()
    if not target_prepared_counts:
        raise SystemExit(
            "The target enterprise did not receive prepared count packages for the reporting scenario."
        )
    return {
        "reports": reports,
        "staffNotificationReports": staff_notification_reports,
        "telemetry": telemetry,
        "targetPreparedReportCounts": target_prepared_counts,
    }


def prepare_staff_notification_reports(
    reports: list[EnterpriseReportSubmission], current_month: datetime
) -> list[tuple[EnterpriseReportSubmission, str]]:
    candidates = [
        report
        for report in reports
        if report.submitted_at.year == current_month.year
        and report.submitted_at.month == current_month.month
    ][:2]
    prepared: list[tuple[EnterpriseReportSubmission, str]] = []

    for index, report in enumerate(candidates):
        is_resubmission = index == 1
        notification_type = (
            STAFF_REPORT_RESUBMITTED_NOTIFICATION
            if is_resubmission
            else STAFF_REPORT_SUBMITTED_NOTIFICATION
        )
        payload = json.loads(report.payload_json or "{}")
        payload["status"] = "Resubmitted" if is_resubmission else "Submitted"
        report.payload_json = json.dumps(payload, sort_keys=True)
        report.review_status = "Pending Review"
        report.notes = (
            "Revised monthly visitor count resubmitted for LGU review."
            if is_resubmission
            else "Monthly visitor count submitted for LGU review."
        )
        report.remarks = None
        prepared.append((report, notification_type))

    return prepared


async def create_staff_report_notifications(
    db: AsyncSession,
    lgu_accounts: list[Account],
    report_notifications: list[tuple[EnterpriseReportSubmission, str]],
) -> int:
    staff_accounts = [account for account in lgu_accounts if account.role == AccountRole.STAFF]
    count = 0
    for staff_account in staff_accounts:
        for report, notification_type in report_notifications:
            action_label = (
                "resubmitted"
                if notification_type == STAFF_REPORT_RESUBMITTED_NOTIFICATION
                else "submitted"
            )
            db.add(
                UserNotification(
                    id=sample_uuid(
                        "notification",
                        staff_account.id,
                        report.id,
                        notification_type,
                    ),
                    recipient_account_id=staff_account.id,
                    recipient_role=staff_account.role.value,
                    title=notification_type,
                    message=(
                        f"{report.enterprise_name} {action_label} "
                        f"{report.report_id} for {report.period}."
                    ),
                    notification_type=notification_type,
                    severity="Info",
                    source_type="enterprise.report",
                    source_id=report.id,
                    created_by_account_id=report.enterprise_profile_id,
                    created_by_name=report.enterprise_name,
                    created_at=report.submitted_at,
                )
            )
            count += 1
    await db.flush()
    return count


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


async def create_final_reports(db: AsyncSession, history: dict) -> list[FinalReport]:
    reports_by_period: dict[str, list[EnterpriseReportSubmission]] = {}
    for report in history["reports"]:
        if report.review_status == "Consolidated":
            reports_by_period.setdefault(f"{report.month} {report.submitted_at.year}", []).append(
                report
            )

    final_reports: list[FinalReport] = []
    for period, reports in sorted(reports_by_period.items()):
        final_report = FinalReport(
            id=sample_uuid("final-report", period),
            report_code=f"{SAMPLE_FINAL_REPORT_PREFIX}{period.replace(' ', '-').upper()}",
            title="Citywide Tourism Aggregation",
            period=period,
            generated_on=max(report.submitted_at for report in reports) + timedelta(days=2),
            prepared_by=REPORTING_STAFF_NAME,
            prepared_role="Staff Processing Division",
            status="Finalized",
            total_entry=sum(report.entries for report in reports),
            total_exit=sum(report.exits for report in reports),
            total_unique=sum(report.unique_count for report in reports),
            enterprise_count=len({report.enterprise_profile_id for report in reports}),
        )
        db.add(final_report)
        await db.flush()
        for report in reports:
            db.add(
                FinalReportSource(
                    id=sample_uuid("final-report-source", final_report.id, report.id),
                    final_report_id=final_report.id,
                    intake_report_id=report.id,
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
    db: AsyncSession, history: dict, final_reports: list[FinalReport]
) -> int:
    count = 0
    for report in history["reports"]:
        db.add(
            ActivityLog(
                id=sample_uuid("activity-report", report.id),
                timestamp=report.submitted_at,
                category="Staff Submission",
                severity="Success",
                actor=report.enterprise_name,
                actor_role="Enterprise Account",
                action="Submit Enterprise Report",
                target=report.enterprise_name,
                summary=f"{report.enterprise_name} submitted {report.report_id} for {report.period}.",
                source_id=f"{SAMPLE_SOURCE_PREFIX}report:{report.id}",
                metadata_json=json.dumps(
                    {
                        "enterpriseId": report.enterprise_profile.enterprise_id,
                        "period": report.period,
                    },
                    sort_keys=True,
                ),
            )
        )
        count += 1
    for final_report in final_reports:
        db.add(
            ActivityLog(
                id=sample_uuid("activity-final-report", final_report.id),
                timestamp=final_report.generated_on,
                category="Staff Operation",
                severity="Success",
                actor=REPORTING_STAFF_NAME,
                actor_role="LGU Staff",
                action="Generate Final Report",
                target=final_report.report_code,
                summary=f"{REPORTING_STAFF_NAME} generated {final_report.report_code} for {final_report.period}.",
                source_id=f"{SAMPLE_SOURCE_PREFIX}final-report:{final_report.id}",
                metadata_json=json.dumps(
                    {"period": final_report.period, "reportCount": final_report.enterprise_count},
                    sort_keys=True,
                ),
            )
        )
        count += 1
    await db.flush()
    return count


async def remove_sample_data(db: AsyncSession) -> dict:
    account_ids = list(
        await db.scalars(select(Account.id).where(Account.email.in_(SAMPLE_ACCOUNT_EMAILS)))
    )
    intake_report_ids = list(
        await db.scalars(
            select(EnterpriseReportSubmission.id).where(
                EnterpriseReportSubmission.report_id.startswith(SAMPLE_REPORT_PREFIX)
            )
        )
    )
    final_report_ids = list(
        await db.scalars(
            select(FinalReport.id)
            .outerjoin(FinalReportSource, FinalReportSource.final_report_id == FinalReport.id)
            .where(
                (FinalReport.report_code.startswith(SAMPLE_FINAL_REPORT_PREFIX))
                | (FinalReportSource.intake_report_id.in_(intake_report_ids))
            )
            .distinct()
        )
    )
    notification_filters = [
        UserNotification.source_id.in_(intake_report_ids),
        UserNotification.recipient_account_id.in_(account_ids),
        UserNotification.created_by_account_id.in_(account_ids),
    ]
    notifications_result = await db.execute(
        delete(UserNotification).where(or_(*notification_filters))
    )
    if final_report_ids:
        await db.execute(
            delete(FinalReportSource).where(FinalReportSource.final_report_id.in_(final_report_ids))
        )
    final_reports_result = await db.execute(
        delete(FinalReport).where(FinalReport.id.in_(final_report_ids))
    )
    intake_reports_result = await db.execute(
        delete(EnterpriseReportSubmission).where(
            EnterpriseReportSubmission.id.in_(intake_report_ids)
        )
    )
    telemetry_snapshots_result = await db.execute(
        delete(EnterpriseTelemetrySnapshot).where(
            EnterpriseTelemetrySnapshot.camera_id.startswith(SAMPLE_CAMERA_PREFIX)
            | EnterpriseTelemetrySnapshot.enterprise_profile_id.in_(account_ids)
        )
    )
    activity_logs_result = await db.execute(
        delete(ActivityLog).where(
            ActivityLog.source_id.startswith(SAMPLE_SOURCE_PREFIX)
            | ActivityLog.source_id.in_(intake_report_ids)
            | ActivityLog.source_id.in_(final_report_ids)
        )
    )
    alerts_result = await db.execute(
        delete(OperationalAlert).where(
            OperationalAlert.source_id.startswith(SAMPLE_SOURCE_PREFIX)
            | OperationalAlert.source_id.in_(
                [f"occupancy-threshold:{account_id}" for account_id in account_ids]
            )
        )
    )
    tickets_result = await db.execute(
        delete(SupportTicket).where(SupportTicket.enterprise_profile_id.in_(account_ids))
    )
    accounts_result = await db.execute(delete(Account).where(Account.id.in_(account_ids)))
    counts = {
        "finalReportSources": len(final_report_ids),
        "finalReports": affected_row_count(final_reports_result),
        "userNotifications": affected_row_count(notifications_result),
        "intakeReports": affected_row_count(intake_reports_result),
        "telemetrySnapshots": affected_row_count(telemetry_snapshots_result),
        "activityLogs": affected_row_count(activity_logs_result),
        "operationalAlerts": affected_row_count(alerts_result),
        "supportTickets": affected_row_count(tickets_result),
        "accounts": affected_row_count(accounts_result),
    }
    await db.commit()
    return counts


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
    enterprise_profile_id: str,
    target_enterprise_profile_id: str,
) -> bool:
    previous_month = add_months(current_month, -1)
    return enterprise_profile_id == target_enterprise_profile_id and month_start in {
        previous_month,
        current_month,
    }


def seeded_review_status(month_start: datetime, current_month: datetime) -> str:
    previous_month = add_months(current_month, -1)
    return (
        "Ready to Consolidate" if month_start in {previous_month, current_month} else "Consolidated"
    )


def affected_row_count(result: Any) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


def sample_uuid(*parts: str) -> str:
    return str(uuid5(SAMPLE_UUID_NAMESPACE, ":".join((SAMPLE_DATASET_VERSION, *parts))))
