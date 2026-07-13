"""Set-based Staff readers for immutable official final-report versions."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import cast
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.features.accounts.models import Account, AccountRole
from app.features.final_reports.models import (
    FinalReportArtifact,
    FinalReportDemographicFact,
    FinalReportEvent,
    FinalReportItem,
    FinalReportMetricFact,
    FinalReportScopeMember,
    FinalReportVersion,
    ReportFinalization,
)
from app.features.final_reports.read_envelopes import (
    FinalReportArtifactResource,
    FinalReportDemographicFactResource,
    FinalReportDetail,
    FinalReportEventResource,
    FinalReportItemResource,
    FinalReportListItem,
    FinalReportMetricFactResource,
    FinalReportPage,
    FinalReportPreparedByResource,
    FinalReportScopeMemberResource,
    FinalReportScopeResource,
    FinalReportVersionResource,
    FinalReportVersionSummaryResource,
    FinalScopeType,
)
from app.features.reporting.models import ReportingPeriod
from app.features.reporting.read_cursor import (
    ReadCursorError,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.features.reporting.read_envelopes import CursorPageInfo, ReportingPeriodResource


class FinalReportReadError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class FinalReportReadForbidden(FinalReportReadError):
    pass


class FinalReportReadNotFound(FinalReportReadError):
    pass


class FinalReportReadInvalidCursor(FinalReportReadError):
    pass


@dataclass(frozen=True, slots=True)
class _FinalizationRow:
    finalization: ReportFinalization
    version: FinalReportVersion
    period: ReportingPeriod


async def list_official_final_reports(
    db: AsyncSession,
    *,
    account: Account,
    limit: int,
    cursor: str | None,
    reporting_period_id: UUID | None = None,
    scope_type: FinalScopeType | None = None,
) -> FinalReportPage:
    """Return newest-current-first logical finalizations using a stable keyset cursor."""

    _require_staff(account)
    if limit < 1 or limit > 100:
        raise FinalReportReadError(
            "FINAL_REPORT_PAGE_LIMIT_INVALID",
            "Final-report page limit must be 1 to 100.",
        )
    fingerprint = filter_fingerprint(
        {
            "classification": "official",
            "reportingPeriodId": (
                str(reporting_period_id) if reporting_period_id is not None else None
            ),
            "scopeType": scope_type,
        }
    )
    current_version = aliased(FinalReportVersion, name="current_final_report_version")
    statement = (
        select(ReportFinalization, current_version, ReportingPeriod)
        .join(
            current_version,
            and_(
                current_version.id == ReportFinalization.current_version_id,
                current_version.report_finalization_id == ReportFinalization.id,
                current_version.classification == ReportFinalization.classification,
            ),
        )
        .join(ReportingPeriod, ReportingPeriod.id == ReportFinalization.reporting_period_id)
        .where(
            ReportFinalization.classification == "official",
            current_version.classification == "official",
            current_version.disposition == "current",
        )
        .order_by(current_version.finalized_at.desc(), ReportFinalization.id.desc())
        .limit(limit + 1)
    )
    if reporting_period_id is not None:
        statement = statement.where(
            ReportFinalization.reporting_period_id == str(reporting_period_id)
        )
    if scope_type is not None:
        statement = statement.where(current_version.scope_type == scope_type)
    if cursor is not None:
        cursor_at, cursor_id = _decode_read_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            or_(
                current_version.finalized_at < cursor_at,
                and_(
                    current_version.finalized_at == cursor_at,
                    ReportFinalization.id < cursor_id,
                ),
            )
        )
    result_rows = (await db.execute(statement)).all()
    rows = [_finalization_row(row) for row in result_rows[:limit]]
    artifacts = await _artifacts_by_version(db, [row.version.id for row in rows])
    items = [_list_item(row, artifacts=artifacts[row.version.id]) for row in rows]
    has_more = len(result_rows) > limit
    next_cursor = (
        encode_cursor(
            occurred_at=rows[-1].version.finalized_at,
            resource_id=rows[-1].finalization.id,
            fingerprint=fingerprint,
        )
        if has_more and rows
        else None
    )
    return FinalReportPage(
        items=items,
        page=CursorPageInfo(
            limit=limit,
            returnedCount=len(items),
            hasMore=has_more,
            nextCursor=next_cursor,
        ),
    )


async def read_official_final_report(
    db: AsyncSession,
    *,
    account: Account,
    report_finalization_id: UUID,
    version_id: UUID | None = None,
) -> FinalReportDetail:
    """Return the current or explicitly selected immutable version of a finalization."""

    _require_staff(account)
    root = (
        await db.execute(
            select(ReportFinalization, ReportingPeriod)
            .join(ReportingPeriod, ReportingPeriod.id == ReportFinalization.reporting_period_id)
            .where(
                ReportFinalization.id == str(report_finalization_id),
                ReportFinalization.classification == "official",
            )
        )
    ).one_or_none()
    if root is None:
        raise FinalReportReadNotFound(
            "FINAL_REPORT_NOT_FOUND",
            "The requested official final report does not exist.",
        )
    root_values = cast(Sequence[object], root)
    finalization = cast(ReportFinalization, root_values[0])
    period = cast(ReportingPeriod, root_values[1])
    versions = list(
        await db.scalars(
            select(FinalReportVersion)
            .where(
                FinalReportVersion.report_finalization_id == finalization.id,
                FinalReportVersion.classification == "official",
            )
            .order_by(FinalReportVersion.version_number, FinalReportVersion.id)
        )
    )
    versions_by_id = {version.id: version for version in versions}
    selected_id = str(version_id) if version_id is not None else finalization.current_version_id
    selected_version = versions_by_id.get(selected_id)
    current_version = versions_by_id.get(finalization.current_version_id)
    if selected_version is None:
        raise FinalReportReadNotFound(
            "FINAL_REPORT_VERSION_NOT_FOUND",
            "The requested immutable version does not belong to this official final report.",
        )
    if current_version is None:
        raise RuntimeError("A logical final report references a missing current version.")

    version_ids = [version.id for version in versions]
    artifacts = await _artifacts_by_version(db, version_ids)
    summaries = [_version_summary(version, artifacts=artifacts[version.id]) for version in versions]
    selected_resource = await _version_resource(
        db,
        selected_version,
        artifacts=artifacts[selected_version.id],
    )
    events = await _events(db, finalization.id)
    root_row = _FinalizationRow(
        finalization=finalization,
        version=current_version,
        period=period,
    )
    summary = _list_item(root_row, artifacts=artifacts[current_version.id])
    return FinalReportDetail(
        **summary.model_dump(),
        selectedVersionId=UUID(selected_version.id),
        selectedVersionIsCurrent=selected_version.id == finalization.current_version_id,
        versions=summaries,
        selectedVersion=selected_resource,
        events=events,
    )


def _finalization_row(row: object) -> _FinalizationRow:
    values = cast(Sequence[object], row)
    return _FinalizationRow(
        finalization=cast(ReportFinalization, values[0]),
        version=cast(FinalReportVersion, values[1]),
        period=cast(ReportingPeriod, values[2]),
    )


def _list_item(
    row: _FinalizationRow,
    *,
    artifacts: list[FinalReportArtifactResource],
) -> FinalReportListItem:
    finalization = row.finalization
    return FinalReportListItem(
        reportFinalizationId=UUID(finalization.id),
        reportCode=finalization.report_code,
        reportingPeriod=_period_resource(row.period),
        classification="official",
        logicalVersion=finalization.logical_version,
        currentVersionId=UUID(finalization.current_version_id),
        currentVersion=_version_summary(row.version, artifacts=artifacts),
        createdByAccountId=(
            UUID(finalization.created_by_account_id)
            if finalization.created_by_account_id is not None
            else None
        ),
        createdAt=finalization.created_at,
        updatedAt=finalization.updated_at,
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


def _version_summary(
    version: FinalReportVersion,
    *,
    artifacts: list[FinalReportArtifactResource],
) -> FinalReportVersionSummaryResource:
    return FinalReportVersionSummaryResource.model_validate(
        {
            "finalReportVersionId": version.id,
            "versionNumber": version.version_number,
            "disposition": version.disposition,
            "scope": FinalReportScopeResource.model_validate(
                {
                    "type": version.scope_type,
                    "barangay": version.scope_barangay,
                    "label": version.scope_label,
                    "memberCount": version.scope_member_count,
                }
            ),
            "sourceCount": version.source_count,
            "contentHash": version.content_hash,
            "preparedBy": FinalReportPreparedByResource(
                accountId=(
                    UUID(version.prepared_by_account_id)
                    if version.prepared_by_account_id is not None
                    else None
                ),
                name=version.prepared_by_name,
                role=version.prepared_by_role,
            ),
            "finalizedAt": version.finalized_at,
            "artifacts": artifacts,
            "createdAt": version.created_at,
        }
    )


async def _version_resource(
    db: AsyncSession,
    version: FinalReportVersion,
    *,
    artifacts: list[FinalReportArtifactResource],
) -> FinalReportVersionResource:
    scope_members = list(
        await db.scalars(
            select(FinalReportScopeMember)
            .where(
                FinalReportScopeMember.final_report_version_id == version.id,
                FinalReportScopeMember.classification == "official",
            )
            .order_by(
                FinalReportScopeMember.enterprise_id,
                FinalReportScopeMember.site_id,
                FinalReportScopeMember.reporting_obligation_id,
            )
        )
    )
    items = list(
        await db.scalars(
            select(FinalReportItem)
            .where(
                FinalReportItem.final_report_version_id == version.id,
                FinalReportItem.classification == "official",
            )
            .order_by(FinalReportItem.reporting_obligation_id, FinalReportItem.report_revision_id)
        )
    )
    metrics = list(
        await db.scalars(
            select(FinalReportMetricFact)
            .where(
                FinalReportMetricFact.final_report_version_id == version.id,
                FinalReportMetricFact.classification == "official",
            )
            .order_by(
                FinalReportMetricFact.definition,
                FinalReportMetricFact.definition_version,
                FinalReportMetricFact.unit,
                FinalReportMetricFact.id,
            )
        )
    )
    demographics = list(
        await db.scalars(
            select(FinalReportDemographicFact)
            .where(
                FinalReportDemographicFact.final_report_version_id == version.id,
                FinalReportDemographicFact.classification == "official",
            )
            .order_by(
                FinalReportDemographicFact.dimension,
                FinalReportDemographicFact.value,
                FinalReportDemographicFact.id,
            )
        )
    )
    summary = _version_summary(version, artifacts=artifacts)
    return FinalReportVersionResource(
        **summary.model_dump(),
        scopeMembers=[
            FinalReportScopeMemberResource(
                scopeMemberId=UUID(member.id),
                reportingObligationId=UUID(member.reporting_obligation_id),
                enterpriseId=UUID(member.enterprise_id),
                enterpriseOfficialCode=member.enterprise_official_code,
                enterpriseName=member.enterprise_name,
                enterpriseCategory=member.enterprise_category,
                siteId=UUID(member.site_id),
                siteCode=member.site_code,
                siteName=member.site_name,
                frozenBarangay=member.frozen_barangay,
            )
            for member in scope_members
        ],
        items=[
            FinalReportItemResource(
                finalReportItemId=UUID(item.id),
                reportingObligationId=UUID(item.reporting_obligation_id),
                reportRevisionId=UUID(item.report_revision_id),
                sourcePayloadHash=item.source_payload_hash,
            )
            for item in items
        ],
        metrics=[
            FinalReportMetricFactResource.model_validate(
                {
                    "metricFactId": fact.id,
                    "definition": fact.definition,
                    "definitionVersion": fact.definition_version,
                    "value": fact.value,
                    "unit": fact.unit,
                    "aggregationMethod": fact.aggregation_method,
                    "quality": fact.quality,
                    "sourceFactCount": fact.source_fact_count,
                }
            )
            for fact in metrics
        ],
        demographics=[
            FinalReportDemographicFactResource.model_validate(
                {
                    "demographicFactId": fact.id,
                    "dimension": fact.dimension,
                    "value": fact.value,
                    "count": fact.count,
                    "percentage": fact.percentage,
                    "quality": fact.quality,
                    "sourceFactCount": fact.source_fact_count,
                }
            )
            for fact in demographics
        ],
    )


async def _artifacts_by_version(
    db: AsyncSession, version_ids: list[str]
) -> defaultdict[str, list[FinalReportArtifactResource]]:
    grouped: defaultdict[str, list[FinalReportArtifactResource]] = defaultdict(list)
    if not version_ids:
        return grouped
    artifacts = list(
        await db.scalars(
            select(FinalReportArtifact)
            .where(
                FinalReportArtifact.final_report_version_id.in_(version_ids),
                FinalReportArtifact.classification == "official",
            )
            .order_by(
                FinalReportArtifact.final_report_version_id,
                FinalReportArtifact.template_version,
                FinalReportArtifact.mime_type,
                FinalReportArtifact.id,
            )
        )
    )
    for artifact in artifacts:
        grouped[artifact.final_report_version_id].append(
            FinalReportArtifactResource.model_validate(
                {
                    "artifactId": artifact.id,
                    "status": artifact.status,
                    "templateVersion": artifact.template_version,
                    "mimeType": artifact.mime_type,
                    "contentHash": artifact.content_hash,
                    "generationAttempts": artifact.generation_attempts,
                    "lastErrorCode": artifact.last_error_code,
                    "generatedAt": artifact.generated_at,
                    "generatedByAccountId": artifact.generated_by_account_id,
                    "downloadAvailable": artifact.status == "ready",
                    "createdAt": artifact.created_at,
                    "updatedAt": artifact.updated_at,
                }
            )
        )
    return grouped


async def _events(db: AsyncSession, report_finalization_id: str) -> list[FinalReportEventResource]:
    events = list(
        await db.scalars(
            select(FinalReportEvent)
            .where(
                FinalReportEvent.report_finalization_id == report_finalization_id,
                FinalReportEvent.classification == "official",
            )
            .order_by(FinalReportEvent.occurred_at, FinalReportEvent.id)
        )
    )
    return [
        FinalReportEventResource.model_validate(
            {
                "finalReportEventId": event.id,
                "finalReportVersionId": event.final_report_version_id,
                "eventType": event.event_type,
                "actorAccountId": event.actor_account_id,
                "actorDisplayName": event.actor_display_name,
                "actorRole": event.actor_role,
                "commandId": event.command_id,
                "expectedVersion": event.expected_version,
                "resultingVersion": event.resulting_version,
                "reason": event.reason,
                "occurredAt": event.occurred_at,
            }
        )
        for event in events
    ]


def _decode_read_cursor(cursor: str, *, fingerprint: str) -> tuple[datetime, str]:
    try:
        return decode_cursor(cursor, fingerprint=fingerprint)
    except ReadCursorError as exc:
        raise FinalReportReadInvalidCursor("FINAL_REPORT_CURSOR_INVALID", str(exc)) from exc


def _require_staff(account: Account) -> None:
    if account.role != AccountRole.STAFF:
        raise FinalReportReadForbidden(
            "FINAL_REPORT_READ_FORBIDDEN",
            "Only an authenticated Staff account may read official final reports.",
        )
