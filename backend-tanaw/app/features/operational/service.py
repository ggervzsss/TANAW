import json
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole
from app.features.accounts.options import format_enterprise_category
from app.features.operational.models import (
    EnterpriseReportSubmission,
    EnterpriseTelemetrySnapshot,
    FinalReport,
    FinalReportSource,
    OperationalAlert,
)
from app.features.operational.schemas import (
    DesktopReportSubmissionIngest,
    DesktopTelemetryIngest,
    FinalReportCreate,
    FinalReportSourceSummary,
    FinalReportStatusUpdate,
    FinalReportSummary,
    IntakeReportSummary,
    OperationalAlertSummary,
    OperationalSummary,
    ReportStatusUpdate,
    TelemetrySnapshotSummary,
)

STALE_GATEWAY_SECONDS = 120
OFFLINE_GATEWAY_SECONDS = 900


class DuplicateReportPeriodError(Exception):
    pass


def to_operational_alert_summary(alert: OperationalAlert) -> OperationalAlertSummary:
    return OperationalAlertSummary(
        id=alert.alert_code,
        type=alert.alert_type,  # type: ignore[arg-type]
        severity=alert.severity,  # type: ignore[arg-type]
        enterprise=alert.enterprise,
        requester=alert.requester,
        summary=alert.summary,
        requiredAction=alert.required_action,
        resolutionMode=alert.resolution_mode,  # type: ignore[arg-type]
        status=alert.status,  # type: ignore[arg-type]
        owner=alert.owner,  # type: ignore[arg-type]
        time=alert.created_at.isoformat(),
    )


async def create_operational_alert(
    db: AsyncSession,
    *,
    alert_type: str,
    severity: str,
    requester: str,
    summary: str,
    required_action: str,
    resolution_mode: str,
    owner: str,
    enterprise: str | None = None,
    source_id: str | None = None,
) -> OperationalAlert:
    if source_id:
        existing = await db.scalar(
            select(OperationalAlert).where(
                OperationalAlert.source_id == source_id,
                OperationalAlert.alert_type == alert_type,
                OperationalAlert.status != "Resolved",
            )
        )
        if existing is not None:
            existing.severity = severity
            existing.summary = summary
            existing.required_action = required_action
            await db.commit()
            await db.refresh(existing)
            return existing

    count = await db.scalar(select(func.count()).select_from(OperationalAlert))
    alert = OperationalAlert(
        alert_code=f"ALT-{int(count or 0) + 1:06d}",
        alert_type=alert_type,
        severity=severity,
        enterprise=enterprise,
        requester=requester,
        summary=summary,
        required_action=required_action,
        resolution_mode=resolution_mode,
        owner=owner,
        source_id=source_id,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return alert


async def list_operational_alerts(db: AsyncSession) -> list[OperationalAlertSummary]:
    result = await db.scalars(select(OperationalAlert).order_by(OperationalAlert.created_at.desc()))
    return [to_operational_alert_summary(alert) for alert in result]


def can_view_operational_event(role: str, event_type: str) -> bool:
    if role == AccountRole.ADMIN.value:
        return True
    if role == AccountRole.IT.value:
        return event_type in {"telemetry.snapshot", "summary.updated"}
    if role == AccountRole.STAFF.value:
        return event_type in {
            "report.submitted",
            "report.updated",
            "summary.updated",
            "final_report.generated",
            "final_report.updated",
        }
    if role == AccountRole.ENTERPRISE.value:
        return event_type in {"report.updated"}
    return False


async def ingest_telemetry(
    db: AsyncSession, account: Account, payload: DesktopTelemetryIngest
) -> TelemetrySnapshotSummary:
    captured_at = payload.capturedAt or payload.metrics.lastEventAt or datetime.now(UTC)
    if captured_at.tzinfo is None:
        captured_at = captured_at.replace(tzinfo=UTC)

    enterprise_id = enterprise_identifier(account)
    snapshot = EnterpriseTelemetrySnapshot(
        enterprise_account_id=account.id,
        enterprise_id=enterprise_id,
        enterprise_name=enterprise_name(account),
        camera_id=str(payload.session.cameraId) if payload.session.cameraId is not None else None,
        camera_name=payload.session.cameraName,
        captured_at=captured_at,
        entries=payload.metrics.entries,
        exits=payload.metrics.exits,
        current_occupancy=payload.metrics.currentOccupancy,
        peak_occupancy=payload.metrics.peakOccupancy,
        unique_count=payload.metrics.uniqueCount,
        confirmed_unique_count=payload.metrics.confirmedUniqueCount,
        degraded_unique_count=payload.metrics.degradedUniqueCount,
        total_events=payload.metrics.totalEvents,
        unsubmitted_events=payload.metrics.unsubmittedEvents,
        unsynced_events=payload.metrics.unsyncedEvents,
        running=payload.session.running,
        status=payload.session.status,
        error=payload.session.error,
        analytics_fps=payload.health.analyticsFps,
        payload_json=json.dumps(payload.model_dump(mode="json"), sort_keys=True),
        source_kind=payload.sourceKind,
        mock_run_id=payload.mockRunId,
    )
    db.add(snapshot)
    account.gateway_status = (
        "Offline" if snapshot.error or snapshot.status == "error" else "Connected"
    )
    if payload.deviceId:
        account.gateway_id = payload.deviceId
    await db.commit()
    await db.refresh(snapshot)
    return to_telemetry_summary(snapshot, account)


async def ingest_report_submission(
    db: AsyncSession, account: Account, payload: DesktopReportSubmissionIngest
) -> IntakeReportSummary:
    enterprise_id = enterprise_identifier(account)
    result = await db.scalars(
        select(EnterpriseReportSubmission).where(
            EnterpriseReportSubmission.enterprise_id == enterprise_id,
            EnterpriseReportSubmission.report_id == payload.reportId,
        )
    )
    existing = result.first()
    duplicate_period = await db.scalar(
        select(EnterpriseReportSubmission).where(
            EnterpriseReportSubmission.enterprise_id == enterprise_id,
            EnterpriseReportSubmission.period == payload.period,
            EnterpriseReportSubmission.report_id != payload.reportId,
        )
    )
    if duplicate_period is not None:
        raise DuplicateReportPeriodError(
            f"A report for {payload.period} has already been submitted."
        )
    report_status = status_from_payload(payload.payload)
    month = month_from_submission(payload.period, payload.submittedAt)

    if existing is None:
        report = EnterpriseReportSubmission(
            report_id=payload.reportId,
            enterprise_account_id=account.id,
            enterprise_id=enterprise_id,
            enterprise_name=enterprise_name(account),
            category=format_enterprise_category(account.category) or "Uncategorized",
            barangay=account.barangay or "Unassigned",
            period=payload.period,
            month=month,
            submitted_at=_aware(payload.submittedAt),
            entries=payload.entries,
            exits=payload.exits,
            peak_occupancy=payload.peakOccupancy,
            unique_count=payload.uniqueCount,
            status=report_status,
            review_status="Pending Review",
            notes=payload.notes,
            sync_status=payload.syncStatus,
            payload_json=json.dumps(payload.payload or {}, sort_keys=True),
            source_kind=payload.sourceKind,
            mock_run_id=payload.mockRunId,
        )
        db.add(report)
    else:
        report = existing
        report.enterprise_account_id = account.id
        report.enterprise_name = enterprise_name(account)
        report.category = format_enterprise_category(account.category) or "Uncategorized"
        report.barangay = account.barangay or "Unassigned"
        report.period = payload.period
        report.month = month
        report.submitted_at = _aware(payload.submittedAt)
        report.entries = payload.entries
        report.exits = payload.exits
        report.peak_occupancy = payload.peakOccupancy
        report.unique_count = payload.uniqueCount
        report.status = report_status
        report.notes = payload.notes
        report.sync_status = payload.syncStatus
        report.payload_json = json.dumps(payload.payload or {}, sort_keys=True)
        report.source_kind = payload.sourceKind
        report.mock_run_id = payload.mockRunId
        if report.review_status == "Returned" and report_status in {"Submitted", "Resubmitted"}:
            report.review_status = "Pending Review"

    account.gateway_status = "Connected"
    await db.commit()
    await db.refresh(report)
    return to_intake_report_summary(report)


async def list_latest_telemetry(
    db: AsyncSession, account: Account, limit: int = 500
) -> list[TelemetrySnapshotSummary]:
    latest_ranked_snapshot = select(
        EnterpriseTelemetrySnapshot.id.label("snapshot_id"),
        func.row_number()
        .over(
            partition_by=EnterpriseTelemetrySnapshot.enterprise_id,
            order_by=EnterpriseTelemetrySnapshot.received_at.desc(),
        )
        .label("snapshot_rank"),
    ).subquery()
    statement = (
        select(EnterpriseTelemetrySnapshot)
        .join(
            latest_ranked_snapshot,
            EnterpriseTelemetrySnapshot.id == latest_ranked_snapshot.c.snapshot_id,
        )
        .where(latest_ranked_snapshot.c.snapshot_rank == 1)
        .order_by(EnterpriseTelemetrySnapshot.received_at.desc())
        .limit(limit)
    )
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(
            EnterpriseTelemetrySnapshot.enterprise_id == enterprise_identifier(account)
        )

    snapshots = (await db.scalars(statement)).all()
    accounts = await enterprise_accounts_by_id(db)

    return [
        to_telemetry_summary(snapshot, accounts.get(snapshot.enterprise_id))
        for snapshot in snapshots
    ]


async def get_operational_summary(db: AsyncSession, account: Account) -> OperationalSummary:
    latest = await list_latest_telemetry(db, account)
    reports = await list_intake_reports(db, account)
    last_sync_at = max((item.receivedAt for item in latest), default=None)
    return OperationalSummary(
        enterpriseCount=len(latest),
        onlineGateways=sum(1 for item in latest if item.gatewayStatus == "Connected"),
        delayedGateways=sum(1 for item in latest if item.gatewayStatus == "Sync Delayed"),
        offlineGateways=sum(1 for item in latest if item.gatewayStatus == "Offline"),
        totalCurrentOccupancy=sum(item.currentOccupancy for item in latest),
        totalEntries=sum(item.entries for item in latest),
        totalExits=sum(item.exits for item in latest),
        totalUniqueCount=sum(item.uniqueCount for item in latest),
        activeReports=len(reports),
        pendingReports=sum(1 for report in reports if report.status == "Pending Review"),
        lastSyncAt=last_sync_at,
    )


async def list_intake_reports(
    db: AsyncSession, account: Account, limit: int = 500
) -> list[IntakeReportSummary]:
    statement = (
        select(EnterpriseReportSubmission)
        .order_by(EnterpriseReportSubmission.submitted_at.desc())
        .limit(limit)
    )
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(
            EnterpriseReportSubmission.enterprise_id == enterprise_identifier(account)
        )

    reports = (await db.scalars(statement)).all()
    return [to_intake_report_summary(report) for report in reports]


async def update_report_status(
    db: AsyncSession, report_id: str, payload: ReportStatusUpdate
) -> IntakeReportSummary | None:
    report = (
        await db.scalars(
            select(EnterpriseReportSubmission).where(EnterpriseReportSubmission.id == report_id)
        )
    ).first()
    if report is None:
        report = (
            await db.scalars(
                select(EnterpriseReportSubmission).where(
                    EnterpriseReportSubmission.report_id == report_id
                )
            )
        ).first()
    if report is None:
        return None

    report.review_status = payload.status
    report.remarks = payload.remarks
    await db.commit()
    await db.refresh(report)
    return to_intake_report_summary(report)


async def list_final_reports(
    db: AsyncSession, account: Account, limit: int = 500
) -> list[FinalReportSummary]:
    statement = select(FinalReport).order_by(FinalReport.generated_on.desc()).limit(limit)
    reports = list((await db.scalars(statement)).all())
    if account.role == AccountRole.ENTERPRISE:
        enterprise_id = enterprise_identifier(account)
        visible_ids = {
            item.final_report_id
            for item in (
                await db.scalars(
                    select(FinalReportSource).where(
                        FinalReportSource.enterprise_id == enterprise_id
                    )
                )
            ).all()
        }
        reports = [report for report in reports if report.id in visible_ids]

    return [await to_final_report_summary(db, report) for report in reports]


async def create_final_report(
    db: AsyncSession, payload: FinalReportCreate
) -> FinalReportSummary | None:
    source_reports = (
        await db.scalars(
            select(EnterpriseReportSubmission)
            .where(EnterpriseReportSubmission.id.in_(payload.reportIds))
            .order_by(EnterpriseReportSubmission.submitted_at.asc())
        )
    ).all()
    if not source_reports:
        return None

    period = final_report_period(source_reports)
    report = FinalReport(
        report_code=await generate_final_report_code(db, period),
        title="Citywide Tourism Aggregation",
        period=period,
        generated_on=datetime.now(UTC),
        prepared_by=payload.preparedBy,
        prepared_role="Staff Processing Division",
        status="Draft",
        total_entry=sum(item.entries for item in source_reports),
        total_exit=sum(item.exits for item in source_reports),
        total_unique=sum(item.unique_count for item in source_reports),
        enterprise_count=len({item.enterprise_id for item in source_reports}),
        source_kind=source_kind_for_reports(source_reports),
        mock_run_id=mock_run_id_for_reports(source_reports),
    )
    db.add(report)
    await db.flush()

    for source in source_reports:
        source.review_status = "Consolidated"
        source.remarks = "Included in final report consolidation."
        db.add(
            FinalReportSource(
                final_report_id=report.id,
                intake_report_id=source.id,
                enterprise_id=source.enterprise_id,
                enterprise=source.enterprise_name,
                code=source.report_id,
                unique_count=source.unique_count,
                entries=source.entries,
                exits=source.exits,
            )
        )

    await db.commit()
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def update_final_report_status(
    db: AsyncSession, report_id: str, payload: FinalReportStatusUpdate
) -> FinalReportSummary | None:
    report = (
        await db.scalars(
            select(FinalReport).where(
                (FinalReport.id == report_id) | (FinalReport.report_code == report_id)
            )
        )
    ).first()
    if report is None:
        return None

    report.status = payload.status
    await db.commit()
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def enterprise_accounts_by_id(db: AsyncSession) -> dict[str, Account]:
    accounts = (
        await db.scalars(select(Account).where(Account.role == AccountRole.ENTERPRISE))
    ).all()
    return {enterprise_identifier(account): account for account in accounts}


def to_telemetry_summary(
    snapshot: EnterpriseTelemetrySnapshot, account: Account | None = None
) -> TelemetrySnapshotSummary:
    return TelemetrySnapshotSummary(
        id=snapshot.id,
        enterpriseId=snapshot.enterprise_id,
        enterpriseName=account.enterprise_name
        if account and account.enterprise_name
        else snapshot.enterprise_name,
        category=format_enterprise_category(account.category) if account else None,
        barangay=account.barangay if account else None,
        cameraId=snapshot.camera_id,
        cameraName=snapshot.camera_name,
        capturedAt=snapshot.captured_at,
        receivedAt=snapshot.received_at,
        entries=snapshot.entries,
        exits=snapshot.exits,
        currentOccupancy=snapshot.current_occupancy,
        peakOccupancy=snapshot.peak_occupancy,
        uniqueCount=snapshot.unique_count,
        confirmedUniqueCount=snapshot.confirmed_unique_count,
        degradedUniqueCount=snapshot.degraded_unique_count,
        totalEvents=snapshot.total_events,
        unsubmittedEvents=snapshot.unsubmitted_events,
        unsyncedEvents=snapshot.unsynced_events,
        running=snapshot.running,
        status=snapshot.status,
        error=snapshot.error,
        analyticsFps=snapshot.analytics_fps,
        gatewayStatus=gateway_status_for_snapshot(snapshot),
    )


def to_intake_report_summary(report: EnterpriseReportSubmission) -> IntakeReportSummary:
    return IntakeReportSummary(
        id=report.id,
        enterpriseId=report.enterprise_id,
        enterprise=report.enterprise_name,
        category=report.category or "Uncategorized",
        barangay=report.barangay or "Unassigned",
        month=report.month,
        period=report.period,
        submitted=format_timestamp(report.submitted_at),
        submittedAt=report.submitted_at,
        status=report.review_status,  # type: ignore[arg-type]
        code=report.report_id,
        remarks=report.remarks,
        notes=report.notes,
        metrics={
            "entry": report.entries,
            "exit": report.exits,
            "unique": report.unique_count,
            "peak": str(report.peak_occupancy),
        },
    )


async def to_final_report_summary(db: AsyncSession, report: FinalReport) -> FinalReportSummary:
    sources = (
        await db.scalars(
            select(FinalReportSource)
            .where(FinalReportSource.final_report_id == report.id)
            .order_by(FinalReportSource.enterprise.asc())
        )
    ).all()
    return FinalReportSummary(
        id=report.report_code,
        title=report.title,
        period=report.period,
        generatedOn=_aware(report.generated_on).date().isoformat(),
        preparedBy=report.prepared_by,
        preparedRole=report.prepared_role,
        status=report.status,  # type: ignore[arg-type]
        totalEntry=report.total_entry,
        totalExit=report.total_exit,
        totalUnique=report.total_unique,
        enterpriseCount=report.enterprise_count,
        sources=[
            FinalReportSourceSummary(
                id=source.intake_report_id,
                enterprise=source.enterprise,
                code=source.code,
                unique=source.unique_count,
                entry=source.entries,
                exit=source.exits,
            )
            for source in sources
        ],
    )


def enterprise_identifier(account: Account) -> str:
    return account.enterprise_id or account.id


def enterprise_name(account: Account) -> str:
    return account.enterprise_name or account.display_name


async def generate_final_report_code(db: AsyncSession, period: str) -> str:
    parts = period.split()
    month = (parts[0] if parts else "Current")[:3].upper()
    year = next(
        (part for part in reversed(parts) if part.isdigit() and len(part) == 4),
        str(datetime.now(UTC).year),
    )
    prefix = f"CON-{month}-{year}"
    existing = set(
        await db.scalars(
            select(FinalReport.report_code).where(FinalReport.report_code.like(f"{prefix}-%"))
        )
    )
    sequence = 1
    while True:
        code = f"{prefix}-{sequence:04d}"
        if code not in existing:
            return code
        sequence += 1


def final_report_period(reports: Sequence[EnterpriseReportSubmission]) -> str:
    first = reports[0]
    year = (
        first.period.split(",")[-1].strip()
        if "," in first.period
        else str(_aware(first.submitted_at).year)
    )
    if not year.isdigit():
        year = str(_aware(first.submitted_at).year)
    return f"{first.month} {year}"


def source_kind_for_reports(reports: Sequence[EnterpriseReportSubmission]) -> str:
    source_kinds = {report.source_kind for report in reports}
    if "hybrid" in source_kinds:
        return "hybrid"
    if source_kinds == {"mock"}:
        return "mock"
    return "real"


def mock_run_id_for_reports(reports: Sequence[EnterpriseReportSubmission]) -> str | None:
    run_ids = {report.mock_run_id for report in reports if report.mock_run_id}
    return run_ids.pop() if len(run_ids) == 1 else None


def gateway_status_for_snapshot(snapshot: EnterpriseTelemetrySnapshot) -> str:
    now = datetime.now(UTC)
    received_at = snapshot.received_at
    if received_at is None:
        return "Offline" if snapshot.error or snapshot.status == "error" else "Connected"
    if received_at.tzinfo is None:
        received_at = received_at.replace(tzinfo=UTC)
    age = (now - received_at).total_seconds()

    if snapshot.error or snapshot.status == "error":
        return "Offline"
    if age > OFFLINE_GATEWAY_SECONDS:
        return "Offline"
    if age > STALE_GATEWAY_SECONDS:
        return "Sync Delayed"
    return "Connected" if snapshot.running or snapshot.total_events > 0 else "Connected"


def status_from_payload(payload: dict | None) -> str:
    value = payload.get("status") if isinstance(payload, dict) else None
    return (
        value if isinstance(value, str) and value in {"Submitted", "Resubmitted"} else "Submitted"
    )


def month_from_submission(period: str, submitted_at: datetime) -> str:
    first = period.split(" ", 1)[0].strip()
    month_names = {
        "jan": "January",
        "january": "January",
        "feb": "February",
        "february": "February",
        "mar": "March",
        "march": "March",
        "apr": "April",
        "april": "April",
        "may": "May",
        "jun": "June",
        "june": "June",
        "jul": "July",
        "july": "July",
        "aug": "August",
        "august": "August",
        "sep": "September",
        "sept": "September",
        "september": "September",
        "oct": "October",
        "october": "October",
        "nov": "November",
        "november": "November",
        "dec": "December",
        "december": "December",
    }
    if first.lower() in month_names:
        return month_names[first.lower()]
    return _aware(submitted_at).strftime("%B")


def format_timestamp(value: datetime) -> str:
    return _aware(value).strftime("%b %d, %Y %I:%M %p")


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value
