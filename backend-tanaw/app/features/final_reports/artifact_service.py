"""Generation, integrity verification, and scoped access for final-report PDFs."""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.features.accounts.models import Account, AccountRole
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.final_reports.artifact_envelopes import FinalReportArtifactDetail
from app.features.final_reports.artifact_rendering import (
    TEMPLATE_VERSION,
    ArtifactRenderError,
    ArtifactRenderSnapshot,
    render_final_report_pdf,
)
from app.features.final_reports.artifact_storage import (
    PDF_MIME_TYPE,
    ArtifactStorage,
    ArtifactStorageConflict,
    ArtifactStorageError,
    ArtifactStorageIntegrityError,
    StoredArtifact,
)
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
from app.features.reporting.envelopes import canonical_payload_hash
from app.features.reporting.models import ReportingPeriod
from app.features.topology.access import (
    EnterpriseTopologyAccessError,
    require_effective_enterprise_access,
)

logger = logging.getLogger("uvicorn.error")


class FinalReportArtifactError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class FinalReportArtifactForbidden(FinalReportArtifactError):
    pass


class FinalReportArtifactNotFound(FinalReportArtifactError):
    pass


class FinalReportArtifactNotReady(FinalReportArtifactError):
    pass


class FinalReportArtifactUnavailable(FinalReportArtifactError):
    pass


class ArtifactGenerationFailure(RuntimeError):
    def __init__(self, code: str, *, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True, slots=True)
class FinalReportArtifactDownload:
    content: bytes
    mime_type: str
    content_hash: str
    size_bytes: int
    filename: str


@dataclass(frozen=True, slots=True)
class _ArtifactGraph:
    artifact: FinalReportArtifact
    version: FinalReportVersion
    finalization: ReportFinalization
    period: ReportingPeriod
    render_snapshot: ArtifactRenderSnapshot


@dataclass(frozen=True, slots=True)
class _ArtifactEventContext:
    version: FinalReportVersion
    finalization: ReportFinalization
    period: ReportingPeriod


class FinalReportArtifactProcessor:
    """Claim pending rows with database locks and render each effect idempotently."""

    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        storage: ArtifactStorage,
        settings: Settings,
    ) -> None:
        self._sessions = sessions
        self._storage = storage
        self._settings = settings

    async def run_batch(self) -> int:
        processed = 0
        for index in range(self._settings.final_report_artifact_batch_size):
            if not await self._process_next(requeue_failed=index == 0):
                break
            processed += 1
        return processed

    async def _process_next(self, *, requeue_failed: bool) -> bool:
        async with self._sessions() as db:
            if requeue_failed:
                await self._requeue_one(db)
            artifact = await db.scalar(
                select(FinalReportArtifact)
                .where(
                    FinalReportArtifact.classification == "official",
                    FinalReportArtifact.status.in_(("pending", "repairing")),
                    (
                        (FinalReportArtifact.status == "repairing")
                        | (
                            FinalReportArtifact.generation_attempts
                            < self._settings.final_report_artifact_max_attempts
                        )
                    ),
                )
                .order_by(FinalReportArtifact.updated_at, FinalReportArtifact.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if artifact is None:
                await db.commit()
                return False
            await self._generate_locked(db, artifact)
            await db.commit()
            return True

    async def _requeue_one(self, db: AsyncSession) -> None:
        failed = await db.scalar(
            select(FinalReportArtifact)
            .where(
                FinalReportArtifact.classification == "official",
                FinalReportArtifact.status == "failed",
                FinalReportArtifact.generation_attempts
                < self._settings.final_report_artifact_max_attempts,
            )
            .order_by(FinalReportArtifact.updated_at, FinalReportArtifact.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if failed is not None:
            failed.status = "pending"
            failed.last_error_code = None
            context = await _load_artifact_event_context(db, failed)
            await _record_artifact_lifecycle(
                db,
                artifact=failed,
                context=context,
                event_type="artifact_retry_scheduled",
                occurred_at=datetime.now(UTC),
            )
            await db.flush([failed])

    async def _generate_locked(self, db: AsyncSession, artifact: FinalReportArtifact) -> None:
        context = await _load_artifact_event_context(db, artifact)
        occurred_at = datetime.now(UTC)
        try:
            graph = await _load_artifact_graph(db, artifact)
            generated_by = graph.version.prepared_by_account_id
            if generated_by is None:
                raise ArtifactGenerationFailure(
                    "ARTIFACT_PREPARER_ACCOUNT_MISSING",
                    retryable=False,
                )
            content = render_final_report_pdf(graph.render_snapshot)
            key = _storage_key(graph)
            stored = await self._storage.put(
                key=key,
                mime_type=artifact.mime_type,
                content=content,
            )
            _verify_generated_object(stored, expected_content=content)
            artifact.status = "ready"
            artifact.storage_key = key
            artifact.content_hash = stored.content_hash
            artifact.generation_attempts += 1
            artifact.last_error_code = None
            artifact.generated_at = occurred_at
            # The immutable preparer is the recorded human principal on whose
            # accepted finalization command the automated render is performed.
            artifact.generated_by_account_id = generated_by
            await _record_artifact_lifecycle(
                db,
                artifact=artifact,
                context=context,
                event_type="artifact_ready",
                occurred_at=occurred_at,
            )
        except ArtifactGenerationFailure as exc:
            self._mark_failed(artifact, code=exc.code, retryable=exc.retryable)
            await _record_artifact_lifecycle(
                db,
                artifact=artifact,
                context=context,
                event_type="artifact_failed",
                occurred_at=occurred_at,
            )
        except (ArtifactStorageConflict, ArtifactStorageIntegrityError) as exc:
            logger.error(
                "Final-report artifact generation integrity failure artifact_id=%s type=%s",
                artifact.id,
                type(exc).__name__,
            )
            self._mark_failed(artifact, code="ARTIFACT_STORAGE_INTEGRITY_FAILURE", retryable=False)
            await _record_artifact_lifecycle(
                db,
                artifact=artifact,
                context=context,
                event_type="artifact_failed",
                occurred_at=occurred_at,
            )
        except ArtifactStorageError as exc:
            logger.warning(
                "Final-report artifact storage failure artifact_id=%s type=%s",
                artifact.id,
                type(exc).__name__,
            )
            self._mark_failed(artifact, code="ARTIFACT_STORAGE_UNAVAILABLE", retryable=True)
            await _record_artifact_lifecycle(
                db,
                artifact=artifact,
                context=context,
                event_type="artifact_failed",
                occurred_at=occurred_at,
            )
        except ArtifactRenderError:
            self._mark_failed(artifact, code="ARTIFACT_RENDER_REJECTED", retryable=False)
            await _record_artifact_lifecycle(
                db,
                artifact=artifact,
                context=context,
                event_type="artifact_failed",
                occurred_at=occurred_at,
            )
        except Exception:
            logger.exception("Unexpected final-report artifact failure artifact_id=%s", artifact.id)
            self._mark_failed(artifact, code="ARTIFACT_INTERNAL_ERROR", retryable=True)
            await _record_artifact_lifecycle(
                db,
                artifact=artifact,
                context=context,
                event_type="artifact_failed",
                occurred_at=occurred_at,
            )

    def _mark_failed(
        self,
        artifact: FinalReportArtifact,
        *,
        code: str,
        retryable: bool,
    ) -> None:
        artifact.status = "failed"
        next_attempt = artifact.generation_attempts + 1
        artifact.generation_attempts = (
            next_attempt
            if retryable
            else max(next_attempt, self._settings.final_report_artifact_max_attempts)
        )
        artifact.last_error_code = code[:120]
        artifact.storage_key = None
        artifact.content_hash = None
        artifact.generated_at = None
        artifact.generated_by_account_id = None


async def read_final_report_artifact_metadata(
    db: AsyncSession,
    *,
    storage: ArtifactStorage,
    account: Account,
    report_finalization_id: str,
    artifact_id: str,
    evaluated_at: datetime | None = None,
) -> FinalReportArtifactDetail:
    artifact, version, _finalization = await _authorize_artifact(
        db,
        account=account,
        report_finalization_id=report_finalization_id,
        artifact_id=artifact_id,
        evaluated_at=evaluated_at,
    )
    stored: StoredArtifact | None = None
    if artifact.status == "ready":
        try:
            stored = await _read_verified_ready_artifact(storage, artifact)
        except FinalReportArtifactUnavailable:
            await _request_artifact_repair(
                db,
                artifact=artifact,
                version=version,
                finalization=_finalization,
            )
            await db.commit()
            raise
    return FinalReportArtifactDetail.model_validate(
        {
            "reportFinalizationId": report_finalization_id,
            "finalReportVersionId": version.id,
            "artifactId": artifact.id,
            "status": artifact.status,
            "templateVersion": artifact.template_version,
            "mimeType": artifact.mime_type,
            "contentHash": artifact.content_hash,
            "sizeBytes": stored.size_bytes if stored is not None else None,
            "generationAttempts": artifact.generation_attempts,
            "lastErrorCode": artifact.last_error_code,
            "generatedAt": artifact.generated_at,
            "generatedByAccountId": artifact.generated_by_account_id,
            "downloadAvailable": artifact.status == "ready" and stored is not None,
            "createdAt": artifact.created_at,
            "updatedAt": artifact.updated_at,
        }
    )


async def download_final_report_artifact(
    db: AsyncSession,
    *,
    storage: ArtifactStorage,
    account: Account,
    report_finalization_id: str,
    artifact_id: str,
    evaluated_at: datetime | None = None,
) -> FinalReportArtifactDownload:
    artifact, version, finalization = await _authorize_artifact(
        db,
        account=account,
        report_finalization_id=report_finalization_id,
        artifact_id=artifact_id,
        evaluated_at=evaluated_at,
    )
    if artifact.status != "ready":
        raise FinalReportArtifactNotReady(
            "FINAL_REPORT_ARTIFACT_NOT_READY",
            "The final-report artifact is not ready for download.",
        )
    try:
        stored = await _read_verified_ready_artifact(storage, artifact)
    except FinalReportArtifactUnavailable:
        await _request_artifact_repair(
            db,
            artifact=artifact,
            version=version,
            finalization=finalization,
        )
        await db.commit()
        raise
    filename = (
        f"TANAW-{_safe_filename_part(finalization.report_code)}-v{version.version_number}.pdf"
    )
    return FinalReportArtifactDownload(
        content=stored.content,
        mime_type=stored.mime_type,
        content_hash=stored.content_hash,
        size_bytes=stored.size_bytes,
        filename=filename,
    )


async def _authorize_artifact(
    db: AsyncSession,
    *,
    account: Account,
    report_finalization_id: str,
    artifact_id: str,
    evaluated_at: datetime | None,
) -> tuple[FinalReportArtifact, FinalReportVersion, ReportFinalization]:
    enterprise_id: str | None = None
    if account.role == AccountRole.ENTERPRISE:
        try:
            scope = await require_effective_enterprise_access(
                db,
                account_id=account.id,
                evaluated_at=evaluated_at or datetime.now(UTC),
            )
        except EnterpriseTopologyAccessError as exc:
            raise FinalReportArtifactForbidden(exc.code, exc.message) from exc
        if scope.classification != "official":
            raise FinalReportArtifactForbidden(
                "ENTERPRISE_SCOPE_INVALID",
                "The authenticated enterprise is not in the official reporting scope.",
            )
        enterprise_id = scope.enterprise_id
    elif account.role != AccountRole.STAFF:
        raise FinalReportArtifactForbidden(
            "FINAL_REPORT_ARTIFACT_FORBIDDEN",
            "The authenticated account cannot access official final-report artifacts.",
        )

    artifact = await db.scalar(
        select(FinalReportArtifact).where(
            FinalReportArtifact.id == artifact_id,
            FinalReportArtifact.classification == "official",
        )
    )
    if artifact is None:
        raise _artifact_not_found()
    version = await db.get(FinalReportVersion, artifact.final_report_version_id)
    if version is None or version.classification != "official":
        raise _artifact_not_found()
    finalization = await db.get(ReportFinalization, version.report_finalization_id)
    if (
        finalization is None
        or finalization.id != report_finalization_id
        or finalization.classification != "official"
    ):
        raise _artifact_not_found()
    if enterprise_id is not None:
        member_id = await db.scalar(
            select(FinalReportScopeMember.id)
            .where(
                FinalReportScopeMember.final_report_version_id == version.id,
                FinalReportScopeMember.classification == "official",
                FinalReportScopeMember.enterprise_id == enterprise_id,
            )
            .limit(1)
        )
        if member_id is None:
            # Use the same response as a missing artifact to avoid exposing a
            # finalization outside the enterprise's frozen version scope.
            raise _artifact_not_found()
    return artifact, version, finalization


async def _read_verified_ready_artifact(
    storage: ArtifactStorage,
    artifact: FinalReportArtifact,
) -> StoredArtifact:
    if (
        artifact.storage_key is None
        or artifact.content_hash is None
        or artifact.mime_type != PDF_MIME_TYPE
    ):
        _log_download_integrity_failure(artifact.id, "ready_metadata_invalid")
        raise _artifact_unavailable()
    try:
        stored = await storage.read(key=artifact.storage_key)
    except ArtifactStorageError as exc:
        _log_download_integrity_failure(artifact.id, type(exc).__name__)
        raise _artifact_unavailable() from exc
    if (
        stored.mime_type != artifact.mime_type
        or stored.content_hash != artifact.content_hash
        or stored.size_bytes != len(stored.content)
    ):
        _log_download_integrity_failure(artifact.id, "database_metadata_mismatch")
        raise _artifact_unavailable()
    return stored


async def _request_artifact_repair(
    db: AsyncSession,
    *,
    artifact: FinalReportArtifact,
    version: FinalReportVersion,
    finalization: ReportFinalization,
) -> None:
    """Atomically make a corrupt ready object unavailable and queue one repair."""

    locked = await db.scalar(
        select(FinalReportArtifact)
        .where(
            FinalReportArtifact.id == artifact.id,
            FinalReportArtifact.classification == "official",
        )
        .with_for_update()
    )
    if locked is None or locked.status != "ready":
        return
    period = await db.get(ReportingPeriod, finalization.reporting_period_id)
    if period is None:
        raise FinalReportArtifactUnavailable(
            "FINAL_REPORT_ARTIFACT_REPAIR_CONTEXT_MISSING",
            "The final-report artifact repair context is unavailable.",
        )
    locked.status = "repairing"
    locked.storage_key = None
    locked.content_hash = None
    locked.last_error_code = "ARTIFACT_INTEGRITY_REPAIR_QUEUED"
    locked.generated_at = None
    locked.generated_by_account_id = None
    await _record_artifact_lifecycle(
        db,
        artifact=locked,
        context=_ArtifactEventContext(
            version=version,
            finalization=finalization,
            period=period,
        ),
        event_type="artifact_repair_requested",
        occurred_at=datetime.now(UTC),
    )
    await db.flush()


async def _load_artifact_graph(
    db: AsyncSession,
    artifact: FinalReportArtifact,
) -> _ArtifactGraph:
    if (
        artifact.classification != "official"
        or artifact.template_version != TEMPLATE_VERSION
        or artifact.mime_type != PDF_MIME_TYPE
    ):
        raise ArtifactGenerationFailure("ARTIFACT_RENDERING_IDENTITY_INVALID", retryable=False)
    version = await db.get(FinalReportVersion, artifact.final_report_version_id)
    if version is None or version.classification != "official":
        raise ArtifactGenerationFailure("ARTIFACT_VERSION_MISSING", retryable=False)
    finalization = await db.get(ReportFinalization, version.report_finalization_id)
    if finalization is None or finalization.classification != "official":
        raise ArtifactGenerationFailure("ARTIFACT_FINALIZATION_MISSING", retryable=False)
    period = await db.get(ReportingPeriod, finalization.reporting_period_id)
    if period is None:
        raise ArtifactGenerationFailure("ARTIFACT_PERIOD_MISSING", retryable=False)

    members = list(
        await db.scalars(
            select(FinalReportScopeMember)
            .where(
                FinalReportScopeMember.final_report_version_id == version.id,
                FinalReportScopeMember.classification == "official",
            )
            .order_by(FinalReportScopeMember.reporting_obligation_id)
        )
    )
    items = list(
        await db.scalars(
            select(FinalReportItem)
            .where(
                FinalReportItem.final_report_version_id == version.id,
                FinalReportItem.classification == "official",
            )
            .order_by(FinalReportItem.report_revision_id)
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
            .order_by(FinalReportDemographicFact.dimension, FinalReportDemographicFact.value)
        )
    )
    events = list(
        await db.scalars(
            select(FinalReportEvent)
            .where(
                FinalReportEvent.final_report_version_id == version.id,
                FinalReportEvent.classification == "official",
                FinalReportEvent.event_type.in_(("version_finalized", "legacy_final_imported")),
            )
            .order_by(FinalReportEvent.occurred_at, FinalReportEvent.id)
        )
    )
    _validate_graph_counts(version, members=members, items=items, events=events)
    version_hash_payload = _version_hash_payload(
        period_id=period.id,
        version=version,
        members=members,
        items=items,
        metrics=metrics,
        demographics=demographics,
    )
    if canonical_payload_hash(version_hash_payload) != version.content_hash:
        raise ArtifactGenerationFailure("ARTIFACT_VERSION_HASH_MISMATCH", retryable=False)
    render_version_hash_payload = {
        **version_hash_payload,
        "finalizedAt": _timestamp(version.finalized_at),
    }
    event_payload = [_event_payload(event) for event in events]
    document: dict[str, object] = {
        "artifact": {
            "artifactId": artifact.id,
            "mimeType": artifact.mime_type,
            "templateVersion": artifact.template_version,
        },
        "auditEvents": event_payload,
        "contractVersion": 2,
        "finalization": {
            "finalReportVersionId": version.id,
            "reportCode": finalization.report_code,
            "reportFinalizationId": finalization.id,
            "reportingPeriod": {
                "cadence": period.cadence,
                "endsAt": _timestamp(period.ends_at),
                "label": period.label,
                "localEndDate": _date_value(period.local_end_date),
                "localStartDate": _date_value(period.local_start_date),
                "naturalKey": period.natural_key,
                "reportingPeriodId": period.id,
                "startsAt": _timestamp(period.starts_at),
                "timezoneName": period.timezone_name,
            },
            "versionContentHash": version.content_hash,
            "versionHashPayload": render_version_hash_payload,
        },
        "immutableRowIdentities": {
            "itemIds": [item.id for item in items],
            "scopeMemberIds": [member.id for member in members],
        },
    }
    return _ArtifactGraph(
        artifact=artifact,
        version=version,
        finalization=finalization,
        period=period,
        render_snapshot=ArtifactRenderSnapshot(
            artifact_id=artifact.id,
            template_version=artifact.template_version,
            report_code=finalization.report_code,
            version_content_hash=version.content_hash,
            document=document,
        ),
    )


async def _load_artifact_event_context(
    db: AsyncSession,
    artifact: FinalReportArtifact,
) -> _ArtifactEventContext:
    version = await db.get(FinalReportVersion, artifact.final_report_version_id)
    if version is None or version.classification != artifact.classification:
        raise ArtifactGenerationFailure("ARTIFACT_VERSION_MISSING", retryable=False)
    finalization = await db.get(ReportFinalization, version.report_finalization_id)
    if finalization is None or finalization.classification != artifact.classification:
        raise ArtifactGenerationFailure("ARTIFACT_FINALIZATION_MISSING", retryable=False)
    period = await db.get(ReportingPeriod, finalization.reporting_period_id)
    if period is None:
        raise ArtifactGenerationFailure("ARTIFACT_PERIOD_MISSING", retryable=False)
    return _ArtifactEventContext(version=version, finalization=finalization, period=period)


async def _record_artifact_lifecycle(
    db: AsyncSession,
    *,
    artifact: FinalReportArtifact,
    context: _ArtifactEventContext,
    event_type: Literal[
        "artifact_ready",
        "artifact_failed",
        "artifact_retry_scheduled",
        "artifact_repair_requested",
    ],
    occurred_at: datetime,
) -> None:
    event_id = str(uuid4())
    reason = artifact.last_error_code
    db.add(
        FinalReportEvent(
            id=event_id,
            report_finalization_id=context.finalization.id,
            final_report_version_id=context.version.id,
            final_report_artifact_id=artifact.id,
            classification=artifact.classification,
            event_type=event_type,
            actor_account_id=None,
            actor_display_name=None,
            actor_role=None,
            command_id=None,
            expected_version=context.version.version_number,
            resulting_version=context.version.version_number,
            reason=reason,
            occurred_at=occurred_at,
        )
    )
    payload: dict[str, object] = {
        "artifactId": artifact.id,
        "artifactStatus": artifact.status,
        "contentHash": artifact.content_hash,
        "finalReportVersionId": context.version.id,
        "generationAttempts": artifact.generation_attempts,
        "lastErrorCode": artifact.last_error_code,
        "reportFinalizationId": context.finalization.id,
        "reportingPeriodId": context.period.id,
        "templateVersion": artifact.template_version,
    }
    payload_hash = canonical_payload_hash(payload)
    domain_event = DomainEvent(
        id=str(uuid4()),
        event_key=(
            f"final-report-artifact:{artifact.id}:{event_type}:"
            f"attempt:{artifact.generation_attempts}"
        ),
        event_type=f"final_report.{event_type}",
        contract_version=2,
        schema_version=1,
        aggregate_type="report_finalization",
        aggregate_id=context.finalization.id,
        aggregate_version=context.version.version_number,
        enterprise_id=None,
        site_id=None,
        classification=artifact.classification,
        actor_account_id=None,
        correlation_id=event_id,
        causation_id=None,
        payload_json=json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        payload_hash=payload_hash,
        occurred_at=occurred_at,
        available_at=occurred_at,
    )
    db.add(domain_event)
    db.add(
        DomainEventDelivery(
            id=str(uuid4()),
            domain_event_id=domain_event.id,
            destination="realtime_broadcast",
            status="pending",
            attempt_count=0,
            next_attempt_at=occurred_at,
        )
    )


def _version_hash_payload(
    *,
    period_id: str,
    version: FinalReportVersion,
    members: list[FinalReportScopeMember],
    items: list[FinalReportItem],
    metrics: list[FinalReportMetricFact],
    demographics: list[FinalReportDemographicFact],
) -> dict[str, object]:
    return {
        "reportingPeriodId": period_id,
        "classification": version.classification,
        "versionNumber": version.version_number,
        "scope": {
            "type": version.scope_type,
            "barangay": version.scope_barangay,
            "label": version.scope_label,
            "obligationIds": sorted(member.reporting_obligation_id for member in members),
        },
        "sources": [
            {
                "reportRevisionId": item.report_revision_id,
                "reportingObligationId": item.reporting_obligation_id,
                "payloadHash": item.source_payload_hash,
            }
            for item in sorted(items, key=lambda value: value.report_revision_id)
        ],
        "scopeMembers": [
            {
                "reportingObligationId": member.reporting_obligation_id,
                "enterpriseId": member.enterprise_id,
                "enterpriseOfficialCode": member.enterprise_official_code,
                "enterpriseName": member.enterprise_name,
                "enterpriseCategory": member.enterprise_category,
                "siteId": member.site_id,
                "siteCode": member.site_code,
                "siteName": member.site_name,
                "frozenBarangay": member.frozen_barangay,
            }
            for member in sorted(members, key=lambda value: value.reporting_obligation_id)
        ],
        "metrics": [
            {
                "definition": metric.definition,
                "definitionVersion": metric.definition_version,
                "unit": metric.unit,
                "aggregationMethod": metric.aggregation_method,
                "value": _decimal(metric.value),
                "quality": metric.quality,
                "sourceFactCount": metric.source_fact_count,
            }
            for metric in metrics
        ],
        "demographics": [
            {
                "dimension": fact.dimension,
                "value": fact.value,
                "count": fact.count,
                "percentage": _decimal(fact.percentage),
                "quality": fact.quality,
                "sourceFactCount": fact.source_fact_count,
            }
            for fact in demographics
        ],
        "preparedBy": {
            "accountId": version.prepared_by_account_id,
            "name": version.prepared_by_name,
            "role": version.prepared_by_role,
        },
        "finalizedAt": version.finalized_at,
    }


def _event_payload(event: FinalReportEvent) -> dict[str, object]:
    return {
        "actorAccountId": event.actor_account_id,
        "actorDisplayName": event.actor_display_name,
        "actorRole": event.actor_role,
        "commandId": event.command_id,
        "eventType": event.event_type,
        "expectedVersion": event.expected_version,
        "finalReportEventId": event.id,
        "occurredAt": _timestamp(event.occurred_at),
        "reason": event.reason,
        "resultingVersion": event.resulting_version,
    }


def _validate_graph_counts(
    version: FinalReportVersion,
    *,
    members: list[FinalReportScopeMember],
    items: list[FinalReportItem],
    events: list[FinalReportEvent],
) -> None:
    member_obligations = {member.reporting_obligation_id for member in members}
    item_obligations = {item.reporting_obligation_id for item in items}
    if (
        len(members) != version.scope_member_count
        or len(items) != version.source_count
        or len(member_obligations) != len(members)
        or member_obligations != item_obligations
        or len(events) != 1
        or events[0].final_report_version_id != version.id
        or events[0].resulting_version != version.version_number
    ):
        raise ArtifactGenerationFailure("ARTIFACT_VERSION_GRAPH_INCOMPLETE", retryable=False)


def _verify_generated_object(stored: StoredArtifact, *, expected_content: bytes) -> None:
    expected_hash = f"sha256:{hashlib.sha256(expected_content).hexdigest()}"
    if (
        stored.mime_type != PDF_MIME_TYPE
        or stored.content != expected_content
        or stored.size_bytes != len(expected_content)
        or stored.content_hash != expected_hash
    ):
        raise ArtifactStorageIntegrityError("Stored object differs from rendered PDF bytes.")


def _storage_key(graph: _ArtifactGraph) -> str:
    return (
        f"official/final-reports/{graph.finalization.id}/versions/"
        f"{graph.version.id}/{graph.artifact.id}.pdf"
    )


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ArtifactGenerationFailure("ARTIFACT_TIMESTAMP_INVALID", retryable=False)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _date_value(value: date) -> str:
    return value.isoformat()


def _decimal(value: Decimal | None) -> str | None:
    return format(value, "f") if value is not None else None


def _safe_filename_part(value: str) -> str:
    normalized = "".join(
        character if character.isascii() and (character.isalnum() or character in "-_") else "-"
        for character in value
    )
    return normalized[:80] or "final-report"


def _artifact_not_found() -> FinalReportArtifactNotFound:
    return FinalReportArtifactNotFound(
        "FINAL_REPORT_ARTIFACT_NOT_FOUND",
        "The requested official final-report artifact was not found.",
    )


def _artifact_unavailable() -> FinalReportArtifactUnavailable:
    return FinalReportArtifactUnavailable(
        "FINAL_REPORT_ARTIFACT_INTEGRITY_FAILURE",
        "The final-report artifact failed integrity verification and is unavailable.",
    )


def _log_download_integrity_failure(artifact_id: str, reason: str) -> None:
    logger.error(
        "Final-report artifact download blocked by integrity verification artifact_id=%s reason=%s",
        artifact_id,
        reason,
    )
