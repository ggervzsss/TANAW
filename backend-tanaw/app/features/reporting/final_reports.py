from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import raiseload

from app.core.date_time import ensure_aware
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.reporting.counting import complete_sum
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
from app.features.reporting.periods import reporting_period_key
from app.features.reporting.policies import (
    FINAL_REPORT_ARCHIVED_STATUS,
    FINAL_REPORT_DRAFT_STATUS,
    final_report_consolidation_status,
    final_report_expected_enterprises,
    final_report_period,
    resolve_final_report_status_transition,
    to_final_report_archived_from_status,
    validate_final_report_sources,
    validate_final_report_target,
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
    """Consolidates a month's accepted reports into its one open consolidated report.

    With no open report for the month, this creates one; with a Draft, it adds the given reports.
    Either way the report is Finalized when the month is complete (every expected enterprise sent
    its report and every report is included) and stays a Draft otherwise. The included reports are
    marked Consolidated in both cases, so the desktop app shows them as consolidated.
    """
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
    period = consolidation_period(source_reports, payload.period)
    await lock_final_report_period(db, period)

    if payload.reportIds:
        already_consolidated = await db.scalar(
            select(FinalReportSource.id)
            .where(FinalReportSource.intake_report_id.in_(payload.reportIds))
            .limit(1)
        )
        if already_consolidated is not None:
            raise ReportAlreadyConsolidatedError(
                "One or more source reports already belong to another final report."
            )

    report = await find_open_final_report(db, period)
    validate_final_report_target(period, report.status if report else None)
    if report is None and not source_reports:
        raise InvalidReportWorkflowError(f"No accepted reports for {period} to consolidate yet.")

    now = datetime.now(UTC)
    try:
        if report is None:
            report = FinalReport(
                report_code=await generate_final_report_code(db, period),
                title="Citywide Tourism Aggregation",
                period=period,
                generated_on=now,
                prepared_by=payload.preparedBy,
                prepared_role="Staff Processing Division",
                status=FINAL_REPORT_DRAFT_STATUS,
                total_unique=0,
                enterprise_count=0,
                enterprise_total=0,
            )
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

    sources = (await load_final_report_sources(db, [report.id])).get(report.id, [])
    expected = final_report_expected_enterprises(
        await active_enterprise_ids(db), await period_reporting_enterprise_ids(db, period)
    )
    report.total_entry = complete_sum(source.entries for source in sources)
    report.total_exit = complete_sum(source.exits for source in sources)
    report.total_unique = sum(source.unique_count for source in sources)
    report.enterprise_count = len({source.enterprise_profile_id for source in sources})
    report.enterprise_total = len(expected)
    report.status = final_report_consolidation_status(
        expected_enterprise_ids=expected,
        period_reports=await period_report_statuses(db, period),
    )
    report.updated_at = now
    await db.flush()
    await db.refresh(report)
    return final_report_summary(report, sources)


def consolidation_period(
    source_reports: Sequence[EnterpriseReportSubmission], requested_period: str | None
) -> str:
    """The month to consolidate: the reports' month, or the requested month when no report is
    given (to finalize a draft that has nothing new to add)."""
    if source_reports:
        period = final_report_period(source_reports)
        if requested_period is not None and reporting_period_key(
            requested_period
        ) != reporting_period_key(period):
            raise InvalidReportWorkflowError(
                f"The reports belong to {period}, not {requested_period.strip()}."
            )
        return period
    period = (requested_period or "").strip()
    if reporting_period_key(period) is None:
        raise InvalidReportWorkflowError(
            "Reporting period must use the Month YYYY format, for example June 2026."
        )
    return period


async def lock_final_report_period(db: AsyncSession, period: str) -> None:
    """Serializes consolidations of one month, so concurrent requests add to one report."""
    key = reporting_period_key(period) or period.strip()
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"final-report:{key}"))))


async def find_open_final_report(
    db: AsyncSession, period: str, *, excluding_id: str | None = None
) -> FinalReport | None:
    """The month's consolidated report that is not archived, locked for update."""
    statement = select(FinalReport).where(
        FinalReport.period == period,
        FinalReport.status != FINAL_REPORT_ARCHIVED_STATUS,
    )
    if excluding_id is not None:
        statement = statement.where(FinalReport.id != excluding_id)
    statement = (
        statement.limit(1).with_for_update(of=FinalReport).execution_options(populate_existing=True)
    )
    return cast(FinalReport | None, await db.scalar(statement))


async def active_enterprise_ids(db: AsyncSession) -> set[str]:
    """Enterprises expected to report: active and activated, as the Staff Reports page lists them."""
    return set(
        await db.scalars(
            select(Account.id)
            .join(Account.enterprise_profile)
            .where(
                Account.role == AccountRole.ENTERPRISE,
                Account.status == AccountStatus.ACTIVE,
                Account.activated_at.is_not(None),
            )
        )
    )


async def period_reporting_enterprise_ids(db: AsyncSession, period: str) -> set[str]:
    return {enterprise_id for enterprise_id, _ in await period_report_statuses(db, period)}


async def period_report_statuses(db: AsyncSession, period: str) -> list[tuple[str, str]]:
    """Each of the month's reports as (enterprise id, review status)."""
    rows = await db.execute(
        select(
            EnterpriseReportSubmission.enterprise_profile_id,
            EnterpriseReportSubmission.review_status,
        ).where(EnterpriseReportSubmission.period == period)
    )
    return [(enterprise_id, review_status) for enterprise_id, review_status in rows.tuples()]


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
    restoring = (
        report.status == FINAL_REPORT_ARCHIVED_STATUS
        and next_status != FINAL_REPORT_ARCHIVED_STATUS
    )
    if restoring:
        await lock_final_report_period(db, report.period)
        if await find_open_final_report(db, report.period, excluding_id=report.id) is not None:
            raise InvalidReportWorkflowError(
                f"{report.period} already has a consolidated report. Archive it before restoring "
                "this one."
            )
    if (next_status, archived_from_status) != (report.status, report.archived_from_status):
        report.status = next_status
        report.archived_from_status = archived_from_status
        report.updated_at = datetime.now(UTC)
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
        generatedAt=ensure_aware(report.generated_on),
        updatedAt=ensure_aware(report.updated_at),
        preparedBy=report.prepared_by,
        preparedRole=report.prepared_role,
        status=report.status,  # type: ignore[arg-type]
        archivedFromStatus=to_final_report_archived_from_status(report.archived_from_status),
        totalEntry=report.total_entry,
        totalExit=report.total_exit,
        totalUnique=report.total_unique,
        enterpriseCount=report.enterprise_count,
        enterpriseTotal=report.enterprise_total,
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
