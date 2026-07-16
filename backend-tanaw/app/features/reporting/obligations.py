from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID, uuid4

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.reporting.envelopes import canonical_payload_hash
from app.features.reporting.models import EnterpriseReport, ReportingObligation, ReportingPeriod
from app.features.reporting.obligation_envelopes import (
    ComplianceStatus,
    EligibilityStatus,
    ObligationFreezeAcknowledgement,
    ObligationFreezeCommand,
    ObligationResolutionCommand,
    ObligationResource,
    ObligationSummary,
    PeriodComplianceResource,
    ReminderIntentAcknowledgement,
    ReminderIntentCommand,
    ReminderPhase,
)
from app.features.topology.models import (
    Enterprise,
    EnterpriseMembership,
    EnterpriseSite,
    SiteLocationVersion,
)

_FREEZE_EVENT_TYPE = "reporting_period.obligations_frozen"
_FREEZE_COMMAND_EVENT_TYPE = "reporting_period.obligation_freeze_recorded"
_FREEZE_REPLAY_EVENT_TYPE = "reporting_period.obligation_freeze_replayed"
_RECONCILIATION_EVENT_TYPE = "reporting_period.obligations_reconciled"
_REMINDER_EVENT_TYPE = "reporting_obligation.reminder_requested"
_REMINDER_COMMAND_EVENT_TYPE = "reporting_period.reminder_intents_recorded"


class ObligationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class ObligationNotFound(ObligationError):
    pass


class ObligationConflict(ObligationError):
    pass


@dataclass(frozen=True, slots=True)
class EligibilityDecision:
    status: EligibilityStatus
    reason: str | None
    acceptance_blocked: bool


def derive_eligibility(
    *,
    enterprise_lifecycle_state: str,
    frozen_barangay: str | None,
    location_resolution_error: str | None = None,
) -> EligibilityDecision:
    """Derive one frozen status without treating unresolved topology as official evidence."""

    if location_resolution_error is not None:
        return EligibilityDecision(
            status="unknown",
            reason=f"unresolved_topology: {location_resolution_error}",
            acceptance_blocked=True,
        )
    if enterprise_lifecycle_state != "active":
        return EligibilityDecision(
            status="ineligible",
            reason=f"enterprise_lifecycle: {enterprise_lifecycle_state}",
            acceptance_blocked=False,
        )
    if frozen_barangay is None or not frozen_barangay.strip():
        return EligibilityDecision(
            status="unknown",
            reason="unresolved_topology: missing frozen barangay",
            acceptance_blocked=True,
        )
    return EligibilityDecision(status="eligible", reason=None, acceptance_blocked=False)


def reminder_phase(period: ReportingPeriod, *, as_of: datetime) -> ReminderPhase:
    """Return a server-derived phase using immutable period instants."""

    observed_at = _as_utc(as_of)
    if observed_at < _as_utc(period.starts_at):
        return "pre_window"
    if observed_at < _as_utc(period.submission_opens_at):
        return "current_period"
    return "overdue"


def compliance_status(
    *,
    eligibility_status: str,
    workflow_state: str | None,
) -> ComplianceStatus | None:
    if eligibility_status != "eligible":
        return None
    if workflow_state is None:
        return "not_submitted"
    if workflow_state not in {"submitted", "returned", "accepted", "consolidated"}:
        raise RuntimeError(f"Unsupported report workflow state: {workflow_state}.")
    return cast(ComplianceStatus, workflow_state)


async def freeze_period_obligations(
    db: AsyncSession,
    *,
    account: Account | None,
    reporting_period_id: UUID,
    command: ObligationFreezeCommand,
    frozen_at: datetime | None = None,
) -> ObligationFreezeAcknowledgement:
    if account is not None:
        _require_role(account, {"staff"})
    observed_at = _as_utc(frozen_at or datetime.now(UTC))
    period_id = str(reporting_period_id)
    period = await db.scalar(
        select(ReportingPeriod).where(ReportingPeriod.id == period_id).with_for_update()
    )
    if period is None:
        raise ObligationNotFound(
            "REPORTING_PERIOD_NOT_FOUND", "The reporting period does not exist."
        )

    marker = await _freeze_marker(db, period_id)
    request_payload = _freeze_request_payload(period_id=period_id, command=command)
    request_hash = canonical_payload_hash(request_payload)
    prior_command_events = await _command_events(db, str(command.commandId))
    if prior_command_events:
        matching_event = next(
            (
                event
                for event in prior_command_events
                if event.event_type
                in {
                    _FREEZE_EVENT_TYPE,
                    _FREEZE_COMMAND_EVENT_TYPE,
                    _FREEZE_REPLAY_EVENT_TYPE,
                    _RECONCILIATION_EVENT_TYPE,
                }
                and _event_payload(event).get("reportingPeriodId") == period_id
                and _event_payload(event).get("requestHash") == request_hash
            ),
            None,
        )
        if matching_event is None:
            raise ObligationConflict(
                "REPORTING_COMMAND_ID_REUSED",
                "The command ID is already bound to a different reporting operation.",
            )
        resource = await read_period_compliance(
            db,
            account=account,
            reporting_period_id=reporting_period_id,
        )
        return _freeze_acknowledgement(
            command=command,
            disposition="replayed",
            acknowledged_at=_as_utc(matching_event.occurred_at),
            resource=resource,
        )
    if marker is not None:
        if not command.resolutions:
            replay_payload = {
                **request_payload,
                "eventType": _FREEZE_REPLAY_EVENT_TYPE,
                "periodKey": period.natural_key,
                "requestHash": request_hash,
            }
            replay_event = _domain_event(
                event_key=f"reporting-obligation-command:{command.commandId}",
                event_type=_FREEZE_REPLAY_EVENT_TYPE,
                aggregate_type="reporting_period",
                aggregate_id=period.id,
                enterprise_id=None,
                site_id=None,
                actor_account_id=account.id if account is not None else None,
                correlation_id=str(command.commandId),
                payload=replay_payload,
                occurred_at=observed_at,
            )
            await _queue_event(db, event=replay_event, available_at=observed_at)
            resource = await read_period_compliance(
                db,
                account=account,
                reporting_period_id=reporting_period_id,
            )
            return _freeze_acknowledgement(
                command=command,
                disposition="replayed",
                acknowledged_at=observed_at,
                resource=resource,
            )
        replayed_at = await _reconcile_frozen_obligations(
            db,
            account=account,
            period=period,
            command=command,
            request_payload=request_payload,
            request_hash=request_hash,
            changed_at=observed_at,
        )
        resource = await read_period_compliance(
            db,
            account=account,
            reporting_period_id=reporting_period_id,
        )
        return _freeze_acknowledgement(
            command=command,
            disposition="replayed" if replayed_at is not None else "reconciled",
            acknowledged_at=replayed_at or observed_at,
            resource=resource,
        )

    existing_obligations = list(
        await db.scalars(
            select(ReportingObligation)
            .where(
                ReportingObligation.reporting_period_id == period.id,
                ReportingObligation.classification == "official",
            )
            .order_by(ReportingObligation.enterprise_id, ReportingObligation.site_id)
            .with_for_update()
        )
    )
    existing_by_scope = {
        (obligation.enterprise_id, obligation.site_id, obligation.classification): obligation
        for obligation in existing_obligations
    }
    existing_by_site = {obligation.site_id: obligation for obligation in existing_obligations}
    site_candidates = list(
        (
            await db.execute(
                select(EnterpriseSite, Enterprise)
                .join(Enterprise, Enterprise.id == EnterpriseSite.enterprise_id)
                .where(
                    Enterprise.classification == "official",
                    EnterpriseSite.classification == "official",
                    EnterpriseSite.registered_at < period.ends_at,
                    or_(
                        EnterpriseSite.retired_at.is_(None),
                        EnterpriseSite.retired_at > period.starts_at,
                    ),
                )
                .order_by(
                    EnterpriseSite.enterprise_id,
                    EnterpriseSite.site_code,
                    EnterpriseSite.id,
                )
            )
        )
        .tuples()
        .all()
    )
    candidate_site_ids = {site.id for site, _enterprise in site_candidates}
    location_versions = list(
        await db.scalars(
            select(SiteLocationVersion)
            .where(
                SiteLocationVersion.site_id.in_(candidate_site_ids),
                SiteLocationVersion.classification == "official",
            )
            .order_by(
                SiteLocationVersion.site_id,
                SiteLocationVersion.effective_from,
                SiteLocationVersion.version,
                SiteLocationVersion.id,
            )
        )
    )
    location_versions_by_site: dict[str, list[SiteLocationVersion]] = defaultdict(list)
    for location_version in location_versions:
        location_versions_by_site[location_version.site_id].append(location_version)
    resolutions = {str(resolution.siteId): resolution for resolution in command.resolutions}
    frozen_site_ids = candidate_site_ids | set(existing_by_site)
    unknown_sites = sorted(set(resolutions) - frozen_site_ids)
    if unknown_sites:
        raise ObligationConflict(
            "OBLIGATION_RESOLUTION_SITE_NOT_IN_SNAPSHOT",
            "Manual resolutions may target only official sites effective in the frozen period: "
            + ", ".join(unknown_sites),
        )

    created_obligations: list[ReportingObligation] = []
    for site, enterprise in site_candidates:
        existing_obligation = existing_by_scope.get((enterprise.id, site.id, "official"))
        if existing_obligation is not None:
            resolution = resolutions.get(site.id)
            if resolution is not None:
                _apply_resolution(existing_obligation, resolution)
            continue
        # A site that existed before the period is represented by its location at the
        # inclusive period start. A site registered during the period is represented at
        # its registration instant. Later, non-overlapping address versions must not make
        # the historical obligation ambiguous.
        location_as_of = max(_as_utc(period.starts_at), _as_utc(site.registered_at))
        effective_locations = [
            location
            for location in location_versions_by_site.get(site.id, [])
            if _effective_at(location.effective_from, location.effective_to, location_as_of)
        ]
        location = effective_locations[0] if len(effective_locations) == 1 else None
        location_resolution_error = None
        if not effective_locations:
            location_resolution_error = "missing effective location version"
        elif len(effective_locations) > 1:
            location_resolution_error = "overlapping effective location versions"
        frozen_barangay = _normalized_optional(location.barangay) if location is not None else None
        decision = derive_eligibility(
            enterprise_lifecycle_state=enterprise.lifecycle_state,
            frozen_barangay=frozen_barangay,
            location_resolution_error=location_resolution_error,
        )
        resolution = resolutions.get(site.id)
        if resolution is not None:
            frozen_barangay = resolution.frozenBarangay or frozen_barangay
            decision = EligibilityDecision(
                status=resolution.eligibilityStatus,
                reason=resolution.reason,
                acceptance_blocked=False,
            )
        created_obligations.append(
            ReportingObligation(
                id=str(uuid4()),
                reporting_period_id=period.id,
                enterprise_id=enterprise.id,
                site_id=site.id,
                classification="official",
                eligibility_status=decision.status,
                eligibility_basis=(
                    "manual_resolution" if resolution is not None else "registry_snapshot"
                ),
                exemption_reason=decision.reason,
                frozen_barangay=frozen_barangay,
                enterprise_official_code=enterprise.official_code,
                enterprise_name=enterprise.name,
                site_code=site.site_code,
                site_name=site.name,
                timezone_name=location.timezone_name
                if location is not None
                else period.timezone_name,
                # The effective-dated site is the authoritative registration fact.
                registration_effective_at=_as_utc(site.registered_at),
                acceptance_blocked=decision.acceptance_blocked,
            )
        )
    for site_id, resolution in resolutions.items():
        if site_id not in candidate_site_ids:
            _apply_resolution(existing_by_site[site_id], resolution)

    obligations = [*existing_obligations, *created_obligations]
    period.obligations_frozen_at = observed_at
    db.add_all(created_obligations)
    await db.flush()

    marker_payload = {
        "contractVersion": 2,
        "eventType": _FREEZE_EVENT_TYPE,
        "reportingPeriodId": period.id,
        "periodKey": period.natural_key,
        "classification": "official",
        "commandId": str(command.commandId),
        "requestHash": request_hash,
        "obligationIds": sorted(obligation.id for obligation in obligations),
        "obligationCount": len(obligations),
        "preservedObligationCount": len(existing_obligations),
        "createdObligationCount": len(created_obligations),
    }
    marker_event = _domain_event(
        event_key=_freeze_event_key(period.id),
        event_type=_FREEZE_EVENT_TYPE,
        aggregate_type="reporting_period",
        aggregate_id=period.id,
        enterprise_id=None,
        site_id=None,
        actor_account_id=account.id if account is not None else None,
        correlation_id=str(command.commandId),
        payload=marker_payload,
        occurred_at=observed_at,
    )
    await _queue_event(db, event=marker_event, available_at=observed_at)
    command_receipt_payload = {
        **request_payload,
        "eventType": _FREEZE_COMMAND_EVENT_TYPE,
        "periodKey": period.natural_key,
        "requestHash": request_hash,
        "disposition": "created",
    }
    db.add(
        _domain_event(
            event_key=f"reporting-obligation-command:{command.commandId}",
            event_type=_FREEZE_COMMAND_EVENT_TYPE,
            aggregate_type="reporting_period",
            aggregate_id=period.id,
            enterprise_id=None,
            site_id=None,
            actor_account_id=account.id if account is not None else None,
            correlation_id=str(command.commandId),
            payload=command_receipt_payload,
            occurred_at=observed_at,
        )
    )
    # The command receipt is audit/idempotency state. The freeze marker owns deliveries.
    await db.flush()
    resource = await read_period_compliance(
        db,
        account=account,
        reporting_period_id=reporting_period_id,
    )
    return _freeze_acknowledgement(
        command=command,
        disposition="created",
        acknowledged_at=observed_at,
        resource=resource,
    )


async def read_period_compliance(
    db: AsyncSession,
    *,
    account: Account | None,
    reporting_period_id: UUID,
) -> PeriodComplianceResource:
    if account is not None:
        _require_role(account, {"staff", "admin", "enterprise"})
    period_id = str(reporting_period_id)
    period = await db.get(ReportingPeriod, period_id)
    if period is None:
        raise ObligationNotFound(
            "REPORTING_PERIOD_NOT_FOUND", "The reporting period does not exist."
        )
    if period.obligations_frozen_at is None or await _freeze_marker(db, period_id) is None:
        raise ObligationConflict(
            "PERIOD_OBLIGATIONS_NOT_FROZEN",
            "Reporting compliance is unavailable until this period's obligations are frozen.",
        )

    enterprise_id: str | None = None
    if account is not None and account.role.value == "enterprise":
        membership = await db.scalar(
            select(EnterpriseMembership).where(
                EnterpriseMembership.account_id == account.id,
                EnterpriseMembership.classification == "official",
                EnterpriseMembership.ended_at.is_(None),
            )
        )
        if membership is None:
            raise ObligationNotFound(
                "ENTERPRISE_MEMBERSHIP_NOT_FOUND",
                "No active official enterprise membership exists for this account.",
            )
        enterprise_id = membership.enterprise_id

    statement = (
        select(ReportingObligation, EnterpriseReport)
        .outerjoin(
            EnterpriseReport,
            EnterpriseReport.reporting_obligation_id == ReportingObligation.id,
        )
        .where(
            ReportingObligation.reporting_period_id == period.id,
            ReportingObligation.classification == "official",
        )
        .order_by(ReportingObligation.enterprise_id, ReportingObligation.site_id)
    )
    if enterprise_id is not None:
        statement = statement.where(ReportingObligation.enterprise_id == enterprise_id)
    rows = list((await db.execute(statement)).tuples().all())
    resources = [_obligation_resource(obligation, report) for obligation, report in rows]
    return PeriodComplianceResource.model_validate(
        {
            "reportingPeriodId": period.id,
            "periodKey": period.natural_key,
            "periodLabel": period.label,
            "timezone": period.timezone_name,
            "startsAt": period.starts_at,
            "endsAt": period.ends_at,
            "submissionOpensAt": period.submission_opens_at,
            "submissionClosesAt": period.submission_closes_at,
            "status": period.status,
            "frozen": True,
            "frozenAt": period.obligations_frozen_at,
            "summary": _summary(resources),
            "obligations": resources,
        }
    )


async def create_reminder_intents(
    db: AsyncSession,
    *,
    account: Account,
    reporting_period_id: UUID,
    command: ReminderIntentCommand,
    as_of: datetime | None = None,
) -> ReminderIntentAcknowledgement:
    _require_role(account, {"staff"})
    observed_at = _as_utc(as_of or datetime.now(UTC))
    period_id = str(reporting_period_id)
    period = await db.scalar(
        select(ReportingPeriod).where(ReportingPeriod.id == period_id).with_for_update()
    )
    if period is None:
        raise ObligationNotFound(
            "REPORTING_PERIOD_NOT_FOUND", "The reporting period does not exist."
        )
    if await _freeze_marker(db, period_id) is None:
        raise ObligationConflict(
            "PERIOD_OBLIGATIONS_NOT_FROZEN",
            "Reminder intents require a frozen reporting-obligation snapshot.",
        )

    phase = reminder_phase(period, as_of=observed_at)
    command_request = {
        "contractVersion": 2,
        "action": "create_reminder_intents",
        "commandId": str(command.commandId),
        "reportingPeriodId": period.id,
        "phase": phase,
    }
    command_request_hash = canonical_payload_hash(command_request)
    prior_command_events = await _command_events(db, str(command.commandId))
    if prior_command_events:
        receipt = next(
            (
                event
                for event in prior_command_events
                if event.event_type == _REMINDER_COMMAND_EVENT_TYPE
                and _event_payload(event).get("requestHash") == command_request_hash
            ),
            None,
        )
        if receipt is None:
            raise ObligationConflict(
                "REPORTING_COMMAND_ID_REUSED",
                "The command ID is already bound to a different reporting operation.",
            )
        receipt_payload = _event_payload(receipt)
        return ReminderIntentAcknowledgement.model_validate(
            {
                "contractVersion": 2,
                "commandId": command.commandId,
                "disposition": "replayed",
                "acknowledgedAt": receipt.occurred_at,
                "reportingPeriodId": period.id,
                "periodKey": period.natural_key,
                "phase": phase,
                "createdCount": 0,
                "existingCount": receipt_payload["targetCount"],
                "skippedCount": receipt_payload["skippedCount"],
                "eventIds": receipt_payload["eventIds"],
            }
        )
    rows = list(
        (
            await db.execute(
                select(ReportingObligation, EnterpriseReport)
                .outerjoin(
                    EnterpriseReport,
                    EnterpriseReport.reporting_obligation_id == ReportingObligation.id,
                )
                .where(
                    ReportingObligation.reporting_period_id == period.id,
                    ReportingObligation.classification == "official",
                    ReportingObligation.eligibility_status == "eligible",
                    ReportingObligation.acceptance_blocked.is_(False),
                )
                .order_by(ReportingObligation.enterprise_id, ReportingObligation.site_id)
            )
        )
        .tuples()
        .all()
    )
    targets = [
        (obligation, report)
        for obligation, report in rows
        if _reminder_is_applicable(phase=phase, report=report)
    ]
    keys = [_reminder_event_key(obligation.id, phase) for obligation, _report in targets]
    existing_events: dict[str, DomainEvent] = {}
    if keys:
        existing_events = {
            event.event_key: event
            for event in await db.scalars(
                select(DomainEvent).where(DomainEvent.event_key.in_(keys))
            )
        }

    created_events: list[DomainEvent] = []
    event_ids: list[str] = []
    for obligation, report in targets:
        event_key = _reminder_event_key(obligation.id, phase)
        existing = existing_events.get(event_key)
        if existing is not None:
            event_ids.append(existing.id)
            continue
        state = compliance_status(
            eligibility_status=obligation.eligibility_status,
            workflow_state=report.workflow_state if report is not None else None,
        )
        payload = {
            "contractVersion": 2,
            "eventType": _REMINDER_EVENT_TYPE,
            "phase": phase,
            "reportingPeriodId": period.id,
            "periodKey": period.natural_key,
            "periodLabel": period.label,
            "submissionOpensAt": _as_utc(period.submission_opens_at).isoformat(),
            "obligationId": obligation.id,
            "enterpriseId": obligation.enterprise_id,
            "enterpriseOfficialCode": obligation.enterprise_official_code,
            "enterpriseName": obligation.enterprise_name,
            "siteId": obligation.site_id,
            "siteCode": obligation.site_code,
            "siteName": obligation.site_name,
            "complianceStatus": state,
            "targetPath": f"/enterprise/reports?periodId={period.id}",
        }
        event = _domain_event(
            event_key=event_key,
            event_type=_REMINDER_EVENT_TYPE,
            aggregate_type="reporting_obligation",
            aggregate_id=obligation.id,
            enterprise_id=obligation.enterprise_id,
            site_id=obligation.site_id,
            actor_account_id=account.id,
            correlation_id=str(command.commandId),
            payload=payload,
            occurred_at=observed_at,
        )
        created_events.append(event)
        event_ids.append(event.id)
    db.add_all(created_events)
    if created_events:
        await db.flush()
        db.add_all(
            [
                DomainEventDelivery(
                    id=str(uuid4()),
                    domain_event_id=event.id,
                    destination=destination,
                    status="pending",
                    attempt_count=0,
                    next_attempt_at=observed_at,
                )
                for event in created_events
                for destination in ("notification_projection", "realtime_broadcast")
            ]
        )
        await db.flush()

    created_count = len(created_events)
    existing_count = len(targets) - created_count
    skipped_count = len(rows) - len(targets)
    receipt_payload = {
        **command_request,
        "eventType": _REMINDER_COMMAND_EVENT_TYPE,
        "periodKey": period.natural_key,
        "requestHash": command_request_hash,
        "targetCount": len(targets),
        "skippedCount": skipped_count,
        "eventIds": event_ids,
    }
    db.add(
        _domain_event(
            event_key=f"reporting-obligation-command:{command.commandId}",
            event_type=_REMINDER_COMMAND_EVENT_TYPE,
            aggregate_type="reporting_period",
            aggregate_id=period.id,
            enterprise_id=None,
            site_id=None,
            actor_account_id=account.id,
            correlation_id=str(command.commandId),
            payload=receipt_payload,
            occurred_at=observed_at,
        )
    )
    # This command receipt is audit/idempotency state only. The per-obligation reminder
    # intents above own notification and realtime deliveries.
    await db.flush()
    return ReminderIntentAcknowledgement.model_validate(
        {
            "contractVersion": 2,
            "commandId": command.commandId,
            "disposition": "created" if created_count else "replayed",
            "acknowledgedAt": observed_at,
            "reportingPeriodId": period.id,
            "periodKey": period.natural_key,
            "phase": phase,
            "createdCount": created_count,
            "existingCount": existing_count,
            "skippedCount": skipped_count,
            "eventIds": event_ids,
        }
    )


async def _reconcile_frozen_obligations(
    db: AsyncSession,
    *,
    account: Account | None,
    period: ReportingPeriod,
    command: ObligationFreezeCommand,
    request_payload: dict[str, object],
    request_hash: str,
    changed_at: datetime,
) -> datetime | None:
    event_key = f"reporting-obligation-command:{command.commandId}"
    existing_event = await db.scalar(select(DomainEvent).where(DomainEvent.event_key == event_key))
    if existing_event is not None:
        if _event_payload(existing_event).get("requestHash") != request_hash:
            raise ObligationConflict(
                "OBLIGATION_RECONCILIATION_IDEMPOTENCY_CONFLICT",
                "The reconciliation command ID was already used with different resolutions.",
            )
        return _as_utc(existing_event.occurred_at)

    site_ids = [str(resolution.siteId) for resolution in command.resolutions]
    obligations = list(
        await db.scalars(
            select(ReportingObligation)
            .where(
                ReportingObligation.reporting_period_id == period.id,
                ReportingObligation.classification == "official",
                ReportingObligation.site_id.in_(site_ids),
            )
            .with_for_update()
        )
    )
    obligations_by_site = {obligation.site_id: obligation for obligation in obligations}
    unknown_sites = sorted(set(site_ids) - set(obligations_by_site))
    if unknown_sites:
        raise ObligationConflict(
            "OBLIGATION_RESOLUTION_SITE_NOT_FROZEN",
            "Reconciliation cannot add sites to the frozen period: " + ", ".join(unknown_sites),
        )

    for resolution in command.resolutions:
        obligation = obligations_by_site[str(resolution.siteId)]
        _apply_resolution(obligation, resolution)

    event_payload = {
        **request_payload,
        "eventType": _RECONCILIATION_EVENT_TYPE,
        "periodKey": period.natural_key,
        "requestHash": request_hash,
    }
    event = _domain_event(
        event_key=event_key,
        event_type=_RECONCILIATION_EVENT_TYPE,
        aggregate_type="reporting_period",
        aggregate_id=period.id,
        enterprise_id=None,
        site_id=None,
        actor_account_id=account.id if account is not None else None,
        correlation_id=str(command.commandId),
        payload=event_payload,
        occurred_at=changed_at,
    )
    await _queue_event(db, event=event, available_at=changed_at)
    return None


async def _freeze_marker(db: AsyncSession, period_id: str) -> DomainEvent | None:
    marker: DomainEvent | None = await db.scalar(
        select(DomainEvent).where(
            DomainEvent.event_key == _freeze_event_key(period_id),
            DomainEvent.event_type == _FREEZE_EVENT_TYPE,
            DomainEvent.classification == "official",
        )
    )
    return marker


async def _command_events(db: AsyncSession, command_id: str) -> list[DomainEvent]:
    return list(
        await db.scalars(
            select(DomainEvent)
            .where(DomainEvent.correlation_id == command_id)
            .order_by(DomainEvent.recorded_at, DomainEvent.id)
        )
    )


async def _queue_event(
    db: AsyncSession,
    *,
    event: DomainEvent,
    available_at: datetime,
) -> None:
    """Persist a compliance change and both downstream intents in one transaction."""

    db.add(event)
    await db.flush()
    db.add_all(
        [
            DomainEventDelivery(
                id=str(uuid4()),
                domain_event_id=event.id,
                destination=destination,
                status="pending",
                attempt_count=0,
                next_attempt_at=available_at,
            )
            for destination in ("notification_projection", "realtime_broadcast")
        ]
    )
    await db.flush()


def _freeze_event_key(period_id: str) -> str:
    return f"reporting-period:{period_id}:official-obligations-frozen:v1"


def _apply_resolution(
    obligation: ReportingObligation,
    resolution: ObligationResolutionCommand,
) -> None:
    exact_existing = (
        obligation.eligibility_status == resolution.eligibilityStatus
        and obligation.exemption_reason == resolution.reason
        and (
            resolution.eligibilityStatus != "eligible"
            or obligation.frozen_barangay == resolution.frozenBarangay
        )
    )
    if exact_existing:
        return
    if obligation.eligibility_status != "unknown":
        raise ObligationConflict(
            "FROZEN_OBLIGATION_CANNOT_BE_REWRITTEN",
            "Only unresolved frozen obligations may be reconciled; established historical "
            f"eligibility for site {obligation.site_id} is immutable.",
        )
    obligation.eligibility_status = resolution.eligibilityStatus
    obligation.eligibility_basis = "manual_resolution"
    obligation.exemption_reason = resolution.reason
    obligation.acceptance_blocked = False
    if resolution.eligibilityStatus == "eligible":
        obligation.frozen_barangay = resolution.frozenBarangay


def _reminder_event_key(obligation_id: str, phase: ReminderPhase) -> str:
    return f"reporting-obligation:{obligation_id}:reminder:{phase}:v1"


def _freeze_request_payload(
    *,
    period_id: str,
    command: ObligationFreezeCommand,
) -> dict[str, object]:
    resolutions = sorted(
        (resolution.model_dump(mode="json") for resolution in command.resolutions),
        key=lambda resolution: str(resolution["siteId"]),
    )
    return {
        "contractVersion": 2,
        "commandId": str(command.commandId),
        "reportingPeriodId": period_id,
        "resolutions": resolutions,
    }


def _event_payload(event: DomainEvent) -> dict[str, object]:
    try:
        value = json.loads(event.payload_json)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Domain event {event.id} contains invalid JSON.") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"Domain event {event.id} does not contain an object payload.")
    return cast(dict[str, object], value)


def _domain_event(
    *,
    event_key: str,
    event_type: str,
    aggregate_type: str,
    aggregate_id: str,
    enterprise_id: str | None,
    site_id: str | None,
    actor_account_id: str | None,
    correlation_id: str,
    payload: dict[str, object],
    occurred_at: datetime,
    payload_hash: str | None = None,
) -> DomainEvent:
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return DomainEvent(
        id=str(uuid4()),
        event_key=event_key,
        event_type=event_type,
        contract_version=2,
        schema_version=1,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        aggregate_version=1,
        enterprise_id=enterprise_id,
        site_id=site_id,
        classification="official",
        actor_account_id=actor_account_id,
        correlation_id=correlation_id,
        causation_id=correlation_id,
        payload_json=payload_json,
        payload_hash=payload_hash or canonical_payload_hash(payload),
        occurred_at=occurred_at,
        available_at=occurred_at,
        retention_expires_at=None,
    )


def _obligation_resource(
    obligation: ReportingObligation,
    report: EnterpriseReport | None,
) -> ObligationResource:
    state = compliance_status(
        eligibility_status=obligation.eligibility_status,
        workflow_state=report.workflow_state if report is not None else None,
    )
    return ObligationResource.model_validate(
        {
            "obligationId": obligation.id,
            "enterpriseId": obligation.enterprise_id,
            "enterpriseOfficialCode": obligation.enterprise_official_code,
            "enterpriseName": obligation.enterprise_name,
            "siteId": obligation.site_id,
            "siteCode": obligation.site_code,
            "siteName": obligation.site_name,
            "classification": obligation.classification,
            "eligibilityStatus": obligation.eligibility_status,
            "eligibilityBasis": obligation.eligibility_basis,
            "eligibilityReason": obligation.exemption_reason,
            "frozenBarangay": obligation.frozen_barangay,
            "timezone": obligation.timezone_name,
            "registrationEffectiveAt": obligation.registration_effective_at,
            "acceptanceBlocked": obligation.acceptance_blocked,
            "complianceStatus": state,
            "enterpriseReportId": report.id if report is not None else None,
            "logicalVersion": report.logical_version if report is not None else None,
        }
    )


def _summary(resources: list[ObligationResource]) -> ObligationSummary:
    eligibility = Counter(resource.eligibilityStatus for resource in resources)
    states = Counter(
        resource.complianceStatus for resource in resources if resource.complianceStatus is not None
    )
    expected = eligibility["eligible"]
    complete_count = states["accepted"] + states["consolidated"]
    return ObligationSummary.model_validate(
        {
            "totalFrozen": len(resources),
            "eligibleExpected": expected,
            "exempt": eligibility["exempt"],
            "ineligible": eligibility["ineligible"],
            "unresolved": eligibility["unknown"],
            "notSubmitted": states["not_submitted"],
            "submitted": states["submitted"],
            "returned": states["returned"],
            "accepted": states["accepted"],
            "consolidated": states["consolidated"],
            "complete": eligibility["unknown"] == 0 and complete_count == expected,
        }
    )


def _reminder_is_applicable(
    *,
    phase: ReminderPhase,
    report: EnterpriseReport | None,
) -> bool:
    if phase != "overdue":
        return report is None
    return report is None or report.workflow_state == "returned"


def _freeze_acknowledgement(
    *,
    command: ObligationFreezeCommand,
    disposition: Literal["created", "reconciled", "replayed"],
    acknowledged_at: datetime,
    resource: PeriodComplianceResource,
) -> ObligationFreezeAcknowledgement:
    return ObligationFreezeAcknowledgement.model_validate(
        {
            "contractVersion": 2,
            "commandId": command.commandId,
            "disposition": disposition,
            "acknowledgedAt": acknowledged_at,
            "resource": resource,
        }
    )


def _require_role(account: Account, allowed: set[str]) -> None:
    if account.role.value not in allowed:
        raise ObligationError(
            "OBLIGATION_ACCESS_DENIED",
            "The authenticated account cannot perform this reporting-obligation operation.",
        )


def _normalized_optional(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Reporting-obligation timestamps must include a UTC offset.")
    return value.astimezone(UTC)


def _effective_at(start: datetime, end: datetime | None, evaluated_at: datetime) -> bool:
    effective_from = _as_utc(start)
    effective_to = _as_utc(end) if end is not None else None
    return effective_from <= evaluated_at and (effective_to is None or evaluated_at < effective_to)
