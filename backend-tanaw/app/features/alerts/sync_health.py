"""Transactional projection of authoritative sync health into durable alerts."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.alerts.models import OperationalAlert, SiteSyncAlertState
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.reporting.envelopes import canonical_payload_hash
from app.features.telemetry.envelopes import SyncHealth, canonical_payload_json
from app.features.telemetry.sync_health import (
    SYNC_ALERT_OLDEST_AGE_SECONDS,
    SYNC_ALERT_PENDING_COUNT_THRESHOLD,
    SYNC_RECOVERY_OLDEST_AGE_SECONDS,
    SYNC_RECOVERY_PENDING_COUNT_THRESHOLD,
    SyncHealthDecision,
    evaluate_sync_health,
)
from app.features.topology.models import EdgeDevice, Enterprise, EnterpriseSite


async def reconcile_site_sync_alert(
    db: AsyncSession,
    *,
    enterprise: Enterprise,
    site: EnterpriseSite,
    device: EdgeDevice,
    sync: SyncHealth,
    evaluated_at: datetime,
    actor_account_id: str,
    causation_id: str,
) -> None:
    """Open, update, or resolve one site condition without side commits."""

    if site.classification != "official" or sync.evidenceStatus != "recorded":
        return
    state = await db.scalar(
        select(SiteSyncAlertState)
        .where(
            SiteSyncAlertState.site_id == site.id,
            SiteSyncAlertState.classification == site.classification,
        )
        .with_for_update()
    )
    decision = evaluate_sync_health(
        evaluated_at=evaluated_at,
        pending_count=sync.pendingCount,
        oldest_pending_at=sync.oldestPendingAt,
        alert_is_active=state is not None and state.status == "active",
    )
    if decision.state == "unknown":
        return
    if state is None:
        if not decision.opens_alert:
            return
        alert = await _new_operational_alert(
            db,
            enterprise=enterprise,
            site=site,
            decision=decision,
        )
        state = SiteSyncAlertState(
            id=str(uuid4()),
            enterprise_id=enterprise.id,
            site_id=site.id,
            edge_device_id=device.id,
            classification=site.classification,
            operational_alert_id=alert.id,
            status="active",
            logical_version=1,
            pending_count=decision.pending_count or 0,
            oldest_pending_at=sync.oldestPendingAt,
            last_acknowledged_at=sync.lastAcknowledgedAt,
            last_failure_at=sync.lastFailureAt,
            last_failure_class=sync.lastFailureClass,
            pending_count_threshold=SYNC_ALERT_PENDING_COUNT_THRESHOLD,
            oldest_age_threshold_seconds=SYNC_ALERT_OLDEST_AGE_SECONDS,
            recovery_pending_count_threshold=SYNC_RECOVERY_PENDING_COUNT_THRESHOLD,
            recovery_age_threshold_seconds=SYNC_RECOVERY_OLDEST_AGE_SECONDS,
            opened_at=evaluated_at,
            last_evaluated_at=evaluated_at,
            resolved_at=None,
        )
        db.add(state)
        await _record_transition(
            db,
            state=state,
            alert=alert,
            event_type="sync_health.alert_opened",
            decision=decision,
            actor_account_id=actor_account_id,
            causation_id=causation_id,
            occurred_at=evaluated_at,
        )
        return

    evidence_changed = _evidence_changed(
        state,
        device_id=device.id,
        sync=sync,
        decision=decision,
    )
    _apply_evidence(
        state,
        device_id=device.id,
        sync=sync,
        decision=decision,
        evaluated_at=evaluated_at,
    )
    current_alert = await db.get(OperationalAlert, state.operational_alert_id)
    if current_alert is None:
        raise RuntimeError("A sync-health condition references a missing operational alert.")

    if state.status == "resolved":
        if not decision.opens_alert:
            return
        reopened_alert = await _new_operational_alert(
            db,
            enterprise=enterprise,
            site=site,
            decision=decision,
        )
        state.operational_alert_id = reopened_alert.id
        state.status = "active"
        state.logical_version += 1
        state.opened_at = evaluated_at
        state.resolved_at = None
        await _record_transition(
            db,
            state=state,
            alert=reopened_alert,
            event_type="sync_health.alert_opened",
            decision=decision,
            actor_account_id=actor_account_id,
            causation_id=causation_id,
            occurred_at=evaluated_at,
        )
        return

    if decision.resolves_alert:
        state.status = "resolved"
        state.logical_version += 1
        state.resolved_at = evaluated_at
        current_alert.status = "Resolved"
        current_alert.summary = _resolved_summary(site=site, decision=decision)
        await _record_transition(
            db,
            state=state,
            alert=current_alert,
            event_type="sync_health.alert_resolved",
            decision=decision,
            actor_account_id=actor_account_id,
            causation_id=causation_id,
            occurred_at=evaluated_at,
        )
        return

    if evidence_changed:
        state.logical_version += 1
        current_alert.summary = _active_summary(site=site, decision=decision)
        await _record_transition(
            db,
            state=state,
            alert=current_alert,
            event_type="sync_health.alert_updated",
            decision=decision,
            actor_account_id=actor_account_id,
            causation_id=causation_id,
            occurred_at=evaluated_at,
        )


async def _new_operational_alert(
    db: AsyncSession,
    *,
    enterprise: Enterprise,
    site: EnterpriseSite,
    decision: SyncHealthDecision,
) -> OperationalAlert:
    sequence_number = await db.scalar(text("SELECT nextval('operational_alert_code_seq')"))
    if not isinstance(sequence_number, int):
        raise RuntimeError("The operational alert code sequence returned an invalid value.")
    alert = OperationalAlert(
        id=str(uuid4()),
        alert_code=f"ALT-{sequence_number:06d}",
        alert_type="Sync Delay",
        severity="Warning",
        enterprise=enterprise.name,
        requester=enterprise.name,
        summary=_active_summary(site=site, decision=decision),
        required_action="Review the durable report outbox and restore acknowledged cloud sync.",
        resolution_mode="Automatic Health Recovery",
        status="New",
        owner="IT",
        source_id=f"sync-health:{site.id}",
    )
    db.add(alert)
    await db.flush([alert])
    return alert


def _evidence_changed(
    state: SiteSyncAlertState,
    *,
    device_id: str,
    sync: SyncHealth,
    decision: SyncHealthDecision,
) -> bool:
    return (
        state.edge_device_id != device_id
        or state.pending_count != decision.pending_count
        or state.oldest_pending_at != sync.oldestPendingAt
        or state.last_acknowledged_at != sync.lastAcknowledgedAt
        or state.last_failure_at != sync.lastFailureAt
        or state.last_failure_class != sync.lastFailureClass
    )


def _apply_evidence(
    state: SiteSyncAlertState,
    *,
    device_id: str,
    sync: SyncHealth,
    decision: SyncHealthDecision,
    evaluated_at: datetime,
) -> None:
    state.edge_device_id = device_id
    state.pending_count = decision.pending_count or 0
    state.oldest_pending_at = sync.oldestPendingAt
    state.last_acknowledged_at = sync.lastAcknowledgedAt
    state.last_failure_at = sync.lastFailureAt
    state.last_failure_class = sync.lastFailureClass
    state.last_evaluated_at = evaluated_at


async def _record_transition(
    db: AsyncSession,
    *,
    state: SiteSyncAlertState,
    alert: OperationalAlert,
    event_type: str,
    decision: SyncHealthDecision,
    actor_account_id: str,
    causation_id: str,
    occurred_at: datetime,
) -> None:
    payload: dict[str, object] = {
        "conditionStateId": state.id,
        "operationalAlertId": alert.id,
        "siteId": state.site_id,
        "edgeDeviceId": state.edge_device_id,
        "enterpriseId": state.enterprise_id,
        "status": state.status,
        "pendingCount": state.pending_count,
        "oldestPendingAt": state.oldest_pending_at,
        "oldestPendingAgeSeconds": decision.oldest_pending_age_seconds,
        "lastAcknowledgedAt": state.last_acknowledged_at,
        "lastFailureAt": state.last_failure_at,
        "lastFailureClass": state.last_failure_class,
    }
    payload_hash = canonical_payload_hash(payload)
    event = DomainEvent(
        id=str(uuid4()),
        event_key=f"sync-health:{state.site_id}:version:{state.logical_version}",
        event_type=event_type,
        contract_version=2,
        schema_version=1,
        aggregate_type="site_sync_health",
        aggregate_id=state.id,
        aggregate_version=state.logical_version,
        enterprise_id=state.enterprise_id,
        site_id=state.site_id,
        classification=state.classification,
        actor_account_id=actor_account_id,
        correlation_id=None,
        causation_id=causation_id,
        payload_json=canonical_payload_json(payload),
        payload_hash=payload_hash,
        occurred_at=occurred_at,
        available_at=occurred_at,
    )
    db.add(event)
    db.add(
        DomainEventDelivery(
            id=str(uuid4()),
            domain_event_id=event.id,
            destination="realtime_broadcast",
            status="pending",
            attempt_count=0,
            next_attempt_at=occurred_at,
        )
    )


def _active_summary(*, site: EnterpriseSite, decision: SyncHealthDecision) -> str:
    age = decision.oldest_pending_age_seconds
    age_text = f"; oldest item is {age} seconds old" if age is not None else ""
    return f"{site.name} has {decision.pending_count or 0} durable sync item(s) pending{age_text}."


def _resolved_summary(*, site: EnterpriseSite, decision: SyncHealthDecision) -> str:
    return f"{site.name} durable sync recovered with {decision.pending_count or 0} pending item(s)."
