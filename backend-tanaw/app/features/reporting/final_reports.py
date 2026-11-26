from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import cast

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import raiseload

from app.core.date_time import ensure_aware
from app.features.accounts.models import Account, AccountRole
from app.features.reporting.counting import complete_sum
from app.features.reporting.errors import ReportAlreadyConsolidatedError
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
    final_report_period,
    resolve_final_report_status_transition,
    to_final_report_archived_from_status,
    validate_final_report_sources,
)
from app.features.reporting.schemas import (
    FinalReportCreate,
    FinalReportSourceSummary,
    FinalReportStatusUpdate,
    FinalReportSummary,
    ReportDemographicsSummary,
)

FINAL_REPORT_LIST_LIMIT = 500


async def list_final_reports(
    db: AsyncSession,
    account: Account,
    limit: int = FINAL_REPORT_LIST_LIMIT,
    offset: int = 0,
) -> list[FinalReportSummary]:
    statement = select(FinalReport)
    if account.role == AccountRole.ENTERPRISE:
        visible_final_report = (
            select(FinalReportSource.id)
            .join(
                EnterpriseReportSubmission,
                EnterpriseReportSubmission.id == FinalReportSource.intake_report_id,
            )
            .where(
                FinalReportSource.final_report_id == FinalReport.id,
                EnterpriseReportSubmission.enterprise_profile_id == account.id,
            )
            .exists()
        )
        statement = statement.where(visible_final_report)

    statement = (
        statement.order_by(FinalReport.generated_on.desc(), FinalReport.id.desc())
        .offset(offset)
        .limit(limit)
    )
    reports = list((await db.scalars(statement)).all())
    sources_by_report = await load_final_report_sources(db, [report.id for report in reports])

    return [
        final_report_summary(report, sources_by_report.get(report.id, ())) for report in reports
    ]


async def load_final_report_sources(
    db: AsyncSession, final_report_ids: Sequence[str]
) -> dict[str, list[FinalReportSource]]:
    sources_by_report: defaultdict[str, list[FinalReportSource]] = defaultdict(list)
    if not final_report_ids:
        return {}

    sources = (
        await db.scalars(
            select(FinalReportSource)
            .where(FinalReportSource.final_report_id.in_(final_report_ids))
            .options(raiseload(FinalReportSource.intake_report))
            .order_by(
                FinalReportSource.final_report_id.asc(),
                FinalReportSource.enterprise.asc(),
                FinalReportSource.intake_report_id.asc(),
            )
        )
    ).all()
    for source in sources:
        sources_by_report[source.final_report_id].append(source)
    return dict(sources_by_report)


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

    already_consolidated = await db.scalar(
        select(FinalReportSource.id)
        .where(FinalReportSource.intake_report_id.in_(payload.reportIds))
        .limit(1)
    )
    if already_consolidated is not None:
        raise ReportAlreadyConsolidatedError(
            "One or more source reports already belong to another final report."
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
        total_entry=complete_sum(item.entries for item in source_reports),
        total_exit=complete_sum(item.exits for item in source_reports),
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


async def update_final_report_status(
    db: AsyncSession, report_id: str, payload: FinalReportStatusUpdate
) -> FinalReportSummary | None:
    report = await find_final_report(db, report_id, for_update=True)
    if report is None:
        return None
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
    sources = await load_final_report_sources(db, [report.id])
    return final_report_summary(report, sources.get(report.id, ()))


def final_report_summary(
    report: FinalReport, sources: Sequence[FinalReportSource]
) -> FinalReportSummary:
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
                enterpriseProfileId=source.enterprise_profile_id,
                enterprise=source.enterprise,
                attractionCode=source.attraction_code,
                code=source.code,
                unique=source.unique_count,
                entry=source.entries,
                exit=source.exits,
                demographics=source_demographics(source),
                counting=source.counting_json,
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
    return ReportDemographicsSummary.model_validate(
        {
            **values,
            "thisProvUnspecified": source.this_prov_unspecified or 0,
            "thisCityMale": source.this_city_male,
            "thisCityFemale": source.this_city_female,
            "thisCityUnspecified": source.this_city_unspecified,
        }
    )


def final_report_source_snapshot(
    final_report_id: str, source: EnterpriseReportSubmission
) -> FinalReportSource:
    payload = parse_report_payload(source.payload_json) or {}
    demographics = report_demographics_from_payload(payload, source.unique_count)
    return FinalReportSource(
        final_report_id=final_report_id,
        intake_report_id=source.id,
        enterprise_profile_id=source.enterprise_profile_id,
        enterprise=source.enterprise_name,
        attraction_code=source.attraction_code,
        code=source.report_id,
        unique_count=source.unique_count,
        entries=source.entries,
        exits=source.exits,
        counting_json=payload.get("counting"),
        this_prov_male=demographics.thisProvMale if demographics else None,
        this_prov_female=demographics.thisProvFemale if demographics else None,
        this_prov_unspecified=demographics.thisProvUnspecified if demographics else None,
        other_prov_male=demographics.otherProvMale if demographics else None,
        other_prov_female=demographics.otherProvFemale if demographics else None,
        foreign_male=demographics.foreignMale if demographics else None,
        foreign_female=demographics.foreignFemale if demographics else None,
        this_city_male=demographics.thisCityMale if demographics else None,
        this_city_female=demographics.thisCityFemale if demographics else None,
        this_city_unspecified=demographics.thisCityUnspecified if demographics else None,
    )


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
