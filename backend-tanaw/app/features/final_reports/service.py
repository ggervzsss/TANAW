from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal, cast
from uuid import UUID, uuid4, uuid5

from sqlalchemy import and_, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.final_reports.envelopes import (
    FinalizationAcknowledgement,
    FinalizationAcknowledgementResource,
    FinalizeReportsCommand,
)
from app.features.final_reports.models import (
    FinalReportArtifact,
    FinalReportCommandReceipt,
    FinalReportDemographicFact,
    FinalReportEvent,
    FinalReportItem,
    FinalReportMetricFact,
    FinalReportScopeMember,
    FinalReportSourceClaim,
    FinalReportVersion,
    ReportFinalization,
)
from app.features.reporting.envelopes import canonical_payload_hash
from app.features.reporting.models import (
    EnterpriseReport,
    ReportDemographicFact,
    ReportingObligation,
    ReportingPeriod,
    ReportMetricFact,
    ReportReviewEvent,
    ReportRevision,
)
from app.features.reporting.numeric import fits_numeric_20_6
from app.features.topology.models import Enterprise, EnterpriseSite


class FinalizationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class FinalizationConflict(FinalizationError):
    pass


@dataclass(frozen=True, slots=True)
class _Source:
    revision: ReportRevision
    report: EnterpriseReport
    obligation: ReportingObligation
    enterprise: Enterprise
    site: EnterpriseSite


@dataclass(frozen=True, slots=True)
class _MetricAggregate:
    definition: str
    definition_version: int
    unit: str
    aggregation_method: str
    value: Decimal | None
    quality: str
    source_fact_count: int


@dataclass(frozen=True, slots=True)
class _DemographicAggregate:
    dimension: str
    value: str
    count: int
    percentage: Decimal | None
    quality: str
    source_fact_count: int


async def finalize_report_command(
    db: AsyncSession,
    *,
    account: Account,
    command: FinalizeReportsCommand,
    acknowledged_at: datetime | None = None,
) -> FinalizationAcknowledgement:
    """Create one all-or-nothing immutable final version from exact revisions."""

    if account.role != AccountRole.STAFF:
        raise FinalizationError(
            "FINALIZATION_FORBIDDEN",
            "Only an authenticated Staff account may finalize official reports.",
        )
    acknowledged_at = _as_utc(acknowledged_at or datetime.now(UTC))
    payload_hash = canonical_payload_hash(command.payload)
    replay = await _resolve_replay(db, command=command, payload_hash=payload_hash)
    if replay is not None:
        return replay

    period = await db.get(ReportingPeriod, str(command.payload.reportingPeriodId))
    if period is None:
        raise FinalizationError(
            "REPORTING_PERIOD_NOT_FOUND", "The requested reporting period does not exist."
        )

    finalization_id = (
        str(command.payload.targetFinalizationId)
        if command.payload.targetFinalizationId is not None
        else str(uuid4())
    )
    finalization: ReportFinalization | None = None
    previous_version: FinalReportVersion | None = None
    if command.payload.targetFinalizationId is not None:
        finalization = await db.scalar(
            select(ReportFinalization)
            .where(ReportFinalization.id == finalization_id)
            .with_for_update()
        )
        if finalization is None:
            raise FinalizationError(
                "FINALIZATION_NOT_FOUND", "The target logical finalization does not exist."
            )
        # Recheck after the logical aggregate lock for a command that committed while waiting.
        replay = await _resolve_replay(db, command=command, payload_hash=payload_hash)
        if replay is not None:
            return replay
        if finalization.logical_version != command.expectedVersion:
            raise FinalizationConflict(
                "FINALIZATION_VERSION_CONFLICT",
                f"Expected finalization version {command.expectedVersion}; current version is "
                f"{finalization.logical_version}.",
            )
        if finalization.reporting_period_id != period.id:
            raise FinalizationConflict(
                "FINALIZATION_PERIOD_CONFLICT",
                "A final-report correction cannot change its canonical reporting period.",
            )
        if finalization.classification != "official":
            raise FinalizationConflict(
                "FINALIZATION_CLASSIFICATION_CONFLICT",
                "The official endpoint cannot modify a simulation finalization.",
            )
        previous_version = await db.get(FinalReportVersion, finalization.current_version_id)
        if previous_version is None:
            raise RuntimeError("A logical finalization references a missing current version.")
    elif command.expectedVersion != 0:
        raise FinalizationConflict(
            "FINALIZATION_VERSION_CONFLICT",
            "A new logical finalization must use expectedVersion 0.",
        )

    sources = await _lock_sources(db, command.payload.reportRevisionIds)
    # A concurrent create may have committed while this transaction waited on
    # the source report locks. Resolve its receipt before evaluating ownership.
    replay = await _resolve_replay(db, command=command, payload_hash=payload_hash)
    if replay is not None:
        return replay
    if len(sources) != len(command.payload.reportRevisionIds):
        found = {source.revision.id for source in sources}
        missing = sorted(
            str(item) for item in command.payload.reportRevisionIds if str(item) not in found
        )
        raise FinalizationError(
            "FINALIZATION_SOURCE_NOT_FOUND",
            f"Every source revision must exist; missing: {', '.join(missing)}.",
        )
    _validate_source_period_and_classification(sources, period.id)
    await _validate_scope(db, command=command, sources=sources, period=period)

    claims = await _lock_source_claims(db, [source.revision.id for source in sources])
    new_sources: list[_Source] = []
    for source in sources:
        claim = claims.get(source.revision.id)
        if claim is not None and claim.report_finalization_id != finalization_id:
            raise FinalizationConflict(
                "FINALIZATION_SOURCE_ALREADY_CLAIMED",
                f"Revision {source.revision.id} already belongs to another finalization.",
            )
        if claim is None:
            _require_accepted_source(source)
            new_sources.append(source)
        else:
            _require_reusable_source(source)

    metric_aggregates = await _aggregate_metrics(db, [source.revision.id for source in sources])
    demographic_aggregates = await _aggregate_demographics(
        db, [source.revision.id for source in sources]
    )
    resulting_version = command.expectedVersion + 1
    scope_barangay, scope_label = _scope_definition(command, sources)
    content_hash = _final_content_hash(
        period_id=period.id,
        classification="official",
        version_number=resulting_version,
        scope_type=command.payload.scope.type,
        scope_barangay=scope_barangay,
        scope_label=scope_label,
        sources=sources,
        metrics=metric_aggregates,
        demographics=demographic_aggregates,
        prepared_by=account,
        finalized_at=acknowledged_at,
    )
    version_id = str(uuid4())

    if finalization is None:
        finalization = ReportFinalization(
            id=finalization_id,
            reporting_period_id=period.id,
            classification="official",
            report_code=await _allocate_report_code(db, period=period, classification="official"),
            current_version_id=version_id,
            logical_version=1,
            created_by_account_id=account.id,
        )
        db.add(finalization)
    else:
        assert previous_version is not None
        previous_version.disposition = "superseded"
        await db.flush([previous_version])
        finalization.current_version_id = version_id
        finalization.logical_version = resulting_version

    version = FinalReportVersion(
        id=version_id,
        report_finalization_id=finalization.id,
        classification="official",
        version_number=resulting_version,
        disposition="current",
        scope_type=command.payload.scope.type,
        scope_barangay=scope_barangay,
        scope_label=scope_label,
        source_count=len(sources),
        scope_member_count=len(sources),
        content_hash=content_hash,
        prepared_by_account_id=account.id,
        prepared_by_name=account.display_name,
        prepared_by_role=account.role.value,
        finalized_at=acknowledged_at,
    )
    db.add(version)
    await db.flush([finalization, version])

    db.add_all(
        [
            FinalReportSourceClaim(
                id=str(uuid4()),
                report_finalization_id=finalization.id,
                report_revision_id=source.revision.id,
                classification="official",
                claimed_at=acknowledged_at,
            )
            for source in new_sources
        ]
    )
    db.add_all(
        [
            FinalReportScopeMember(
                id=str(uuid4()),
                final_report_version_id=version.id,
                report_finalization_id=finalization.id,
                reporting_obligation_id=source.obligation.id,
                enterprise_id=source.obligation.enterprise_id,
                site_id=source.obligation.site_id,
                classification="official",
                enterprise_official_code=source.enterprise.official_code,
                enterprise_name=source.enterprise.name,
                enterprise_category=source.enterprise.category,
                site_code=source.site.site_code,
                site_name=source.site.name,
                frozen_barangay=source.obligation.frozen_barangay,
            )
            for source in sources
        ]
    )
    await db.flush()
    db.add_all(
        [
            FinalReportItem(
                id=str(uuid4()),
                final_report_version_id=version.id,
                report_finalization_id=finalization.id,
                reporting_obligation_id=source.obligation.id,
                report_revision_id=source.revision.id,
                classification="official",
                source_payload_hash=source.revision.payload_hash,
            )
            for source in sources
        ]
    )
    db.add_all(_metric_fact_models(version, metric_aggregates))
    db.add_all(_demographic_fact_models(version, demographic_aggregates))

    for source in new_sources:
        previous_report_version = source.report.logical_version
        source.report.workflow_state = "consolidated"
        source.report.logical_version = previous_report_version + 1
        db.add(
            ReportReviewEvent(
                id=str(uuid4()),
                enterprise_report_id=source.report.id,
                report_revision_id=source.revision.id,
                enterprise_id=source.report.enterprise_id,
                classification="official",
                event_type="consolidated",
                from_state="accepted",
                to_state="consolidated",
                actor_account_id=account.id,
                actor_display_name=account.display_name,
                actor_role=account.role.value,
                reason=f"Included in final report {finalization.report_code}.",
                command_id=str(uuid5(command.commandId, source.report.id)),
                expected_version=previous_report_version,
                resulting_version=previous_report_version + 1,
                occurred_at=acknowledged_at,
            )
        )

    db.add(
        FinalReportEvent(
            id=str(uuid4()),
            report_finalization_id=finalization.id,
            final_report_version_id=version.id,
            classification="official",
            event_type="version_finalized",
            actor_account_id=account.id,
            actor_display_name=account.display_name,
            actor_role=account.role.value,
            command_id=str(command.commandId),
            expected_version=command.expectedVersion,
            resulting_version=resulting_version,
            reason=command.payload.reason,
            occurred_at=acknowledged_at,
        )
    )
    db.add(
        FinalReportArtifact(
            id=str(uuid4()),
            final_report_version_id=version.id,
            classification="official",
            status="pending",
            template_version="official-final-report-v1",
            mime_type="application/pdf",
            generation_attempts=0,
        )
    )
    db.add(
        FinalReportCommandReceipt(
            id=str(uuid4()),
            report_finalization_id=finalization.id,
            final_report_version_id=version.id,
            classification="official",
            contract_version=2,
            command_id=str(command.commandId),
            idempotency_key=command.idempotencyKey,
            payload_hash=payload_hash,
            expected_version=command.expectedVersion,
            resulting_version=resulting_version,
            occurred_at=_as_utc(command.occurredAt),
            acknowledged_at=acknowledged_at,
        )
    )
    domain_event = _domain_event(
        finalization=finalization,
        version=version,
        command=command,
        account=account,
        occurred_at=acknowledged_at,
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
        finalization=finalization,
        version=version,
    )


async def _resolve_replay(
    db: AsyncSession,
    *,
    command: FinalizeReportsCommand,
    payload_hash: str,
) -> FinalizationAcknowledgement | None:
    receipts = list(
        await db.scalars(
            select(FinalReportCommandReceipt).where(
                or_(
                    FinalReportCommandReceipt.command_id == str(command.commandId),
                    FinalReportCommandReceipt.idempotency_key == command.idempotencyKey,
                )
            )
        )
    )
    if not receipts:
        return None
    if len({receipt.id for receipt in receipts}) != 1:
        raise FinalizationConflict(
            "IDEMPOTENCY_IDENTITY_CONFLICT",
            "The command ID and idempotency key resolve to different finalizations.",
        )
    receipt = receipts[0]
    if (
        receipt.command_id != str(command.commandId)
        or receipt.idempotency_key != command.idempotencyKey
    ):
        raise FinalizationConflict(
            "IDEMPOTENCY_IDENTITY_CONFLICT",
            "The command ID or idempotency key was already used for another command.",
        )
    if receipt.payload_hash != payload_hash:
        raise FinalizationConflict(
            "IDEMPOTENCY_PAYLOAD_CONFLICT",
            "The idempotency key was already used with a different payload hash.",
        )
    if receipt.expected_version != command.expectedVersion:
        raise FinalizationConflict(
            "IDEMPOTENCY_VERSION_CONFLICT",
            "The command was replayed with a different expected logical version.",
        )
    if _as_utc(receipt.occurred_at) != _as_utc(command.occurredAt):
        raise FinalizationConflict(
            "IDEMPOTENCY_OCCURRED_AT_CONFLICT",
            "The command was replayed with a different occurredAt timestamp.",
        )
    finalization = await db.get(ReportFinalization, receipt.report_finalization_id)
    version = await db.get(FinalReportVersion, receipt.final_report_version_id)
    if finalization is None or version is None:
        raise RuntimeError("A finalization receipt references missing durable records.")
    return _acknowledgement(
        command_id=UUID(receipt.command_id),
        disposition="replayed",
        payload_hash=receipt.payload_hash,
        acknowledged_at=_as_utc(receipt.acknowledged_at),
        finalization=finalization,
        version=version,
        logical_version=receipt.resulting_version,
    )


async def _lock_sources(db: AsyncSession, revision_ids: list[UUID]) -> list[_Source]:
    rows = (
        await db.execute(
            select(
                ReportRevision,
                EnterpriseReport,
                ReportingObligation,
                Enterprise,
                EnterpriseSite,
            )
            .join(EnterpriseReport, EnterpriseReport.id == ReportRevision.enterprise_report_id)
            .join(
                ReportingObligation,
                ReportingObligation.id == EnterpriseReport.reporting_obligation_id,
            )
            .join(
                Enterprise,
                and_(
                    Enterprise.id == ReportingObligation.enterprise_id,
                    Enterprise.classification == ReportingObligation.classification,
                ),
            )
            .join(
                EnterpriseSite,
                and_(
                    EnterpriseSite.id == ReportingObligation.site_id,
                    EnterpriseSite.enterprise_id == ReportingObligation.enterprise_id,
                    EnterpriseSite.classification == ReportingObligation.classification,
                ),
            )
            .where(ReportRevision.id.in_([str(item) for item in revision_ids]))
            .order_by(ReportRevision.id)
            .with_for_update(
                of=(
                    ReportRevision,
                    EnterpriseReport,
                    ReportingObligation,
                    Enterprise,
                    EnterpriseSite,
                )
            )
        )
    ).all()
    return [
        _Source(
            revision=row[0],
            report=row[1],
            obligation=row[2],
            enterprise=row[3],
            site=row[4],
        )
        for row in rows
    ]


async def _lock_source_claims(
    db: AsyncSession, revision_ids: list[str]
) -> dict[str, FinalReportSourceClaim]:
    claims = list(
        await db.scalars(
            select(FinalReportSourceClaim)
            .where(FinalReportSourceClaim.report_revision_id.in_(revision_ids))
            .order_by(FinalReportSourceClaim.report_revision_id)
            .with_for_update()
        )
    )
    return {claim.report_revision_id: claim for claim in claims}


def _validate_source_period_and_classification(sources: list[_Source], period_id: str) -> None:
    periods = {source.obligation.reporting_period_id for source in sources}
    if periods != {period_id}:
        raise FinalizationError(
            "FINALIZATION_MIXED_PERIOD",
            "Every source revision must belong to the requested canonical period.",
        )
    if {source.revision.classification for source in sources} != {"official"}:
        raise FinalizationError(
            "FINALIZATION_MIXED_CLASSIFICATION",
            "Official finalizations may contain only official source revisions.",
        )
    for source in sources:
        if (
            source.report.classification != "official"
            or source.obligation.classification != "official"
        ):
            raise FinalizationError(
                "FINALIZATION_MIXED_CLASSIFICATION",
                "Source report, revision, and obligation classifications must agree.",
            )
        if source.report.acceptance_blocked or source.revision.acceptance_blocked:
            raise FinalizationConflict(
                "FINALIZATION_SOURCE_BLOCKED",
                f"Revision {source.revision.id} has blocked or incomplete evidence.",
            )
        if (
            source.obligation.eligibility_status != "eligible"
            or source.obligation.acceptance_blocked
        ):
            raise FinalizationConflict(
                "FINALIZATION_OBLIGATION_INELIGIBLE",
                f"Obligation {source.obligation.id} is not eligible for finalization.",
            )
    obligation_ids = [source.obligation.id for source in sources]
    if len(obligation_ids) != len(set(obligation_ids)):
        raise FinalizationError(
            "FINALIZATION_DUPLICATE_OBLIGATION",
            "A final version may contain only one revision for each reporting obligation.",
        )


def _require_accepted_source(source: _Source) -> None:
    if (
        source.report.workflow_state != "accepted"
        or source.report.accepted_revision_id != source.revision.id
        or source.report.current_revision_id != source.revision.id
    ):
        raise FinalizationConflict(
            "FINALIZATION_SOURCE_NOT_ACCEPTED",
            f"Revision {source.revision.id} is not the exact accepted unconsolidated revision.",
        )


def _require_reusable_source(source: _Source) -> None:
    if (
        source.report.workflow_state != "consolidated"
        or source.report.accepted_revision_id != source.revision.id
        or source.report.current_revision_id != source.revision.id
    ):
        raise FinalizationConflict(
            "FINALIZATION_SOURCE_REUSE_INVALID",
            f"Claimed revision {source.revision.id} is no longer the consolidated source.",
        )


async def _validate_scope(
    db: AsyncSession,
    *,
    command: FinalizeReportsCommand,
    sources: list[_Source],
    period: ReportingPeriod,
) -> None:
    selected = {source.obligation.id for source in sources}
    scope = command.payload.scope
    if scope.type == "enterprise_selection":
        return

    obligations = list(
        await db.scalars(
            select(ReportingObligation)
            .where(
                ReportingObligation.reporting_period_id == period.id,
                ReportingObligation.classification == "official",
            )
            .order_by(ReportingObligation.id)
            .with_for_update()
        )
    )
    if scope.type == "barangay":
        assert scope.barangay is not None
        matching = [
            obligation
            for obligation in obligations
            if obligation.frozen_barangay is not None
            and obligation.frozen_barangay.casefold() == scope.barangay.casefold()
        ]
        if not matching:
            raise FinalizationError(
                "FINALIZATION_BARANGAY_NOT_FOUND",
                "No frozen reporting obligations match the requested barangay.",
            )
        canonical_names = {item.frozen_barangay for item in matching}
        if len(canonical_names) != 1:
            raise FinalizationError(
                "FINALIZATION_BARANGAY_AMBIGUOUS",
                "The requested barangay resolves to inconsistent frozen names.",
            )
        obligations = matching
    unresolved = [item.id for item in obligations if item.eligibility_status == "unknown"]
    if unresolved:
        raise FinalizationConflict(
            "FINALIZATION_SCOPE_ELIGIBILITY_UNRESOLVED",
            "Scope completeness cannot be proven while obligations have unknown eligibility.",
        )
    expected = {
        item.id
        for item in obligations
        if item.eligibility_status == "eligible" and not item.acceptance_blocked
    }
    blocked = [
        item.id
        for item in obligations
        if item.eligibility_status == "eligible" and item.acceptance_blocked
    ]
    if blocked:
        raise FinalizationConflict(
            "FINALIZATION_SCOPE_BLOCKED",
            "Scope completeness cannot be proven while eligible obligations are blocked.",
        )
    if selected != expected:
        missing = sorted(expected - selected)
        extra = sorted(selected - expected)
        raise FinalizationError(
            "FINALIZATION_SCOPE_INCOMPLETE",
            f"The selected source set does not exactly match the frozen scope "
            f"(missing={missing}, extra={extra}).",
        )


def _scope_definition(
    command: FinalizeReportsCommand, sources: list[_Source]
) -> tuple[str | None, str]:
    scope = command.payload.scope
    if scope.type == "citywide":
        return None, "Citywide"
    if scope.type == "barangay":
        assert scope.barangay is not None
        names = {
            source.obligation.frozen_barangay
            for source in sources
            if source.obligation.frozen_barangay is not None
        }
        if len(names) != 1:
            raise FinalizationError(
                "FINALIZATION_BARANGAY_AMBIGUOUS",
                "The selected sources do not share one canonical frozen barangay.",
            )
        name = names.pop()
        return name, name
    enterprise_count = len({source.obligation.enterprise_id for source in sources})
    return None, f"Selected enterprises ({enterprise_count})"


async def _aggregate_metrics(db: AsyncSession, revision_ids: list[str]) -> list[_MetricAggregate]:
    facts = list(
        await db.scalars(
            select(ReportMetricFact)
            .where(ReportMetricFact.report_revision_id.in_(revision_ids))
            .order_by(
                ReportMetricFact.definition,
                ReportMetricFact.definition_version,
                ReportMetricFact.report_revision_id,
            )
        )
    )
    definitions = {
        "entries": ("entries", "sum"),
        "visitor_entries": ("entries", "sum"),
        "exits": ("exits", "sum"),
        "visitor_exits": ("exits", "sum"),
        "peak_occupancy": ("peak_occupancy", "maximum"),
        "occupancy_peak": ("peak_occupancy", "maximum"),
        "unique_visitor_estimate": (
            "unique_visitor_estimate",
            "summed_site_estimate",
        ),
        "venue_local_unique_estimate": (
            "unique_visitor_estimate",
            "summed_site_estimate",
        ),
    }
    grouped: dict[tuple[str, int], list[ReportMetricFact]] = defaultdict(list)
    per_revision: dict[str, Counter[str]] = defaultdict(Counter)
    for fact in facts:
        normalized_definition = definitions.get(fact.definition)
        # Current occupancy is live state, not a reproducible period aggregate.
        if normalized_definition is None:
            continue
        canonical_definition, _method = normalized_definition
        grouped[(canonical_definition, fact.definition_version)].append(fact)
        per_revision[fact.report_revision_id][canonical_definition] += 1
    required = {definition[0] for definition in definitions.values()}
    for revision_id in revision_ids:
        counts = per_revision[revision_id]
        missing = sorted(required - set(counts))
        duplicate = sorted(key for key, count in counts.items() if count != 1)
        if missing or duplicate:
            raise FinalizationError(
                "FINALIZATION_REQUIRED_METRICS_INCOMPLETE",
                f"Revision {revision_id} must contain exactly one of every required "
                f"final metric (missing={missing}, duplicate={duplicate}).",
            )
    aggregates: list[_MetricAggregate] = []
    for (definition, definition_version), group in sorted(grouped.items()):
        method = definitions[group[0].definition][1]
        if len(group) != len(revision_ids):
            raise FinalizationError(
                "FINALIZATION_REQUIRED_METRICS_INCOMPLETE",
                f"Metric {definition} is not represented once in every source revision.",
            )
        units = {fact.unit for fact in group}
        grains = {fact.grain for fact in group}
        if len(units) != 1 or len(grains) != 1:
            raise FinalizationError(
                "FINALIZATION_METRIC_GRAIN_CONFLICT",
                f"Metric {definition} has inconsistent unit or grain across sources.",
            )
        values = [Decimal(str(fact.value)) if fact.value is not None else None for fact in group]
        quality = _worst_quality([fact.quality for fact in group])
        if any(value is None for value in values):
            aggregate_value = None
            quality = "unknown"
        else:
            known_values = cast("list[Decimal]", values)
            aggregate_value = (
                max(known_values) if method == "maximum" else sum(known_values, Decimal(0))
            )
            if not fits_numeric_20_6(aggregate_value):
                raise FinalizationError(
                    "FINALIZATION_METRIC_VALUE_OVERFLOW",
                    f"Aggregated metric {definition} does not fit NUMERIC(20,6) exactly.",
                )
        aggregates.append(
            _MetricAggregate(
                definition=definition,
                definition_version=definition_version,
                unit=units.pop(),
                aggregation_method=method,
                value=aggregate_value,
                quality=quality,
                source_fact_count=len(group),
            )
        )
    return aggregates


async def _aggregate_demographics(
    db: AsyncSession, revision_ids: list[str]
) -> list[_DemographicAggregate]:
    facts = list(
        await db.scalars(
            select(ReportDemographicFact)
            .where(ReportDemographicFact.report_revision_id.in_(revision_ids))
            .order_by(
                ReportDemographicFact.dimension,
                ReportDemographicFact.value,
                ReportDemographicFact.report_revision_id,
            )
        )
    )
    grouped: dict[tuple[str, str], list[ReportDemographicFact]] = defaultdict(list)
    for fact in facts:
        grouped[(fact.dimension, fact.value)].append(fact)
    dimension_totals: dict[str, int] = defaultdict(int)
    counts: dict[tuple[str, str], int] = {}
    for key, group in grouped.items():
        count = sum(fact.count for fact in group)
        counts[key] = count
        dimension_totals[key[0]] += count
    aggregates: list[_DemographicAggregate] = []
    for (dimension, value), group in sorted(grouped.items()):
        count = counts[(dimension, value)]
        total = dimension_totals[dimension]
        percentage = (
            (Decimal(count) * Decimal(100) / Decimal(total)).quantize(Decimal("0.0001"))
            if total > 0
            else None
        )
        aggregates.append(
            _DemographicAggregate(
                dimension=dimension,
                value=value,
                count=count,
                percentage=percentage,
                quality=_worst_quality([fact.quality for fact in group], allow_unknown=False),
                source_fact_count=len(group),
            )
        )
    return aggregates


def _worst_quality(values: list[str], *, allow_unknown: bool = True) -> str:
    ordering = {"confirmed": 0, "degraded": 1, "estimated": 2, "unknown": 3}
    supported = (
        ordering
        if allow_unknown
        else {key: value for key, value in ordering.items() if key != "unknown"}
    )
    return max(values, key=lambda item: supported[item]) if values else "unknown"


def _metric_fact_models(
    version: FinalReportVersion, aggregates: list[_MetricAggregate]
) -> list[FinalReportMetricFact]:
    return [
        FinalReportMetricFact(
            id=str(uuid4()),
            final_report_version_id=version.id,
            classification=version.classification,
            definition=item.definition,
            definition_version=item.definition_version,
            value=item.value,
            unit=item.unit,
            aggregation_method=item.aggregation_method,
            quality=item.quality,
            source_fact_count=item.source_fact_count,
        )
        for item in aggregates
    ]


def _demographic_fact_models(
    version: FinalReportVersion, aggregates: list[_DemographicAggregate]
) -> list[FinalReportDemographicFact]:
    return [
        FinalReportDemographicFact(
            id=str(uuid4()),
            final_report_version_id=version.id,
            classification=version.classification,
            dimension=item.dimension,
            value=item.value,
            count=item.count,
            percentage=item.percentage,
            quality=item.quality,
            source_fact_count=item.source_fact_count,
        )
        for item in aggregates
    ]


def _final_content_hash(
    *,
    period_id: str,
    classification: str,
    version_number: int,
    scope_type: str,
    scope_barangay: str | None,
    scope_label: str,
    sources: list[_Source],
    metrics: list[_MetricAggregate],
    demographics: list[_DemographicAggregate],
    prepared_by: Account,
    finalized_at: datetime,
) -> str:
    return canonical_payload_hash(
        {
            "reportingPeriodId": period_id,
            "classification": classification,
            "versionNumber": version_number,
            "scope": {
                "type": scope_type,
                "barangay": scope_barangay,
                "label": scope_label,
                "obligationIds": sorted(source.obligation.id for source in sources),
            },
            "sources": [
                {
                    "reportRevisionId": source.revision.id,
                    "reportingObligationId": source.obligation.id,
                    "payloadHash": source.revision.payload_hash,
                }
                for source in sorted(sources, key=lambda item: item.revision.id)
            ],
            "scopeMembers": [
                {
                    "reportingObligationId": source.obligation.id,
                    "enterpriseId": source.enterprise.id,
                    "enterpriseOfficialCode": source.enterprise.official_code,
                    "enterpriseName": source.enterprise.name,
                    "enterpriseCategory": source.enterprise.category,
                    "siteId": source.site.id,
                    "siteCode": source.site.site_code,
                    "siteName": source.site.name,
                    "frozenBarangay": source.obligation.frozen_barangay,
                }
                for source in sorted(sources, key=lambda item: item.obligation.id)
            ],
            "metrics": [
                {
                    "definition": item.definition,
                    "definitionVersion": item.definition_version,
                    "unit": item.unit,
                    "aggregationMethod": item.aggregation_method,
                    "value": format(item.value, "f") if item.value is not None else None,
                    "quality": item.quality,
                    "sourceFactCount": item.source_fact_count,
                }
                for item in metrics
            ],
            "demographics": [
                {
                    "dimension": item.dimension,
                    "value": item.value,
                    "count": item.count,
                    "percentage": (
                        format(item.percentage, "f") if item.percentage is not None else None
                    ),
                    "quality": item.quality,
                    "sourceFactCount": item.source_fact_count,
                }
                for item in demographics
            ],
            "preparedBy": {
                "accountId": prepared_by.id,
                "name": prepared_by.display_name,
                "role": prepared_by.role.value,
            },
            "finalizedAt": finalized_at,
        }
    )


async def _allocate_report_code(
    db: AsyncSession, *, period: ReportingPeriod, classification: str
) -> str:
    sequence_number = await db.scalar(text("SELECT nextval('report_finalization_code_seq')"))
    if not isinstance(sequence_number, int):
        raise RuntimeError("The report-finalization code sequence returned an invalid value.")
    class_marker = "O" if classification == "official" else "S"
    period_marker = period.local_start_date.strftime("%Y%m")
    return f"FR-{period_marker}-{class_marker}-{sequence_number:08d}"


def _domain_event(
    *,
    finalization: ReportFinalization,
    version: FinalReportVersion,
    command: FinalizeReportsCommand,
    account: Account,
    occurred_at: datetime,
) -> DomainEvent:
    payload: dict[str, object] = {
        "reportFinalizationId": finalization.id,
        "finalReportVersionId": version.id,
        "reportCode": finalization.report_code,
        "reportingPeriodId": finalization.reporting_period_id,
        "versionNumber": version.version_number,
        "scopeType": version.scope_type,
        "scopeLabel": version.scope_label,
        "sourceCount": version.source_count,
        "artifactStatus": "pending",
    }
    payload_hash = canonical_payload_hash(payload)
    return DomainEvent(
        id=str(uuid4()),
        event_key=f"final-report:{finalization.id}:version:{version.version_number}",
        event_type="final_report.version_finalized",
        contract_version=2,
        schema_version=1,
        aggregate_type="report_finalization",
        aggregate_id=finalization.id,
        aggregate_version=version.version_number,
        enterprise_id=None,
        site_id=None,
        classification="official",
        actor_account_id=account.id,
        correlation_id=str(command.commandId),
        causation_id=None,
        payload_json=json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        payload_hash=payload_hash,
        occurred_at=occurred_at,
        available_at=occurred_at,
    )


def _acknowledgement(
    *,
    command_id: UUID,
    disposition: Literal["created", "replayed"],
    payload_hash: str,
    acknowledged_at: datetime,
    finalization: ReportFinalization,
    version: FinalReportVersion,
    logical_version: int | None = None,
) -> FinalizationAcknowledgement:
    return FinalizationAcknowledgement(
        contractVersion=2,
        commandId=command_id,
        disposition=disposition,
        payloadHash=payload_hash,
        acknowledgedAt=acknowledged_at,
        resource=FinalizationAcknowledgementResource(
            reportFinalizationId=UUID(finalization.id),
            finalReportVersionId=UUID(version.id),
            reportCode=finalization.report_code,
            reportingPeriodId=UUID(finalization.reporting_period_id),
            classification="official",
            versionNumber=version.version_number,
            logicalVersion=logical_version or version.version_number,
            scopeType=cast(
                "Literal['citywide', 'barangay', 'enterprise_selection']", version.scope_type
            ),
            scopeLabel=version.scope_label,
            sourceCount=version.source_count,
            artifactStatus="pending",
        ),
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Finalization timestamps must include a UTC offset.")
    return value.astimezone(UTC)
