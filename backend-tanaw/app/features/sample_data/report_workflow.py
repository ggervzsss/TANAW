import json
import random
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.models import ActivityLog
from app.features.monitoring.models import EnterpriseTelemetrySnapshot
from app.features.notifications.models import UserNotification
from app.features.notifications.service import STAFF_REPORT_SUBMITTED_NOTIFICATION
from app.features.reporting.counting import complete_sum
from app.features.reporting.final_reports import final_report_source_snapshot
from app.features.reporting.models import (
    EnterpriseReportSubmission,
    FinalReport,
)
from app.features.reporting.policies import final_report_consolidation_status
from app.features.sample_data.daily_details import sample_report_details
from app.features.sample_data.dataset import (
    SAMPLE_CAMERA_PREFIX,
    SAMPLE_FINAL_REPORT_PREFIX,
    SAMPLE_REPORT_PREFIX,
    SAMPLE_SOURCE_PREFIX,
)
from app.features.sample_data.definitions import (
    REPORTING_STAFF_NAME,
)
from app.features.sample_data.helpers import (
    MISSING_REPORT_ENTERPRISE_INDEX,
    add_months,
    last_reported_day,
    latest_capture_time,
    month_starts,
    period_label,
    sample_submitted_at,
    sample_uuid,
    seeded_review_status,
    should_skip_target_report,
)


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
            submitted_at = sample_submitted_at(month_start, enterprise_index, range_end)
            should_skip = should_skip_target_report(
                month_start, current_month, enterprise.id, target.id
            )
            not_sent = (
                submitted_at is None
                or month_start >= current_month
                or (
                    month_start == add_months(current_month, -1)
                    and enterprise_index == MISSING_REPORT_ENTERPRISE_INDEX
                )
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

            snapshot_captured_at = latest_capture_time(month_start, range_end)
            if month_start == current_month:
                snapshot_captured_at = range_end - timedelta(minutes=5)

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
                captured_at=snapshot_captured_at,
                received_at=snapshot_captured_at,
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

            if should_skip or not_sent or submitted_at is None:
                continue

            review_status = seeded_review_status(month_start, current_month, enterprise_index)
            details = sample_report_details(
                seed=f"{profile.account_id}:{period}",
                enterprise_id=profile.enterprise_id,
                camera_name=f"{profile.enterprise_name} Main Entrance",
                month=month_start.date(),
                last_day=last_reported_day(month_start, range_end),
                entries=base_entries,
                exits=exits,
                unique_count=unique_count,
                peak=peak,
            )

            report = EnterpriseReportSubmission(
                id=sample_uuid(
                    "report",
                    profile.account_id,
                    month_start.isoformat(),
                ),
                report_id=(f"{SAMPLE_REPORT_PREFIX}{month_start:%y%m}{enterprise_index + 1:02d}"),
                enterprise_profile_id=profile.account_id,
                enterprise_name=profile.enterprise_name,
                attraction_code=profile.attraction_code,
                attraction_description=profile.attraction_description,
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
                remarks=None,
                sync_status="synced",
                payload_json=json.dumps(
                    {
                        **details,
                        "metrics": {
                            "entries": base_entries,
                            "exits": exits,
                            "peak": peak,
                            "unique": unique_count,
                        },
                        "notes": "Monthly visitor count submitted for LGU review.",
                        "period": period,
                        "source": "desktop-reporting",
                        "status": "Submitted",
                    },
                    sort_keys=True,
                ),
            )
            db.add(report)
            reports.append(report)

    staff_notification_reports = prepare_staff_notification_reports(
        reports, add_months(current_month, -1)
    )
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
    reports: list[EnterpriseReportSubmission], reporting_month: datetime
) -> list[EnterpriseReportSubmission]:
    """The reporting month's first two reports still waiting for staff, each announced to staff
    as a new submission."""
    period = period_label(reporting_month)
    return [
        report
        for report in reports
        if report.period == period and report.review_status == "Pending Review"
    ][:2]


async def create_staff_report_notifications(
    db: AsyncSession,
    lgu_accounts: list[Account],
    reports: list[EnterpriseReportSubmission],
) -> int:
    staff_accounts = [account for account in lgu_accounts if account.role == AccountRole.STAFF]
    notification_type = STAFF_REPORT_SUBMITTED_NOTIFICATION
    count = 0
    for staff_account in staff_accounts:
        for report in reports:
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
                        f"{report.enterprise_name} submitted "
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


async def create_final_reports(db: AsyncSession, history: dict) -> list[FinalReport]:
    """One monthly report per month whose reports are consolidated. Past sample months count as
    closed: the enterprises that sent a report are the ones the month waited for, so a month is
    Finalized unless one of its reports still awaits review, which leaves it a Draft."""
    reports_by_period: dict[str, list[EnterpriseReportSubmission]] = {}
    statuses_by_period: dict[str, list[tuple[str, str]]] = {}
    for report in history["reports"]:
        statuses_by_period.setdefault(report.period, []).append(
            (report.enterprise_profile_id, report.review_status)
        )
        if report.review_status == "Consolidated":
            reports_by_period.setdefault(report.period, []).append(report)

    final_reports: list[FinalReport] = []
    for period, reports in sorted(reports_by_period.items()):
        period_reports = statuses_by_period[period]
        expected = {enterprise_id for enterprise_id, _ in period_reports}
        final_report = FinalReport(
            id=sample_uuid("final-report", period),
            report_code=f"{SAMPLE_FINAL_REPORT_PREFIX}{period.replace(' ', '-').upper()}",
            title="Citywide Tourism Aggregation",
            period=period,
            generated_on=max(report.submitted_at for report in reports) + timedelta(days=2),
            prepared_by=REPORTING_STAFF_NAME,
            prepared_role="Staff Processing Division",
            status=final_report_consolidation_status(
                expected_enterprise_ids=expected, period_reports=period_reports
            ),
            total_entry=complete_sum(report.entries for report in reports),
            total_exit=complete_sum(report.exits for report in reports),
            total_unique=sum(report.unique_count for report in reports),
            enterprise_count=len({report.enterprise_profile_id for report in reports}),
            enterprise_total=len(expected),
        )
        db.add(final_report)
        await db.flush()
        for report in reports:
            source = final_report_source_snapshot(final_report.id, report)
            source.id = sample_uuid("final-report-source", final_report.id, report.id)
            db.add(source)
        final_reports.append(final_report)
    await db.flush()
    return final_reports


async def create_activity_logs(
    db: AsyncSession, history: dict, final_reports: list[FinalReport], range_end: datetime
) -> int:
    """Report submissions and staff review decisions, logged as the live workflow logs them (linked
    by the intake report's ID), so the portals can show who reviewed each report and when."""
    logs: list[ActivityLog] = []
    for report in history["reports"]:
        submitted_at = report.submitted_at
        logs.append(_submission_log(report, submitted_at))
        reviewed_at = max(submitted_at, min(submitted_at + timedelta(days=1), range_end))
        if report.review_status in {"Ready to Consolidate", "Consolidated"}:
            logs.append(_review_log(report, "Ready to Consolidate", reviewed_at, None))
    db.add_all(logs)
    count = len(logs)
    for final_report in final_reports:
        db.add(
            ActivityLog(
                id=sample_uuid("activity-final-report", final_report.id),
                timestamp=final_report.generated_on,
                activity_group="Reports",
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


def _submission_log(report: EnterpriseReportSubmission, at: datetime) -> ActivityLog:
    return ActivityLog(
        id=sample_uuid("activity-report", report.id, "latest"),
        timestamp=at,
        activity_group="Reports",
        severity="Success",
        actor=report.enterprise_name,
        actor_role="Enterprise Account",
        action="Submit Enterprise Report",
        target=report.enterprise_name,
        summary=f"{report.enterprise_name} submitted {report.report_id} for {report.period}.",
        source_id=report.id,
        metadata_json=json.dumps(
            {
                "enterpriseId": report.enterprise_profile.enterprise_id,
                "period": report.period,
                "uniqueCount": report.unique_count,
            },
            sort_keys=True,
        ),
    )


def _review_log(
    report: EnterpriseReportSubmission, status: str, at: datetime, remarks: str | None
) -> ActivityLog:
    return ActivityLog(
        id=sample_uuid("activity-review", report.id, status, at.isoformat()),
        timestamp=at,
        activity_group="Reports",
        severity="Success",
        actor=REPORTING_STAFF_NAME,
        actor_role="LGU Staff",
        action=f"Report {status}",
        target=report.enterprise_name,
        summary=(
            f"{REPORTING_STAFF_NAME} marked {report.report_id} from "
            f"{report.enterprise_name} as {status}."
        ),
        source_id=report.id,
        metadata_json=json.dumps(
            {
                "enterpriseId": report.enterprise_profile.enterprise_id,
                "period": report.period,
                "remarks": remarks,
            },
            sort_keys=True,
        ),
    )
