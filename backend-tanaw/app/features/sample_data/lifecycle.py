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
from app.features.requests.models import Request
from app.features.sample_data.accounts import create_accounts, resolve_target_enterprise
from app.features.sample_data.activity import create_request_and_user_activity
from app.features.sample_data.dataset import (
    SAMPLE_ACCOUNT_EMAILS,
    SAMPLE_CAMERA_PREFIX,
    SAMPLE_FINAL_REPORT_PREFIX,
    SAMPLE_REPORT_PREFIX,
    SAMPLE_SOURCE_PREFIX,
    prepared_counts,
    sample_dataset_marker_email,
)
from app.features.sample_data.definitions import TEST_ACCOUNT_PASSWORD
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
    db: AsyncSession,
    range_value: str,
    scenario: str,
    seed: str,
    target_identifier: str | None,
    *,
    account_password: str = TEST_ACCOUNT_PASSWORD,
) -> dict:
    rng = random.Random(seed)
    range_start, range_end = reporting_range(range_value)
    target = await resolve_target_enterprise(db, target_identifier)
    target_profile = target.enterprise_profile
    if target_profile is None:
        raise SystemExit("The selected target account has no enterprise profile.")
    accounts = await create_accounts(db, account_password, registered_before=range_start)
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
    history = await create_request_and_user_activity(
        db, accounts["lgu"], accounts["enterprises"], range_end
    )
    notifications = await create_staff_report_notifications(
        db, accounts["lgu"], reports["staffNotificationReports"]
    )
    final_reports = await create_final_reports(db, reports)
    logs = await create_activity_logs(db, reports, final_reports, range_end)

    counts = {
        "lguAccounts": len(accounts["lgu"]),
        "generatedEnterpriseAccounts": len(accounts["enterprises"]),
        "participatingEnterprises": len(enterprises),
        "telemetrySnapshots": len(reports["telemetry"]) + len(visitor_scenario.telemetry),
        "intakeReports": len(reports["reports"]),
        "finalReports": len(final_reports),
        "staffNotifications": notifications,
        "itNotifications": operations["itNotifications"],
        "operationalAlerts": operations["operationalAlerts"] + history["operationalAlerts"],
        "requests": operations["requests"] + history["requests"],
        "emailProblems": operations["emailProblems"],
        "activityLogs": logs + operations["activityLogs"] + history["activityLogs"],
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
    alert_ids = list(
        await db.scalars(
            select(OperationalAlert.id).where(OperationalAlert.alert_code.startswith("ALT-SAMPLE-"))
        )
    )
    request_ids = list(
        await db.scalars(
            select(Request.id).where(
                Request.enterprise_profile_id.in_(account_ids)
                | Request.request_code.startswith("REQ-SAMPLE-")
            )
        )
    )
    notification_filters = [
        UserNotification.source_id.in_(intake_report_ids),
        UserNotification.source_id.in_(request_ids),
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
            | ActivityLog.source_id.in_(account_ids)
            | ActivityLog.source_id.in_(alert_ids)
            | ActivityLog.source_id.in_(request_ids)
        )
    )
    alerts_result = await db.execute(
        delete(OperationalAlert).where(
            OperationalAlert.source_id.startswith(SAMPLE_SOURCE_PREFIX)
            | OperationalAlert.alert_code.startswith("ALT-SAMPLE-")
            | OperationalAlert.enterprise_profile_id.in_(account_ids)
        )
    )
    requests_result = await db.execute(delete(Request).where(Request.id.in_(request_ids)))
    accounts_result = await db.execute(delete(Account).where(Account.id.in_(account_ids)))
    counts = {
        "finalReportSources": len(final_report_ids),
        "finalReports": affected_row_count(final_reports_result),
        "userNotifications": affected_row_count(notifications_result),
        "intakeReports": affected_row_count(intake_reports_result),
        "telemetrySnapshots": affected_row_count(telemetry_snapshots_result),
        "activityLogs": affected_row_count(activity_logs_result),
        "operationalAlerts": affected_row_count(alerts_result),
        "requests": affected_row_count(requests_result),
        "accounts": affected_row_count(accounts_result),
    }
    await db.commit()
    return counts
