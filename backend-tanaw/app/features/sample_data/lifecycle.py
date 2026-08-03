import random

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account
from app.features.activity_logs.models import ActivityLog
from app.features.monitoring.models import EnterpriseTelemetrySnapshot, OperationalAlert
from app.features.notifications.models import UserNotification
from app.features.reporting.models import (
    EnterpriseReportSubmission,
    FinalReport,
    FinalReportSource,
)
from app.features.sample_data.accounts import create_accounts, resolve_target_enterprise
from app.features.sample_data.dataset import (
    SAMPLE_ACCOUNT_EMAILS,
    SAMPLE_CAMERA_PREFIX,
    SAMPLE_FINAL_REPORT_PREFIX,
    SAMPLE_REPORT_PREFIX,
    SAMPLE_SOURCE_PREFIX,
    prepared_counts,
    sample_dataset_marker_email,
)
from app.features.sample_data.helpers import (
    affected_row_count,
    reporting_range,
)
from app.features.sample_data.portal_workflow import create_portal_workflow_data
from app.features.sample_data.report_workflow import (
    create_activity_logs,
    create_final_reports,
    create_operational_history,
    create_staff_report_notifications,
)
from app.features.sample_data.visitors import create_admin_visitor_history
from app.features.support.models import SupportTicket


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
    enterprises = list(
        {enterprise.id: enterprise for enterprise in [target, *accounts["enterprises"]]}.values()
    )
    reports = await create_operational_history(
        db, range_start, range_end, scenario, rng, enterprises, target
    )
    visitor_scenario = await create_admin_visitor_history(
        db, range_end, scenario, rng, enterprises, target
    )
    operations = await create_portal_workflow_data(
        db,
        accounts["lgu"],
        accounts["enterprises"],
        range_end,
        visitor_scenario,
    )
    notifications = await create_staff_report_notifications(
        db, accounts["lgu"], reports["staffNotificationReports"]
    )
    final_reports = await create_final_reports(
        db,
        reports,
        expected_enterprise_ids={enterprise.id for enterprise in enterprises},
    )
    logs = await create_activity_logs(db, reports, final_reports)

    counts = {
        "lguAccounts": len(accounts["lgu"]),
        "generatedEnterpriseAccounts": len(accounts["enterprises"]),
        "participatingEnterprises": len(enterprises),
        "telemetrySnapshots": len(reports["telemetry"]) + len(visitor_scenario.telemetry),
        "intakeReports": len(reports["reports"]),
        "finalReports": len(final_reports),
        "staffNotifications": notifications,
        "adminNotifications": operations["adminNotifications"],
        "itNotifications": operations["itNotifications"],
        "operationalAlerts": operations["operationalAlerts"],
        "supportTickets": operations["supportTickets"],
        "emailProblems": operations["emailProblems"],
        "activityLogs": logs + operations["activityLogs"],
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
            | OperationalAlert.alert_code.startswith("ALT-SAMPLE-")
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
