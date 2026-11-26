import json
from collections.abc import Mapping
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import ensure_aware
from app.core.json_values import parse_json_object
from app.features.accounts.attractions import ATTRACTION_CLASSIFICATIONS, attraction_category
from app.features.accounts.enterprise import require_enterprise_profile
from app.features.accounts.models import Account, AccountRole
from app.features.reporting.errors import (
    DuplicateReportPeriodError,
    InvalidReportWorkflowError,
)
from app.features.reporting.models import EnterpriseReportSubmission
from app.features.reporting.policies import (
    duplicate_report_period_message,
    validate_new_report_submission,
    validate_report_review_transition,
)
from app.features.reporting.schemas import (
    DesktopReportSubmissionIngest,
    IntakeReportSummary,
    ReportDemographicsSummary,
    ReportStatusUpdate,
)

REPORT_DEMOGRAPHIC_FIELDS = (
    "thisProvMale",
    "thisProvFemale",
    "otherProvMale",
    "otherProvFemale",
    "foreignMale",
    "foreignFemale",
)
OPTIONAL_REPORT_DEMOGRAPHIC_FIELDS = ("thisProvUnspecified",)
# This City/Municipality is a subset of This Province, so it is not part of the total.
CITY_DEMOGRAPHIC_FIELDS = (
    ("thisCityMale", "thisProvMale"),
    ("thisCityFemale", "thisProvFemale"),
    ("thisCityUnspecified", "thisProvUnspecified"),
)


async def ingest_report_submission(
    db: AsyncSession, account: Account, payload: DesktopReportSubmissionIngest
) -> IntakeReportSummary:
    profile = require_enterprise_profile(account)
    snapshot = (payload.payload or {}).get("counting")
    if snapshot is not None and snapshot.get("enterprise_id") != profile.enterprise_id:
        raise InvalidReportWorkflowError("The counting snapshot belongs to another establishment.")
    existing_report_id = await db.scalar(
        select(EnterpriseReportSubmission.id).where(
            EnterpriseReportSubmission.enterprise_profile_id == profile.account_id,
            EnterpriseReportSubmission.period == payload.period,
        )
    )
    validate_new_report_submission(payload.period, period_has_report=existing_report_id is not None)
    report_with_reused_id = await db.scalar(
        select(EnterpriseReportSubmission.id).where(
            EnterpriseReportSubmission.enterprise_profile_id == profile.account_id,
            EnterpriseReportSubmission.report_id == payload.reportId,
        )
    )
    if report_with_reused_id is not None:
        raise InvalidReportWorkflowError(
            "An existing report ID cannot be moved to a different reporting period."
        )

    report = EnterpriseReportSubmission(
        report_id=payload.reportId,
        enterprise_profile_id=profile.account_id,
        enterprise_name=profile.enterprise_name,
        attraction_code=profile.attraction_code,
        attraction_description=profile.attraction_description,
        barangay=profile.barangay or "Unassigned",
        period=payload.period,
        month=month_from_submission(payload.period),
        submitted_at=ensure_aware(payload.submittedAt),
        entries=payload.entries,
        exits=payload.exits,
        peak_occupancy=payload.peakOccupancy,
        unique_count=payload.uniqueCount,
        status="Submitted",
        review_status="Pending Review",
        notes=payload.notes,
        sync_status=payload.syncStatus,
        payload_json=json.dumps(
            {
                **payload.payload,
                "attractionCode": profile.attraction_code,
                "attractionDescription": profile.attraction_description,
            },
            sort_keys=True,
        ),
    )
    db.add(report)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise DuplicateReportPeriodError(duplicate_report_period_message(payload.period)) from exc

    profile.gateway_status = "Connected"
    await db.flush()
    await db.refresh(report)
    return to_intake_report_summary(report)


async def list_intake_reports(
    db: AsyncSession, account: Account | None, limit: int = 500
) -> list[IntakeReportSummary]:
    statement = (
        select(EnterpriseReportSubmission)
        .order_by(EnterpriseReportSubmission.submitted_at.desc())
        .limit(limit)
    )
    if account is not None and account.role == AccountRole.ENTERPRISE:
        statement = statement.where(EnterpriseReportSubmission.enterprise_profile_id == account.id)

    reports = (await db.scalars(statement)).all()
    return [to_intake_report_summary(report) for report in reports]


async def update_report_status(
    db: AsyncSession, report_id: str, payload: ReportStatusUpdate
) -> IntakeReportSummary | None:
    report = (
        await db.scalars(
            select(EnterpriseReportSubmission)
            .where(EnterpriseReportSubmission.id == report_id)
            .with_for_update(of=EnterpriseReportSubmission)
            .execution_options(populate_existing=True)
        )
    ).first()
    if report is None:
        report = (
            await db.scalars(
                select(EnterpriseReportSubmission)
                .where(EnterpriseReportSubmission.report_id == report_id)
                .with_for_update(of=EnterpriseReportSubmission)
                .execution_options(populate_existing=True)
            )
        ).first()
    if report is None:
        return None

    validate_report_review_transition(report.review_status, payload.status)
    report.review_status = payload.status
    report.remarks = payload.remarks
    await db.flush()
    await db.refresh(report)
    return to_intake_report_summary(report)


def to_intake_report_summary(report: EnterpriseReportSubmission) -> IntakeReportSummary:
    payload = parse_report_payload(report.payload_json)
    return IntakeReportSummary(
        id=report.id,
        enterpriseId=report.enterprise_profile.enterprise_id,
        enterprise=report.enterprise_name,
        category=attraction_category(report.attraction_code, report.attraction_description),
        attraction=ATTRACTION_CLASSIFICATIONS[report.attraction_code],
        attractionDescription=report.attraction_description,
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
            "peak": str(report.peak_occupancy) if report.peak_occupancy is not None else None,
        },
        payload=payload,
        demographics=report_demographics_from_payload(payload, report.unique_count),
    )


def parse_report_payload(payload_json: str | None) -> dict | None:
    return parse_json_object(payload_json)


def report_demographics_from_payload(
    payload: Mapping[str, object] | None, unique_count: int
) -> ReportDemographicsSummary | None:
    demo = payload.get("demo") if payload else None
    if not isinstance(demo, Mapping):
        return None

    values: dict[str, int] = {}
    for field in REPORT_DEMOGRAPHIC_FIELDS:
        value = report_non_negative_int(demo.get(field))
        if value is None:
            return None
        values[field] = value
    for field in OPTIONAL_REPORT_DEMOGRAPHIC_FIELDS:
        raw = demo.get(field)
        value = 0 if raw in (None, "") else report_non_negative_int(raw)
        if value is None:
            return None
        values[field] = value

    if sum(values.values()) != unique_count:
        return None

    return ReportDemographicsSummary(**values, **city_demographics(demo, values))


def city_demographics(demo: Mapping[str, object], province: Mapping[str, int]) -> dict[str, int]:
    """The This City/Municipality split, or nothing when it is missing or exceeds This Province."""
    city: dict[str, int] = {}
    for field, province_field in CITY_DEMOGRAPHIC_FIELDS:
        raw = demo.get(field)
        if raw in (None, "") and field == "thisCityUnspecified":
            value: int | None = 0
        else:
            value = report_non_negative_int(raw)
        if value is None or value > province[province_field]:
            return {}
        city[field] = value
    return city


def report_non_negative_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None


def month_from_submission(period: str) -> str:
    return period.split(" ", 1)[0]


def format_timestamp(value: datetime) -> str:
    return ensure_aware(value).strftime("%b %d, %Y %I:%M %p")
