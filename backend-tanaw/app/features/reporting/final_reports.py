from datetime import UTC, datetime
from typing import cast

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import ensure_aware
from app.features.accounts.models import Account, AccountRole
from app.features.reporting.errors import (
    InvalidReportWorkflowError,
    ReportAlreadyConsolidatedError,
)
from app.features.reporting.intake import (
    parse_report_payload,
    report_demographics_from_payload,
)
from app.features.reporting.models import (
    FINAL_REPORT_CODE_SEQUENCE,
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
    source_reports = list(
        await db.scalars(
            select(EnterpriseReportSubmission)
            .where(EnterpriseReportSubmission.id.in_(payload.reportIds))
            .order_by(EnterpriseReportSubmission.id.asc())
            .with_for_update(of=EnterpriseReportSubmission)
            .execution_options(populate_existing=True)
        )
    )
    if len(source_reports) != len(payload.reportIds):
        return None
    validate_final_report_sources(source_reports)

    existing_sources = list(
        await db.scalars(
            select(FinalReportSource)
            .where(FinalReportSource.intake_report_id.in_(payload.reportIds))
            .order_by(FinalReportSource.intake_report_id.asc())
            .with_for_update(of=FinalReportSource)
            .execution_options(populate_existing=True)
        )
    )
    if existing_sources:
        return await reconsolidate_returned_final_report(
            db,
            payload,
            source_reports,
            existing_sources,
        )

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
    try:
        db.add(report)
        await db.flush()
        for source in source_reports:
            mark_source_consolidated(source)
            db.add(final_report_source_snapshot(report.id, source))
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ReportAlreadyConsolidatedError(
            "One or more source reports were consolidated by another request."
        ) from exc
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def reconsolidate_returned_final_report(
    db: AsyncSession,
    payload: FinalReportCreate,
    source_reports: list[EnterpriseReportSubmission],
    existing_sources: list[FinalReportSource],
) -> FinalReportSummary:
    final_report_ids = {source.final_report_id for source in existing_sources}
    selected_source_ids = {source.id for source in source_reports}
    linked_source_ids = {source.intake_report_id for source in existing_sources}
    if len(final_report_ids) != 1 or linked_source_ids != selected_source_ids:
        raise ReportAlreadyConsolidatedError(
            "One or more source reports already belong to another final report."
        )

    final_report_id = next(iter(final_report_ids))
    report = await db.scalar(
        select(FinalReport)
        .where(FinalReport.id == final_report_id)
        .with_for_update(of=FinalReport)
        .execution_options(populate_existing=True)
    )
    all_sources = list(
        await db.scalars(
            select(FinalReportSource)
            .where(FinalReportSource.final_report_id == final_report_id)
            .order_by(FinalReportSource.intake_report_id.asc())
            .with_for_update(of=FinalReportSource)
            .execution_options(populate_existing=True)
        )
    )
    if (
        report is None
        or report.status != FINAL_REPORT_RETURNED_STATUS
        or {source.intake_report_id for source in all_sources} != selected_source_ids
    ):
        raise ReportAlreadyConsolidatedError(
            "One or more source reports already belong to another final report."
        )

    report.generated_on = datetime.now(UTC)
    report.prepared_by = payload.preparedBy
    report.prepared_role = "Staff Processing Division"
    report.status = "Draft"
    report.archived_from_status = None
    report.total_entry = sum(item.entries for item in source_reports)
    report.total_exit = sum(item.exits for item in source_reports)
    report.total_unique = sum(item.unique_count for item in source_reports)
    report.enterprise_count = len({item.enterprise_profile_id for item in source_reports})

    reports_by_id = {source.id: source for source in source_reports}
    for stored_source in all_sources:
        source = reports_by_id[stored_source.intake_report_id]
        update_final_report_source_snapshot(stored_source, source)
        mark_source_consolidated(source)

    await db.flush()
    await db.refresh(report)
    return await to_final_report_summary(db, report)


async def return_final_report_for_revision(
    db: AsyncSession, report_id: str, payload: FinalReportRevisionReturn
) -> FinalReportSummary | None:
    report = await find_final_report(db, report_id, for_update=True)
    if report is None:
        return None
    sources = list(
        (
            await db.scalars(
                select(FinalReportSource)
                .where(FinalReportSource.final_report_id == report.id)
                .order_by(FinalReportSource.intake_report_id.asc())
                .with_for_update(of=FinalReportSource)
                .execution_options(populate_existing=True)
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
                select(EnterpriseReportSubmission)
                .where(EnterpriseReportSubmission.id.in_(source_ids))
                .order_by(EnterpriseReportSubmission.id.asc())
                .with_for_update(of=EnterpriseReportSubmission)
                .execution_options(populate_existing=True)
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
    report = await find_final_report(db, report_id, for_update=True)
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


async def find_final_report(
    db: AsyncSession, report_id: str, *, for_update: bool = False
) -> FinalReport | None:
    statement = select(FinalReport).where(
        (FinalReport.id == report_id) | (FinalReport.report_code == report_id)
    )
    if for_update:
        statement = statement.with_for_update(of=FinalReport).execution_options(
            populate_existing=True
        )
    return cast(FinalReport | None, await db.scalar(statement))


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
                demographics=source_demographics(source),
            )
            for source in sources
        ],
    )


def source_demographics(
    source: FinalReportSource,
) -> ReportDemographicsSummary | None:
    values = {
        "thisProvMale": source.this_prov_male,
        "thisProvFemale": source.this_prov_female,
        "otherProvMale": source.other_prov_male,
        "otherProvFemale": source.other_prov_female,
        "foreignMale": source.foreign_male,
        "foreignFemale": source.foreign_female,
    }
    if any(value is None for value in values.values()):
        return None
    return ReportDemographicsSummary.model_validate(values)


def final_report_source_snapshot(
    final_report_id: str, source: EnterpriseReportSubmission
) -> FinalReportSource:
    snapshot = FinalReportSource(
        final_report_id=final_report_id,
        intake_report_id=source.id,
        enterprise=source.enterprise_name,
        code=source.report_id,
        unique_count=source.unique_count,
        entries=source.entries,
        exits=source.exits,
    )
    update_final_report_source_snapshot(snapshot, source)
    return snapshot


def update_final_report_source_snapshot(
    snapshot: FinalReportSource, source: EnterpriseReportSubmission
) -> None:
    snapshot.enterprise = source.enterprise_name
    snapshot.code = source.report_id
    snapshot.unique_count = source.unique_count
    snapshot.entries = source.entries
    snapshot.exits = source.exits
    demographics = report_demographics_from_payload(
        parse_report_payload(source.payload_json), source.unique_count
    )
    snapshot.this_prov_male = demographics.thisProvMale if demographics else None
    snapshot.this_prov_female = demographics.thisProvFemale if demographics else None
    snapshot.other_prov_male = demographics.otherProvMale if demographics else None
    snapshot.other_prov_female = demographics.otherProvFemale if demographics else None
    snapshot.foreign_male = demographics.foreignMale if demographics else None
    snapshot.foreign_female = demographics.foreignFemale if demographics else None


def mark_source_consolidated(source: EnterpriseReportSubmission) -> None:
    source.review_status = "Consolidated"
    source.remarks = "Included in final report consolidation."


async def generate_final_report_code(db: AsyncSession, period: str) -> str:
    parts = period.split()
    month = (parts[0] if parts else "Current")[:3].upper()
    year = next(
        (part for part in reversed(parts) if part.isdigit() and len(part) == 4),
        str(datetime.now(UTC).year),
    )
    prefix = f"CON-{month}-{year}"
    sequence = await db.scalar(select(FINAL_REPORT_CODE_SEQUENCE.next_value()))
    if sequence is None:
        raise RuntimeError("Final report code sequence did not return a value.")
    return f"{prefix}-{sequence:04d}"
