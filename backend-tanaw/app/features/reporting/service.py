from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.reporting.contracts import METRIC_CATALOG
from app.features.reporting.envelopes import (
    ReportAcknowledgementResource,
    ReportSubmissionAcknowledgement,
    ReportSubmissionCommand,
    canonical_payload_hash,
)
from app.features.reporting.models import (
    EnterpriseReport,
    ReportDemographicFact,
    ReportingObligation,
    ReportingPeriod,
    ReportIntakeReceipt,
    ReportMetricFact,
    ReportReviewEvent,
    ReportRevision,
    ReportSourceBatch,
)
from app.features.topology.access import (
    EnterpriseAccessScope,
    EnterpriseTopologyAccessError,
    require_effective_enterprise_access,
)
from app.features.topology.models import Camera, EdgeDevice, EnterpriseSite


class ReportIntakeError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class ReportIntakeConflict(ReportIntakeError):
    pass


async def submit_report_command(
    db: AsyncSession,
    *,
    account: Account,
    command: ReportSubmissionCommand,
    acknowledged_at: datetime | None = None,
    enforce_submission_window: bool = True,
) -> ReportSubmissionAcknowledgement:
    acknowledged_at = _as_utc(acknowledged_at or datetime.now(UTC))
    payload_hash = canonical_payload_hash(command.payload)
    access = await _enterprise_access_scope(
        db,
        account_id=account.id,
        evaluated_at=acknowledged_at,
        lock=True,
    )

    replay = await _resolve_replay(
        db,
        enterprise_id=access.enterprise_id,
        command=command,
        payload_hash=payload_hash,
    )
    if replay is not None:
        return replay

    period = await db.scalar(
        select(ReportingPeriod).where(ReportingPeriod.natural_key == command.payload.periodKey)
    )
    if period is None:
        raise ReportIntakeError(
            "REPORTING_PERIOD_NOT_AVAILABLE",
            "The reporting period has not been opened by the server.",
        )
    if enforce_submission_window and acknowledged_at < _as_utc(period.submission_opens_at):
        raise ReportIntakeConflict(
            "REPORTING_WINDOW_NOT_OPEN",
            "The reporting period is not open for submissions yet.",
        )
    if enforce_submission_window and acknowledged_at >= _as_utc(period.submission_closes_at):
        raise ReportIntakeConflict(
            "REPORTING_WINDOW_CLOSED",
            "The reporting period submission window has closed.",
        )

    site_id, classification = await _resolve_source_site(
        db,
        access=access,
        source_camera_ids=[str(batch.cameraId) for batch in command.payload.sourceBatches],
        evaluated_at=acknowledged_at,
        lock=True,
    )
    if classification != access.classification:
        raise ReportIntakeError(
            "REPORT_CLASSIFICATION_MISMATCH",
            "The authenticated membership and source cameras have different classifications.",
        )

    obligation = await db.scalar(
        select(ReportingObligation)
        .where(
            ReportingObligation.reporting_period_id == period.id,
            ReportingObligation.enterprise_id == access.enterprise_id,
            ReportingObligation.site_id == site_id,
            ReportingObligation.classification == classification,
        )
        .with_for_update()
    )
    if obligation is None:
        raise ReportIntakeError(
            "REPORTING_OBLIGATION_NOT_FOUND",
            "No frozen reporting obligation exists for this enterprise, site, and period.",
        )
    if obligation.eligibility_status != "eligible" or obligation.acceptance_blocked:
        raise ReportIntakeConflict(
            "REPORTING_OBLIGATION_BLOCKED",
            "The reporting obligation is not eligible for official intake.",
        )

    # A concurrent first submission may have committed while this transaction waited
    # for the obligation lock. Recheck the durable receipt before evaluating state.
    replay = await _resolve_replay(
        db,
        enterprise_id=access.enterprise_id,
        command=command,
        payload_hash=payload_hash,
    )
    if replay is not None:
        return replay

    report = await db.scalar(
        select(EnterpriseReport)
        .where(EnterpriseReport.reporting_obligation_id == obligation.id)
        .with_for_update()
    )
    previous_state: str | None = None
    if report is None:
        if command.expectedVersion != 0:
            raise _stale_version(command.expectedVersion, 0, "not_submitted")
        report_id = str(uuid4())
        revision_number = 1
        logical_version = 1
    else:
        previous_state = report.workflow_state
        if command.expectedVersion != report.logical_version:
            raise _stale_version(
                command.expectedVersion,
                report.logical_version,
                report.workflow_state,
            )
        if report.workflow_state != "returned":
            raise ReportIntakeConflict(
                "REPORT_STATE_CONFLICT",
                f"A new revision cannot be submitted while the report is {report.workflow_state}.",
            )
        report_id = report.id
        revision_number = await _next_revision_number(db, report.id)
        logical_version = report.logical_version + 1

    _validate_metrics(command)
    await _reject_reused_source_batches(db, command)
    acceptance_blocked = _has_incomplete_evidence(command)
    revision_id = str(uuid4())
    revision = ReportRevision(
        id=revision_id,
        enterprise_report_id=report_id,
        enterprise_id=access.enterprise_id,
        site_id=site_id,
        classification=classification,
        revision_number=revision_number,
        local_revision_id=command.payload.localRevisionId,
        idempotency_key=command.idempotencyKey,
        source_window_start=_as_utc(command.payload.sourceWindow.start),
        source_window_end=_as_utc(command.payload.sourceWindow.end),
        submitted_by_account_id=account.id,
        submitted_at=_as_utc(command.occurredAt),
        received_at=acknowledged_at,
        payload_hash=payload_hash,
        evidence_status="incomplete" if acceptance_blocked else "complete",
        acceptance_blocked=acceptance_blocked,
        monitored_seconds=command.payload.coverage.monitoredSeconds,
        expected_seconds=command.payload.coverage.expectedSeconds,
        coverage_gap_count=(
            len(command.payload.coverage.gaps)
            if command.payload.coverage.evidenceStatus == "recorded"
            else None
        ),
        coverage_details_json=(
            json.dumps(
                [gap.model_dump(mode="json") for gap in command.payload.coverage.gaps],
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            if command.payload.coverage.evidenceStatus == "recorded"
            else None
        ),
        notes=command.payload.notes,
    )
    if report is None:
        report = EnterpriseReport(
            id=report_id,
            reporting_obligation_id=obligation.id,
            enterprise_id=access.enterprise_id,
            site_id=site_id,
            classification=classification,
            workflow_state="submitted",
            current_revision_id=revision_id,
            accepted_revision_id=None,
            logical_version=logical_version,
            acceptance_blocked=acceptance_blocked,
        )
        db.add(report)
    else:
        report.workflow_state = "submitted"
        report.current_revision_id = revision_id
        report.accepted_revision_id = None
        report.logical_version = logical_version
        report.acceptance_blocked = acceptance_blocked

    db.add(revision)
    # The logical report and revision intentionally hold deferred circular pointers.
    # Flush that graph before inserting children whose revision FKs are immediate.
    await db.flush([report, revision])
    db.add_all(_metric_facts(command, revision, classification))
    db.add_all(_demographic_facts(command, revision, classification))
    db.add_all(_source_batches(command, revision, site_id, classification))
    db.add(
        ReportReviewEvent(
            id=str(uuid4()),
            enterprise_report_id=report_id,
            report_revision_id=revision_id,
            enterprise_id=access.enterprise_id,
            classification=classification,
            event_type="revision_submitted",
            from_state=previous_state,
            to_state="submitted",
            actor_account_id=account.id,
            actor_display_name=account.display_name,
            actor_role=account.role.value,
            reason=None,
            command_id=str(command.commandId),
            expected_version=command.expectedVersion,
            resulting_version=logical_version,
            occurred_at=acknowledged_at,
        )
    )
    db.add(
        ReportIntakeReceipt(
            id=str(uuid4()),
            enterprise_report_id=report_id,
            report_revision_id=revision_id,
            enterprise_id=access.enterprise_id,
            classification=classification,
            contract_version=2,
            command_id=str(command.commandId),
            idempotency_key=command.idempotencyKey,
            payload_hash=payload_hash,
            occurred_at=_as_utc(command.occurredAt),
            acknowledged_at=acknowledged_at,
        )
    )
    domain_event = _revision_submitted_event(
        command=command,
        payload_hash=payload_hash,
        enterprise_report_id=report_id,
        report_revision_id=revision_id,
        reporting_period_id=period.id,
        enterprise_id=access.enterprise_id,
        site_id=site_id,
        classification=classification,
        actor_account_id=account.id,
        revision_number=revision_number,
        logical_version=logical_version,
        available_at=acknowledged_at,
    )
    db.add(domain_event)
    await db.flush()
    db.add_all(
        [
            DomainEventDelivery(
                id=str(uuid4()),
                domain_event_id=domain_event.id,
                destination=destination,
                status="pending",
                attempt_count=0,
                next_attempt_at=acknowledged_at,
            )
            for destination in ("notification_projection", "realtime_broadcast")
        ]
    )
    await db.flush()
    return _acknowledgement(
        command_id=command.commandId,
        disposition="created",
        payload_hash=payload_hash,
        acknowledged_at=acknowledged_at,
        period=period,
        enterprise_report_id=report.id,
        logical_version=logical_version,
        revision=revision,
    )


async def _enterprise_access_scope(
    db: AsyncSession,
    *,
    account_id: str,
    evaluated_at: datetime,
    lock: bool,
) -> EnterpriseAccessScope:
    try:
        return await require_effective_enterprise_access(
            db,
            account_id=account_id,
            evaluated_at=evaluated_at,
            lock=lock,
        )
    except EnterpriseTopologyAccessError as exc:
        raise ReportIntakeError(exc.code, exc.message) from exc


async def _resolve_source_site(
    db: AsyncSession,
    *,
    access: EnterpriseAccessScope,
    source_camera_ids: list[str],
    evaluated_at: datetime,
    lock: bool,
) -> tuple[str, str]:
    unique_ids = set(source_camera_ids)
    statement = (
        select(Camera, EnterpriseSite, EdgeDevice)
        .join(EnterpriseSite, EnterpriseSite.id == Camera.site_id)
        .join(EdgeDevice, EdgeDevice.id == Camera.edge_device_id)
        .where(
            Camera.id.in_(unique_ids),
            Camera.classification == access.classification,
            Camera.lifecycle_state == "active",
            EdgeDevice.site_id == Camera.site_id,
            EdgeDevice.classification == access.classification,
            EdgeDevice.lifecycle_state == "active",
            EnterpriseSite.enterprise_id == access.enterprise_id,
            EnterpriseSite.classification == access.classification,
            EnterpriseSite.registered_at <= evaluated_at,
            or_(
                EnterpriseSite.retired_at.is_(None),
                EnterpriseSite.retired_at > evaluated_at,
            ),
        )
    )
    if lock:
        statement = statement.with_for_update(of=(Camera, EnterpriseSite, EdgeDevice))
    rows = (await db.execute(statement)).all()
    if len(rows) != len(unique_ids):
        raise ReportIntakeError(
            "REPORT_CAMERA_LINEAGE_INVALID",
            "Every source batch must reference an active camera owned by the enterprise.",
        )
    site_scopes = {(camera.site_id, camera.classification) for camera, _site, _device in rows}
    if len(site_scopes) != 1:
        raise ReportIntakeError(
            "REPORT_SOURCE_SCOPE_MIXED",
            "One report revision cannot combine cameras from different sites or classifications.",
        )
    return site_scopes.pop()


async def _resolve_replay(
    db: AsyncSession,
    *,
    enterprise_id: str,
    command: ReportSubmissionCommand,
    payload_hash: str,
) -> ReportSubmissionAcknowledgement | None:
    receipts = list(
        await db.scalars(
            select(ReportIntakeReceipt).where(
                or_(
                    ReportIntakeReceipt.command_id == str(command.commandId),
                    and_(
                        ReportIntakeReceipt.enterprise_id == enterprise_id,
                        ReportIntakeReceipt.idempotency_key == command.idempotencyKey,
                    ),
                ),
            )
        )
    )
    if not receipts:
        return None
    receipt_ids = {receipt.id for receipt in receipts}
    if len(receipt_ids) != 1:
        raise ReportIntakeConflict(
            "IDEMPOTENCY_IDENTITY_CONFLICT",
            "The command ID and idempotency key resolve to different receipts.",
        )
    receipt = receipts[0]
    if receipt.enterprise_id != enterprise_id:
        raise ReportIntakeConflict(
            "IDEMPOTENCY_IDENTITY_CONFLICT",
            "The command ID or idempotency key was already used for another command.",
        )
    if (
        receipt.command_id != str(command.commandId)
        or receipt.idempotency_key != command.idempotencyKey
    ):
        raise ReportIntakeConflict(
            "IDEMPOTENCY_IDENTITY_CONFLICT",
            "The command ID or idempotency key was already used for another command.",
        )
    if receipt.payload_hash != payload_hash:
        raise ReportIntakeConflict(
            "IDEMPOTENCY_PAYLOAD_CONFLICT",
            "The idempotency key was already used with a different payload hash.",
        )
    if _as_utc(receipt.occurred_at) != _as_utc(command.occurredAt):
        raise ReportIntakeConflict(
            "IDEMPOTENCY_OCCURRED_AT_CONFLICT",
            "The command was replayed with a different occurredAt timestamp.",
        )
    report = await db.get(EnterpriseReport, receipt.enterprise_report_id)
    revision = await db.get(ReportRevision, receipt.report_revision_id)
    submission_event = await db.scalar(
        select(ReportReviewEvent).where(
            ReportReviewEvent.command_id == receipt.command_id,
            ReportReviewEvent.event_type == "revision_submitted",
        )
    )
    period = (
        await db.scalar(
            select(ReportingPeriod)
            .join(
                ReportingObligation,
                ReportingObligation.reporting_period_id == ReportingPeriod.id,
            )
            .where(ReportingObligation.id == report.reporting_obligation_id)
        )
        if report is not None
        else None
    )
    if report is None or revision is None or period is None or submission_event is None:
        raise RuntimeError("A durable report intake receipt references missing target records.")
    if submission_event.expected_version != command.expectedVersion:
        raise ReportIntakeConflict(
            "IDEMPOTENCY_VERSION_CONFLICT",
            "The command was replayed with a different expected logical version.",
        )
    return _acknowledgement(
        command_id=UUID(receipt.command_id),
        disposition="replayed",
        payload_hash=receipt.payload_hash,
        acknowledged_at=_as_utc(receipt.acknowledged_at),
        period=period,
        enterprise_report_id=report.id,
        logical_version=submission_event.resulting_version,
        revision=revision,
    )


async def _reject_reused_source_batches(
    db: AsyncSession,
    command: ReportSubmissionCommand,
) -> None:
    batch_keys = [str(batch.batchId) for batch in command.payload.sourceBatches]
    reused_key = await db.scalar(
        select(ReportSourceBatch.id).where(ReportSourceBatch.id.in_(batch_keys))
    )
    if reused_key is not None:
        raise ReportIntakeConflict(
            "REPORT_SOURCE_BATCH_REUSED",
            "A source batch is already bound to another immutable report revision.",
        )


async def _next_revision_number(db: AsyncSession, report_id: str) -> int:
    revisions = list(
        await db.scalars(
            select(ReportRevision.revision_number)
            .where(ReportRevision.enterprise_report_id == report_id)
            .order_by(ReportRevision.revision_number.desc())
            .limit(1)
        )
    )
    return (revisions[0] if revisions else 0) + 1


def _validate_metrics(command: ReportSubmissionCommand) -> None:
    identities: set[tuple[str, int, str]] = set()
    for metric in command.payload.metrics:
        definition = METRIC_CATALOG.get(metric.definition)
        if definition is None or metric.definitionVersion != 1:
            raise ReportIntakeError(
                "REPORT_METRIC_DEFINITION_INVALID",
                f"Unsupported report metric definition: {metric.definition} v{metric.definitionVersion}.",
            )
        if metric.unit != definition.unit or metric.grain != definition.grain:
            raise ReportIntakeError(
                "REPORT_METRIC_SEMANTICS_INVALID",
                f"Metric {metric.definition} does not match its canonical unit and grain.",
            )
        identity = (metric.definition, metric.definitionVersion, metric.grain.value)
        if identity in identities:
            raise ReportIntakeError(
                "REPORT_METRIC_DUPLICATE",
                f"Metric {metric.definition} is duplicated in the report command.",
            )
        identities.add(identity)
        if metric.value is not None and metric.value < 0:
            raise ReportIntakeError(
                "REPORT_METRIC_VALUE_INVALID",
                f"Metric {metric.definition} cannot be negative.",
            )


def _has_incomplete_evidence(command: ReportSubmissionCommand) -> bool:
    if command.payload.coverage.evidenceStatus != "recorded":
        return True
    return any(
        metric.coverage.evidenceStatus != "recorded" or metric.quality.value == "unknown"
        for metric in command.payload.metrics
    )


def _metric_facts(
    command: ReportSubmissionCommand,
    revision: ReportRevision,
    classification: str,
) -> list[ReportMetricFact]:
    return [
        ReportMetricFact(
            id=str(uuid4()),
            report_revision_id=revision.id,
            classification=classification,
            definition=metric.definition,
            definition_version=metric.definitionVersion,
            value=Decimal(str(metric.value)) if metric.value is not None else None,
            unit=metric.unit,
            grain=metric.grain.value,
            window_start=_as_utc(metric.windowStart),
            window_end=_as_utc(metric.windowEnd),
            timezone_name=metric.timezone,
            provenance=metric.provenance.value,
            quality=metric.quality.value,
            monitored_seconds=metric.coverage.monitoredSeconds,
            expected_seconds=metric.coverage.expectedSeconds,
            coverage_gap_count=metric.coverage.gapCount,
        )
        for metric in command.payload.metrics
    ]


def _demographic_facts(
    command: ReportSubmissionCommand,
    revision: ReportRevision,
    classification: str,
) -> list[ReportDemographicFact]:
    return [
        ReportDemographicFact(
            id=str(uuid4()),
            report_revision_id=revision.id,
            classification=classification,
            dimension=fact.dimension,
            value=fact.value,
            count=fact.count,
            percentage=None,
            provenance=fact.provenance,
            quality=fact.quality.value,
        )
        for fact in command.payload.demographicFacts
    ]


def _source_batches(
    command: ReportSubmissionCommand,
    revision: ReportRevision,
    site_id: str,
    classification: str,
) -> list[ReportSourceBatch]:
    return [
        ReportSourceBatch(
            id=str(batch.batchId),
            report_revision_id=revision.id,
            site_id=site_id,
            camera_id=str(batch.cameraId),
            classification=classification,
            event_count=batch.eventCount,
            event_sequence_start=batch.eventSequenceStart,
            event_sequence_end_exclusive=batch.eventSequenceEndExclusive,
            aggregate_hash=batch.aggregateHash,
        )
        for batch in command.payload.sourceBatches
    ]


def _stale_version(expected: int, current: int, state: str) -> ReportIntakeConflict:
    return ReportIntakeConflict(
        "REPORT_VERSION_CONFLICT",
        f"Expected logical version {expected}; current version is {current} in state {state}.",
    )


def _revision_submitted_event(
    *,
    command: ReportSubmissionCommand,
    payload_hash: str,
    enterprise_report_id: str,
    report_revision_id: str,
    reporting_period_id: str,
    enterprise_id: str,
    site_id: str,
    classification: str,
    actor_account_id: str,
    revision_number: int,
    logical_version: int,
    available_at: datetime,
) -> DomainEvent:
    event_payload = {
        "contractVersion": 2,
        "eventType": "enterprise_report.revision_submitted",
        "enterpriseReportId": enterprise_report_id,
        "reportRevisionId": report_revision_id,
        "reportingPeriodId": reporting_period_id,
        "periodKey": command.payload.periodKey,
        "revisionNumber": revision_number,
        "logicalVersion": logical_version,
        "workflowState": "submitted",
        "sourcePayloadHash": payload_hash,
    }
    payload_json = json.dumps(
        event_payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return DomainEvent(
        id=str(uuid4()),
        event_key=f"report-revision-submitted:{command.commandId}",
        event_type="enterprise_report.revision_submitted",
        contract_version=2,
        schema_version=1,
        aggregate_type="enterprise_report",
        aggregate_id=enterprise_report_id,
        aggregate_version=logical_version,
        enterprise_id=enterprise_id,
        site_id=site_id,
        classification=classification,
        actor_account_id=actor_account_id,
        correlation_id=str(command.commandId),
        causation_id=str(command.commandId),
        payload_json=payload_json,
        payload_hash=canonical_payload_hash(event_payload),
        occurred_at=available_at,
        available_at=available_at,
        retention_expires_at=None,
    )


def _acknowledgement(
    *,
    command_id: UUID,
    disposition: str,
    payload_hash: str,
    acknowledged_at: datetime,
    period: ReportingPeriod,
    enterprise_report_id: str,
    logical_version: int,
    revision: ReportRevision,
) -> ReportSubmissionAcknowledgement:
    return ReportSubmissionAcknowledgement.model_validate(
        {
            "contractVersion": 2,
            "commandId": command_id,
            "disposition": disposition,
            "payloadHash": payload_hash,
            "acknowledgedAt": acknowledged_at,
            "resource": ReportAcknowledgementResource.model_validate(
                {
                    "periodKey": period.natural_key,
                    "reportingPeriodId": period.id,
                    "enterpriseReportId": enterprise_report_id,
                    "reportRevisionId": revision.id,
                    "revisionNumber": revision.revision_number,
                    "workflowState": "submitted",
                    "logicalVersion": logical_version,
                }
            ),
        }
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Report intake timestamps must include a UTC offset.")
    return value.astimezone(UTC)
