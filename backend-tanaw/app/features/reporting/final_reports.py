from collections.abc import Mapping
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import ensure_aware
from app.features.accounts.models import Account, AccountRole
from app.features.reporting.errors import InvalidReportWorkflowError
from app.features.reporting.intake import (
    parse_report_payload,
    report_demographics_from_payload,
)
from app.features.reporting.models import (
    EnterpriseReportSubmission,
    FinalReport,
    FinalReportSource,
)
from app.features.reporting.policies import (
    FINAL_REPORT_ARCHIVED_STATUS,
    FINAL_REPORT_RETURNED_STATUS,
    final_report_period,
    resolve_final_report_status_transition,
    to_final_report_archived_from_status,
    validate_final_report_revision_return,
    validate_final_report_sources,
)
from app.features.reporting.schemas import (
    FinalReportCreate,
    FinalReportRevisionReturn,
    FinalReportSourceSummary,
    FinalReportStatusUpdate,
    FinalReportSummary,
    ReportDemographicsSummary,
)


async def list_final_reports(
    db: AsyncSession, account: Account, limit: int = 500
) -> list[FinalReportSummary]:
    statement = select(FinalReport).order_by(FinalReport.generated_on.desc()).limit(limit)
    reports = list((await db.scalars(statement)).all())
    if account.role == AccountRole.ENTERPRISE:
        visible_ids = {
            item.final_report_id
            for item in (
                await db.scalars(
                    select(FinalReportSource)
                    .join(FinalReportSource.intake_report)
                    .where(EnterpriseReportSubmission.enterprise_profile_id == account.id)
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
    validate_final_report_sources(source_reports)

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
        enterprise_count=len({item.enterprise_profile_id for item in source_reports}),
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
                enterprise=source.enterprise_name,
                code=source.report_id,
                unique_count=source.unique_count,
                entries=source.entries,
                exits=source.exits,
            )
        )

    await db.flush()
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def return_final_report_for_revision(
    db: AsyncSession, report_id: str, payload: FinalReportRevisionReturn
) -> FinalReportSummary | None:
    report = await find_final_report(db, report_id)
    if report is None:
        return None
    sources = list(
        (
            await db.scalars(
                select(FinalReportSource).where(FinalReportSource.final_report_id == report.id)
            )
        ).all()
    )
    source_ids = {source.intake_report_id for source in sources}
    selected_source_ids = set(payload.sourceReportIds)
    validate_final_report_revision_return(report.status, source_ids, selected_source_ids)

    intake_reports = {
        intake_report.id: intake_report
        for intake_report in (
            await db.scalars(
                select(EnterpriseReportSubmission).where(
                    EnterpriseReportSubmission.id.in_(source_ids)
                )
            )
        ).all()
    }

    for source in sources:
        intake_report = intake_reports.get(source.intake_report_id)
        if intake_report is None:
            continue
        if source.intake_report_id in selected_source_ids:
            intake_report.review_status = "Returned"
            intake_report.remarks = payload.remarks
        else:
            intake_report.review_status = "Ready to Consolidate"
            intake_report.remarks = "Restored to Ready to Consolidate after final audit return."

    report.status = FINAL_REPORT_RETURNED_STATUS
    report.archived_from_status = None
    await db.flush()
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def update_final_report_status(
    db: AsyncSession, report_id: str, payload: FinalReportStatusUpdate
) -> FinalReportSummary | None:
    report = await find_final_report(db, report_id)
    if report is None:
        return None
    if payload.status == FINAL_REPORT_RETURNED_STATUS and not (
        report.status == FINAL_REPORT_ARCHIVED_STATUS
        and report.archived_from_status == FINAL_REPORT_RETURNED_STATUS
    ):
        raise InvalidReportWorkflowError(
            "Use the final audit return action to return a draft final report for revision."
        )

    next_status, archived_from_status = resolve_final_report_status_transition(
        current_status=report.status,
        current_archived_from_status=report.archived_from_status,
        requested_status=payload.status,
    )
    report.status = next_status
    report.archived_from_status = archived_from_status
    await db.flush()
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def find_final_report(db: AsyncSession, report_id: str) -> FinalReport | None:
    return (
        await db.scalars(
            select(FinalReport).where(
                (FinalReport.id == report_id) | (FinalReport.report_code == report_id)
            )
        )
    ).first()


async def to_final_report_summary(db: AsyncSession, report: FinalReport) -> FinalReportSummary:
    sources = (
        await db.scalars(
            select(FinalReportSource)
            .where(FinalReportSource.final_report_id == report.id)
            .order_by(FinalReportSource.enterprise.asc())
        )
    ).all()
    intake_reports_by_id: dict[str, EnterpriseReportSubmission] = {}
    source_intake_ids = [source.intake_report_id for source in sources]
    if source_intake_ids:
        intake_reports = (
            await db.scalars(
                select(EnterpriseReportSubmission).where(
                    EnterpriseReportSubmission.id.in_(source_intake_ids)
                )
            )
        ).all()
        intake_reports_by_id = {intake_report.id: intake_report for intake_report in intake_reports}

    return FinalReportSummary(
        id=report.report_code,
        title=report.title,
        period=report.period,
        generatedOn=ensure_aware(report.generated_on).date().isoformat(),
        preparedBy=report.prepared_by,
        preparedRole=report.prepared_role,
        status=report.status,  # type: ignore[arg-type]
        archivedFromStatus=to_final_report_archived_from_status(report.archived_from_status),
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
                demographics=source_demographics(source, intake_reports_by_id),
            )
            for source in sources
        ],
    )


def source_demographics(
    source: FinalReportSource, intake_reports_by_id: Mapping[str, EnterpriseReportSubmission]
) -> ReportDemographicsSummary | None:
    intake_report = intake_reports_by_id.get(source.intake_report_id)
    if intake_report is None:
        return None
    return report_demographics_from_payload(
        parse_report_payload(intake_report.payload_json), source.unique_count
    )


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
