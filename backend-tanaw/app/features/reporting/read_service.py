"""Set-based Staff read models for official enterprise reports."""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, cast
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.features.accounts.models import Account, AccountRole
from app.features.reporting.models import (
    EnterpriseReport,
    ReportDemographicFact,
    ReportingObligation,
    ReportingPeriod,
    ReportMetricFact,
    ReportReviewEvent,
    ReportRevision,
    ReportSourceBatch,
)
from app.features.reporting.read_cursor import (
    ReadCursorError,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.features.reporting.read_envelopes import (
    CursorPageInfo,
    EnterpriseReportDetail,
    EnterpriseReportListItem,
    EnterpriseReportPage,
    MetricCoverageResource,
    ReportCoverageGapResource,
    ReportCoverageResource,
    ReportDemographicFactResource,
    ReportEnterpriseResource,
    ReportingPeriodResource,
    ReportMetricFactResource,
    ReportObligationResource,
    ReportReviewActorResource,
    ReportReviewEventResource,
    ReportRevisionResource,
    ReportRevisionSummaryResource,
    ReportSiteResource,
    ReportSourceBatchResource,
    ReportWorkflowState,
)
from app.features.topology.models import Enterprise, EnterpriseSite


class ReportReadError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class ReportReadForbidden(ReportReadError):
    pass


class ReportReadNotFound(ReportReadError):
    pass


class ReportReadInvalidCursor(ReportReadError):
    pass


@dataclass(frozen=True, slots=True)
class _ReportRow:
    report: EnterpriseReport
    current_revision: ReportRevision
    obligation: ReportingObligation
    period: ReportingPeriod
    enterprise: Enterprise
    site: EnterpriseSite


async def list_official_enterprise_reports(
    db: AsyncSession,
    *,
    account: Account,
    limit: int,
    cursor: str | None,
    reporting_period_id: UUID | None = None,
    workflow_state: ReportWorkflowState | None = None,
    enterprise_id: UUID | None = None,
    site_id: UUID | None = None,
) -> EnterpriseReportPage:
    """Return an oldest-received, deterministic page of official report work."""

    _require_staff(account)
    if limit < 1 or limit > 100:
        raise ReportReadError("REPORT_PAGE_LIMIT_INVALID", "Report page limit must be 1 to 100.")
    fingerprint = filter_fingerprint(
        {
            "classification": "official",
            "enterpriseId": str(enterprise_id) if enterprise_id is not None else None,
            "reportingPeriodId": (
                str(reporting_period_id) if reporting_period_id is not None else None
            ),
            "siteId": str(site_id) if site_id is not None else None,
            "workflowState": workflow_state,
        }
    )
    current_revision = aliased(ReportRevision, name="current_report_revision")
    statement = (
        select(
            EnterpriseReport,
            current_revision,
            ReportingObligation,
            ReportingPeriod,
            Enterprise,
            EnterpriseSite,
        )
        .join(
            current_revision,
            and_(
                current_revision.id == EnterpriseReport.current_revision_id,
                current_revision.classification == EnterpriseReport.classification,
            ),
        )
        .join(
            ReportingObligation,
            ReportingObligation.id == EnterpriseReport.reporting_obligation_id,
        )
        .join(ReportingPeriod, ReportingPeriod.id == ReportingObligation.reporting_period_id)
        .join(Enterprise, Enterprise.id == EnterpriseReport.enterprise_id)
        .join(EnterpriseSite, EnterpriseSite.id == EnterpriseReport.site_id)
        .where(
            EnterpriseReport.classification == "official",
            current_revision.classification == "official",
            ReportingObligation.classification == "official",
            Enterprise.classification == "official",
            EnterpriseSite.classification == "official",
        )
        .order_by(current_revision.received_at, EnterpriseReport.id)
        .limit(limit + 1)
    )
    if reporting_period_id is not None:
        statement = statement.where(ReportingPeriod.id == str(reporting_period_id))
    if workflow_state is not None:
        statement = statement.where(EnterpriseReport.workflow_state == workflow_state)
    if enterprise_id is not None:
        statement = statement.where(EnterpriseReport.enterprise_id == str(enterprise_id))
    if site_id is not None:
        statement = statement.where(EnterpriseReport.site_id == str(site_id))
    if cursor is not None:
        cursor_at, cursor_id = _decode_read_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            or_(
                current_revision.received_at > cursor_at,
                and_(
                    current_revision.received_at == cursor_at,
                    EnterpriseReport.id > cursor_id,
                ),
            )
        )

    result_rows = (await db.execute(statement)).all()
    rows = [_report_row(row) for row in result_rows[:limit]]
    metrics_by_revision = await _metrics_by_revision(db, [row.current_revision.id for row in rows])
    items = [
        _report_list_item(row, metrics=metrics_by_revision[row.current_revision.id]) for row in rows
    ]
    has_more = len(result_rows) > limit
    next_cursor = (
        encode_cursor(
            occurred_at=rows[-1].current_revision.received_at,
            resource_id=rows[-1].report.id,
            fingerprint=fingerprint,
        )
        if has_more and rows
        else None
    )
    return EnterpriseReportPage(
        items=items,
        page=CursorPageInfo(
            limit=limit,
            returnedCount=len(items),
            hasMore=has_more,
            nextCursor=next_cursor,
        ),
    )


async def read_official_enterprise_report(
    db: AsyncSession,
    *,
    account: Account,
    enterprise_report_id: UUID,
) -> EnterpriseReportDetail:
    """Return the complete immutable revision and audit graph for one official report."""

    _require_staff(account)
    current_revision = aliased(ReportRevision, name="current_report_revision")
    result = (
        await db.execute(
            select(
                EnterpriseReport,
                current_revision,
                ReportingObligation,
                ReportingPeriod,
                Enterprise,
                EnterpriseSite,
            )
            .join(
                current_revision,
                and_(
                    current_revision.id == EnterpriseReport.current_revision_id,
                    current_revision.classification == EnterpriseReport.classification,
                ),
            )
            .join(
                ReportingObligation,
                ReportingObligation.id == EnterpriseReport.reporting_obligation_id,
            )
            .join(ReportingPeriod, ReportingPeriod.id == ReportingObligation.reporting_period_id)
            .join(Enterprise, Enterprise.id == EnterpriseReport.enterprise_id)
            .join(EnterpriseSite, EnterpriseSite.id == EnterpriseReport.site_id)
            .where(
                EnterpriseReport.id == str(enterprise_report_id),
                EnterpriseReport.classification == "official",
                current_revision.classification == "official",
                ReportingObligation.classification == "official",
                Enterprise.classification == "official",
                EnterpriseSite.classification == "official",
            )
        )
    ).one_or_none()
    if result is None:
        raise ReportReadNotFound(
            "ENTERPRISE_REPORT_NOT_FOUND",
            "The requested official enterprise report does not exist.",
        )
    row = _report_row(result)
    revisions = list(
        await db.scalars(
            select(ReportRevision)
            .where(
                ReportRevision.enterprise_report_id == row.report.id,
                ReportRevision.classification == "official",
            )
            .order_by(ReportRevision.revision_number, ReportRevision.id)
        )
    )
    revision_ids = [revision.id for revision in revisions]
    metrics_by_revision = await _metrics_by_revision(db, revision_ids)
    demographics_by_revision = await _demographics_by_revision(db, revision_ids)
    batches_by_revision = await _source_batches_by_revision(db, revision_ids)
    review_events = await _review_events(db, row.report.id)
    summary = _report_list_item(
        row,
        metrics=metrics_by_revision[row.current_revision.id],
    )
    return EnterpriseReportDetail(
        **summary.model_dump(),
        revisions=[
            _revision_resource(
                revision,
                report=row.report,
                metrics=metrics_by_revision[revision.id],
                demographics=demographics_by_revision[revision.id],
                source_batches=batches_by_revision[revision.id],
            )
            for revision in revisions
        ],
        reviewEvents=review_events,
    )


def _report_row(row: object) -> _ReportRow:
    values = cast(Sequence[object], row)
    return _ReportRow(
        report=cast(EnterpriseReport, values[0]),
        current_revision=cast(ReportRevision, values[1]),
        obligation=cast(ReportingObligation, values[2]),
        period=cast(ReportingPeriod, values[3]),
        enterprise=cast(Enterprise, values[4]),
        site=cast(EnterpriseSite, values[5]),
    )


def _report_list_item(
    row: _ReportRow,
    *,
    metrics: list[ReportMetricFactResource],
) -> EnterpriseReportListItem:
    report = row.report
    current_revision = row.current_revision
    return EnterpriseReportListItem(
        enterpriseReportId=UUID(report.id),
        classification="official",
        workflowState=cast(ReportWorkflowState, report.workflow_state),
        logicalVersion=report.logical_version,
        currentRevisionId=UUID(report.current_revision_id),
        acceptedRevisionId=(
            UUID(report.accepted_revision_id) if report.accepted_revision_id is not None else None
        ),
        includedInOfficialTotals=_included_in_official_totals(report),
        acceptanceBlocked=report.acceptance_blocked,
        reportingPeriod=_period_resource(row.period),
        obligation=_obligation_resource(row.obligation),
        enterprise=ReportEnterpriseResource(
            enterpriseId=UUID(row.enterprise.id),
            enterpriseCode=row.enterprise.official_code,
            enterpriseName=row.enterprise.name,
            category=row.enterprise.category,
        ),
        site=ReportSiteResource(
            siteId=UUID(row.site.id),
            siteCode=row.site.site_code,
            siteName=row.site.name,
            frozenBarangay=row.obligation.frozen_barangay,
        ),
        currentRevision=_revision_summary(current_revision, report=report, metrics=metrics),
        createdAt=report.created_at,
        updatedAt=report.updated_at,
    )


def _period_resource(period: ReportingPeriod) -> ReportingPeriodResource:
    return ReportingPeriodResource(
        reportingPeriodId=UUID(period.id),
        naturalKey=period.natural_key,
        label=period.label,
        cadence="month",
        timezone="Asia/Manila",
        startsAt=period.starts_at,
        endsAt=period.ends_at,
        submissionOpensAt=period.submission_opens_at,
    )


def _obligation_resource(obligation: ReportingObligation) -> ReportObligationResource:
    return ReportObligationResource.model_validate(
        {
            "reportingObligationId": obligation.id,
            "eligibilityStatus": obligation.eligibility_status,
            "eligibilityBasis": obligation.eligibility_basis,
            "exemptionReason": obligation.exemption_reason,
            "registrationEffectiveAt": obligation.registration_effective_at,
            "acceptanceBlocked": obligation.acceptance_blocked,
        }
    )


def _revision_summary(
    revision: ReportRevision,
    *,
    report: EnterpriseReport,
    metrics: list[ReportMetricFactResource],
) -> ReportRevisionSummaryResource:
    return ReportRevisionSummaryResource(
        reportRevisionId=UUID(revision.id),
        revisionNumber=revision.revision_number,
        isCurrent=revision.id == report.current_revision_id,
        isAccepted=revision.id == report.accepted_revision_id,
        submittedAt=revision.submitted_at,
        receivedAt=revision.received_at,
        payloadHash=revision.payload_hash,
        evidenceStatus=cast(Literal["complete", "incomplete"], revision.evidence_status),
        acceptanceBlocked=revision.acceptance_blocked,
        coverage=_report_coverage(revision),
        metrics=metrics,
    )


def _revision_resource(
    revision: ReportRevision,
    *,
    report: EnterpriseReport,
    metrics: list[ReportMetricFactResource],
    demographics: list[ReportDemographicFactResource],
    source_batches: list[ReportSourceBatchResource],
) -> ReportRevisionResource:
    summary = _revision_summary(revision, report=report, metrics=metrics)
    return ReportRevisionResource(
        **summary.model_dump(),
        localRevisionId=revision.local_revision_id,
        idempotencyKey=revision.idempotency_key,
        sourceWindowStart=revision.source_window_start,
        sourceWindowEnd=revision.source_window_end,
        submittedByAccountId=UUID(revision.submitted_by_account_id),
        notes=revision.notes,
        demographics=demographics,
        sourceBatches=source_batches,
    )


async def _metrics_by_revision(
    db: AsyncSession, revision_ids: list[str]
) -> defaultdict[str, list[ReportMetricFactResource]]:
    grouped: defaultdict[str, list[ReportMetricFactResource]] = defaultdict(list)
    if not revision_ids:
        return grouped
    facts = list(
        await db.scalars(
            select(ReportMetricFact)
            .where(
                ReportMetricFact.report_revision_id.in_(revision_ids),
                ReportMetricFact.classification == "official",
            )
            .order_by(
                ReportMetricFact.report_revision_id,
                ReportMetricFact.definition,
                ReportMetricFact.definition_version,
                ReportMetricFact.grain,
                ReportMetricFact.id,
            )
        )
    )
    for fact in facts:
        grouped[fact.report_revision_id].append(_metric_resource(fact))
    return grouped


def _metric_resource(fact: ReportMetricFact) -> ReportMetricFactResource:
    recorded = fact.monitored_seconds is not None and fact.expected_seconds is not None
    return ReportMetricFactResource.model_validate(
        {
            "metricFactId": fact.id,
            "definition": fact.definition,
            "definitionVersion": fact.definition_version,
            "value": fact.value,
            "unit": fact.unit,
            "grain": fact.grain,
            "windowStart": fact.window_start,
            "windowEnd": fact.window_end,
            "timezone": fact.timezone_name,
            "provenance": fact.provenance,
            "quality": fact.quality,
            "coverage": MetricCoverageResource(
                evidenceStatus="recorded" if recorded else "not_recorded",
                monitoredSeconds=fact.monitored_seconds,
                expectedSeconds=fact.expected_seconds,
                coverageRatio=_coverage_ratio(fact.monitored_seconds, fact.expected_seconds),
                gapCount=fact.coverage_gap_count,
            ),
        }
    )


async def _demographics_by_revision(
    db: AsyncSession, revision_ids: list[str]
) -> defaultdict[str, list[ReportDemographicFactResource]]:
    grouped: defaultdict[str, list[ReportDemographicFactResource]] = defaultdict(list)
    if not revision_ids:
        return grouped
    facts = list(
        await db.scalars(
            select(ReportDemographicFact)
            .where(
                ReportDemographicFact.report_revision_id.in_(revision_ids),
                ReportDemographicFact.classification == "official",
            )
            .order_by(
                ReportDemographicFact.report_revision_id,
                ReportDemographicFact.dimension,
                ReportDemographicFact.value,
                ReportDemographicFact.id,
            )
        )
    )
    for fact in facts:
        grouped[fact.report_revision_id].append(
            ReportDemographicFactResource.model_validate(
                {
                    "demographicFactId": fact.id,
                    "dimension": fact.dimension,
                    "value": fact.value,
                    "count": fact.count,
                    "percentage": fact.percentage,
                    "provenance": fact.provenance,
                    "quality": fact.quality,
                }
            )
        )
    return grouped


async def _source_batches_by_revision(
    db: AsyncSession, revision_ids: list[str]
) -> defaultdict[str, list[ReportSourceBatchResource]]:
    grouped: defaultdict[str, list[ReportSourceBatchResource]] = defaultdict(list)
    if not revision_ids:
        return grouped
    batches = list(
        await db.scalars(
            select(ReportSourceBatch)
            .where(
                ReportSourceBatch.report_revision_id.in_(revision_ids),
                ReportSourceBatch.classification == "official",
            )
            .order_by(
                ReportSourceBatch.report_revision_id,
                ReportSourceBatch.camera_id,
                ReportSourceBatch.event_sequence_start,
                ReportSourceBatch.id,
            )
        )
    )
    for batch in batches:
        grouped[batch.report_revision_id].append(
            ReportSourceBatchResource(
                batchId=UUID(batch.id),
                cameraId=UUID(batch.camera_id),
                eventCount=batch.event_count,
                eventSequenceStart=batch.event_sequence_start,
                eventSequenceEndExclusive=batch.event_sequence_end_exclusive,
                aggregateHash=batch.aggregate_hash,
            )
        )
    return grouped


async def _review_events(
    db: AsyncSession, enterprise_report_id: str
) -> list[ReportReviewEventResource]:
    events = list(
        await db.scalars(
            select(ReportReviewEvent)
            .where(
                ReportReviewEvent.enterprise_report_id == enterprise_report_id,
                ReportReviewEvent.classification == "official",
            )
            .order_by(ReportReviewEvent.occurred_at, ReportReviewEvent.id)
        )
    )
    return [
        ReportReviewEventResource.model_validate(
            {
                "reviewEventId": event.id,
                "reportRevisionId": event.report_revision_id,
                "eventType": event.event_type,
                "fromState": event.from_state,
                "toState": event.to_state,
                "actor": ReportReviewActorResource(
                    accountId=(
                        UUID(event.actor_account_id) if event.actor_account_id is not None else None
                    ),
                    displayName=event.actor_display_name,
                    role=event.actor_role,
                ),
                "reason": event.reason,
                "commandId": event.command_id,
                "expectedVersion": event.expected_version,
                "resultingVersion": event.resulting_version,
                "occurredAt": event.occurred_at,
            }
        )
        for event in events
    ]


def _report_coverage(revision: ReportRevision) -> ReportCoverageResource:
    recorded = revision.monitored_seconds is not None and revision.expected_seconds is not None
    gaps: list[ReportCoverageGapResource] = []
    if recorded and revision.coverage_details_json is not None:
        try:
            raw_gaps = json.loads(revision.coverage_details_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"Report revision {revision.id} has invalid durable coverage JSON."
            ) from exc
        if not isinstance(raw_gaps, list):
            raise RuntimeError(f"Report revision {revision.id} has invalid durable coverage facts.")
        gaps = [ReportCoverageGapResource.model_validate(item) for item in raw_gaps]
    return ReportCoverageResource(
        evidenceStatus="recorded" if recorded else "not_recorded",
        monitoredSeconds=revision.monitored_seconds,
        expectedSeconds=revision.expected_seconds,
        coverageRatio=_coverage_ratio(revision.monitored_seconds, revision.expected_seconds),
        gapCount=revision.coverage_gap_count,
        gaps=gaps,
    )


def _coverage_ratio(monitored_seconds: int | None, expected_seconds: int | None) -> float | None:
    if monitored_seconds is None or expected_seconds is None:
        return None
    return monitored_seconds / expected_seconds


def _included_in_official_totals(report: EnterpriseReport) -> bool:
    return (
        report.workflow_state in {"accepted", "consolidated"}
        and report.accepted_revision_id is not None
        and report.accepted_revision_id == report.current_revision_id
        and not report.acceptance_blocked
    )


def _decode_read_cursor(cursor: str, *, fingerprint: str) -> tuple[datetime, str]:
    try:
        return decode_cursor(cursor, fingerprint=fingerprint)
    except ReadCursorError as exc:
        raise ReportReadInvalidCursor("REPORT_CURSOR_INVALID", str(exc)) from exc


def _require_staff(account: Account) -> None:
    if account.role != AccountRole.STAFF:
        raise ReportReadForbidden(
            "REPORT_READ_FORBIDDEN",
            "Only an authenticated Staff account may read the official report work queue.",
        )
