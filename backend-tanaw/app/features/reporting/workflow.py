from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.reporting.envelopes import canonical_payload_hash
from app.features.reporting.models import EnterpriseReport, ReportReviewEvent, ReportRevision
from app.features.reporting.service import ReportIntakeConflict, ReportIntakeError
from app.features.reporting.workflow_envelopes import (
    ReportTransitionAcknowledgement,
    ReportTransitionCommand,
    ReportTransitionResource,
)

_TRANSITIONS = {
    "return_for_correction": ("submitted", "returned", "returned"),
    "accept_revision": ("submitted", "accepted", "accepted"),
    "reopen_before_finalization": ("accepted", "returned", "reopened"),
}


async def transition_report(
    db: AsyncSession,
    *,
    account: Account,
    enterprise_report_id: UUID,
    command: ReportTransitionCommand,
    acknowledged_at: datetime | None = None,
) -> ReportTransitionAcknowledgement:
    changed_at = _as_utc(acknowledged_at or datetime.now(UTC))
    report_id = str(enterprise_report_id)

    replay = await _resolve_transition_replay(
        db,
        account=account,
        enterprise_report_id=report_id,
        command=command,
    )
    if replay is not None:
        return replay

    report = await db.scalar(
        select(EnterpriseReport).where(EnterpriseReport.id == report_id).with_for_update()
    )
    if report is None:
        raise ReportIntakeError("REPORT_NOT_FOUND", "The enterprise report does not exist.")

    # The command may have committed while this transaction waited for the row lock.
    replay = await _resolve_transition_replay(
        db,
        account=account,
        enterprise_report_id=report_id,
        command=command,
    )
    if replay is not None:
        return replay

    if command.expectedVersion != report.logical_version:
        raise ReportIntakeConflict(
            "REPORT_VERSION_CONFLICT",
            f"Expected logical version {command.expectedVersion}; current version is "
            f"{report.logical_version} in state {report.workflow_state}.",
        )

    required_state, target_state, event_type = _TRANSITIONS[command.action]
    if report.workflow_state != required_state:
        raise ReportIntakeConflict(
            "REPORT_STATE_CONFLICT",
            f"{command.action} requires state {required_state}; current state is "
            f"{report.workflow_state}.",
        )
    revision = await db.get(ReportRevision, report.current_revision_id)
    if revision is None:
        raise RuntimeError("The logical report references a missing current revision.")
    if command.action == "accept_revision" and (
        report.acceptance_blocked or revision.acceptance_blocked
    ):
        raise ReportIntakeConflict(
            "REPORT_ACCEPTANCE_BLOCKED",
            "The current revision has incomplete or quarantined evidence and cannot be accepted.",
        )

    previous_state = report.workflow_state
    resulting_version = report.logical_version + 1
    report.workflow_state = target_state
    report.logical_version = resulting_version
    report.accepted_revision_id = revision.id if target_state == "accepted" else None

    review_event = ReportReviewEvent(
        id=str(uuid4()),
        enterprise_report_id=report.id,
        report_revision_id=revision.id,
        enterprise_id=report.enterprise_id,
        classification=report.classification,
        event_type=event_type,
        from_state=previous_state,
        to_state=target_state,
        actor_account_id=account.id,
        actor_role=account.role.value,
        reason=command.reason,
        command_id=str(command.commandId),
        expected_version=command.expectedVersion,
        resulting_version=resulting_version,
        occurred_at=changed_at,
    )
    db.add(review_event)
    domain_event = _transition_domain_event(
        report=report,
        revision=revision,
        command=command,
        event_type=event_type,
        previous_state=previous_state,
        target_state=target_state,
        actor_account_id=account.id,
        changed_at=changed_at,
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
                next_attempt_at=changed_at,
            )
            for destination in ("notification_projection", "realtime_broadcast")
        ]
    )
    await db.flush()
    return _acknowledgement(
        command_id=command.commandId,
        disposition="applied",
        acknowledged_at=changed_at,
        report=report,
        revision=revision,
        workflow_state=target_state,
        logical_version=resulting_version,
    )


async def _resolve_transition_replay(
    db: AsyncSession,
    *,
    account: Account,
    enterprise_report_id: str,
    command: ReportTransitionCommand,
) -> ReportTransitionAcknowledgement | None:
    event = await db.scalar(
        select(ReportReviewEvent).where(ReportReviewEvent.command_id == str(command.commandId))
    )
    if event is None:
        return None
    expected_event_type = _TRANSITIONS[command.action][2]
    if (
        event.enterprise_report_id != enterprise_report_id
        or event.actor_account_id != account.id
        or event.event_type != expected_event_type
        or event.expected_version != command.expectedVersion
        or event.reason != command.reason
    ):
        raise ReportIntakeConflict(
            "REPORT_TRANSITION_IDEMPOTENCY_CONFLICT",
            "The transition command ID was already used with different command details.",
        )
    report = await db.get(EnterpriseReport, event.enterprise_report_id)
    revision = await db.get(ReportRevision, event.report_revision_id)
    if report is None or revision is None:
        raise RuntimeError("A durable review event references missing report records.")
    return _acknowledgement(
        command_id=command.commandId,
        disposition="replayed",
        acknowledged_at=_as_utc(event.occurred_at),
        report=report,
        revision=revision,
        workflow_state=event.to_state,
        logical_version=event.resulting_version,
    )


def _transition_domain_event(
    *,
    report: EnterpriseReport,
    revision: ReportRevision,
    command: ReportTransitionCommand,
    event_type: str,
    previous_state: str,
    target_state: str,
    actor_account_id: str,
    changed_at: datetime,
) -> DomainEvent:
    domain_event_type = f"enterprise_report.{event_type}"
    payload = {
        "contractVersion": 2,
        "eventType": domain_event_type,
        "enterpriseReportId": report.id,
        "reportRevisionId": revision.id,
        "previousState": previous_state,
        "workflowState": target_state,
        "logicalVersion": report.logical_version,
        "reason": command.reason,
    }
    payload_json = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return DomainEvent(
        id=str(uuid4()),
        event_key=f"report-transition:{command.commandId}",
        event_type=domain_event_type,
        contract_version=2,
        schema_version=1,
        aggregate_type="enterprise_report",
        aggregate_id=report.id,
        aggregate_version=report.logical_version,
        enterprise_id=report.enterprise_id,
        site_id=report.site_id,
        classification=report.classification,
        actor_account_id=actor_account_id,
        correlation_id=str(command.commandId),
        causation_id=str(command.commandId),
        payload_json=payload_json,
        payload_hash=canonical_payload_hash(payload),
        occurred_at=changed_at,
        available_at=changed_at,
        retention_expires_at=None,
    )


def _acknowledgement(
    *,
    command_id: UUID,
    disposition: str,
    acknowledged_at: datetime,
    report: EnterpriseReport,
    revision: ReportRevision,
    workflow_state: str,
    logical_version: int,
) -> ReportTransitionAcknowledgement:
    return ReportTransitionAcknowledgement.model_validate(
        {
            "contractVersion": 2,
            "commandId": command_id,
            "disposition": disposition,
            "acknowledgedAt": acknowledged_at,
            "resource": ReportTransitionResource.model_validate(
                {
                    "enterpriseReportId": report.id,
                    "reportRevisionId": revision.id,
                    "workflowState": workflow_state,
                    "logicalVersion": logical_version,
                }
            ),
        }
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Report workflow timestamps must include a UTC offset.")
    return value.astimezone(UTC)
