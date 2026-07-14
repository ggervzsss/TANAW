"""Transactional user-notification projection for official reporting events."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.events.contracts import (
    DeliveryResult,
    DomainEventDeliveryError,
    DomainEventEnvelope,
    JSONValue,
)
from app.features.final_reports.models import FinalReportVersion, ReportFinalization
from app.features.notifications.models import UserNotification
from app.features.reporting.models import (
    EnterpriseReport,
    ReportingObligation,
    ReportingPeriod,
    ReportRevision,
)
from app.features.topology.models import Enterprise, EnterpriseMembership

_REPORT_SUBMITTED = "enterprise_report.revision_submitted"
_REPORT_RETURNED = "enterprise_report.returned"
_REPORT_ACCEPTED = "enterprise_report.accepted"
_REPORT_REOPENED = "enterprise_report.reopened"
_FINAL_REPORT_FINALIZED = "final_report.version_finalized"
_OBLIGATION_REMINDER = "reporting_obligation.reminder_requested"

_NOTIFICATION_EVENT_TYPES = {
    _REPORT_SUBMITTED,
    _REPORT_RETURNED,
    _REPORT_ACCEPTED,
    _REPORT_REOPENED,
    _FINAL_REPORT_FINALIZED,
    _OBLIGATION_REMINDER,
}


@dataclass(frozen=True, slots=True)
class _NotificationContent:
    title: str
    message: str
    notification_type: str
    severity: Literal["Info", "Warning", "Critical", "Success"]
    source_type: str
    target_path: str
    recipient_kind: Literal["staff", "enterprise"]


@dataclass(frozen=True, slots=True)
class _ReportSource:
    reporting_period_id: str
    period_label: str


@dataclass(frozen=True, slots=True)
class _FinalReportSource:
    reporting_period_id: str
    finalization_id: str
    report_code: str


@dataclass(frozen=True, slots=True)
class _ReminderSource:
    reporting_period_id: str
    period_label: str


class ReportingNotificationProjection:
    """Creates bounded notification rows in the delivery receipt transaction."""

    consumer_name = "notification_projection"

    async def apply(
        self,
        *,
        db: AsyncSession,
        event: DomainEventEnvelope,
    ) -> DeliveryResult:
        if event.event_type not in _NOTIFICATION_EVENT_TYPES:
            return DeliveryResult(disposition="ignored")
        if event.classification != "official":
            return DeliveryResult(disposition="ignored")

        content = await _notification_content(db, event)
        if content is None:
            return DeliveryResult(disposition="ignored")
        recipients = await _recipients(db, event=event, recipient_kind=content.recipient_kind)
        actor = await db.get(Account, event.actor_account_id) if event.actor_account_id else None
        created = 0
        for recipient in recipients:
            notification_id = _notification_id(event.id, recipient.id)
            if await db.get(UserNotification, notification_id) is not None:
                continue
            db.add(
                UserNotification(
                    id=notification_id,
                    recipient_account_id=recipient.id,
                    recipient_role=recipient.role.value,
                    recipient_enterprise_id=(
                        event.enterprise_id if recipient.role == AccountRole.ENTERPRISE else None
                    ),
                    title=content.title,
                    message=content.message,
                    notification_type=content.notification_type,
                    severity=content.severity,
                    source_type=content.source_type,
                    # Existing notifications have one bounded source locator. For v2
                    # projection rows it is an exact, period-scoped application path.
                    source_id=content.target_path,
                    created_by_account_id=actor.id if actor else None,
                    created_by_name=actor.display_name if actor else None,
                    created_at=event.occurred_at,
                )
            )
            created += 1
        await db.flush()
        return DeliveryResult(
            disposition="applied",
            result_reference=f"notifications:{created}",
        )


async def _notification_content(
    db: AsyncSession,
    event: DomainEventEnvelope,
) -> _NotificationContent | None:
    if event.event_type == _REPORT_SUBMITTED:
        period_id = _required_string(event.payload, "reportingPeriodId")
        report_id = _required_string(event.payload, "enterpriseReportId")
        revision_id = _required_string(event.payload, "reportRevisionId")
        report_source = await _validated_report_source(
            db,
            event=event,
            report_id=report_id,
            revision_id=revision_id,
            expected_period_id=period_id,
        )
        return _NotificationContent(
            title="Enterprise report submitted",
            message=(
                f"A report revision for {report_source.period_label} was submitted for Staff review."
            ),
            notification_type="Enterprise Report Submitted",
            severity="Info",
            source_type="enterprise.report",
            target_path=_staff_report_path(report_source.reporting_period_id, report_id),
            recipient_kind="staff",
        )

    if event.event_type in {_REPORT_RETURNED, _REPORT_ACCEPTED, _REPORT_REOPENED}:
        report_id = _required_string(event.payload, "enterpriseReportId")
        revision_id = _required_string(event.payload, "reportRevisionId")
        report_source = await _validated_report_source(
            db,
            event=event,
            report_id=report_id,
            revision_id=revision_id,
            expected_period_id=None,
        )
        if event.event_type == _REPORT_RETURNED:
            title = "Enterprise report returned"
            message = "Staff returned this report for correction. Review the reason and resubmit."
            notification_type = "Enterprise Report Returned"
            severity: Literal["Info", "Warning", "Critical", "Success"] = "Warning"
        elif event.event_type == _REPORT_ACCEPTED:
            title = "Enterprise report accepted"
            message = "Staff accepted this reporting-period revision."
            notification_type = "Enterprise Report Accepted"
            severity = "Success"
        else:
            title = "Enterprise report reopened"
            message = "Staff reopened this reporting-period report before finalization."
            notification_type = "Enterprise Report Reopened"
            severity = "Warning"
        return _NotificationContent(
            title=title,
            message=message,
            notification_type=notification_type,
            severity=severity,
            source_type="enterprise.report",
            target_path=_enterprise_report_path(report_source.reporting_period_id, report_id),
            recipient_kind="enterprise",
        )

    if event.event_type == _FINAL_REPORT_FINALIZED:
        period_id = _required_string(event.payload, "reportingPeriodId")
        finalization_id = _required_string(event.payload, "reportFinalizationId")
        version_id = _required_string(event.payload, "finalReportVersionId")
        final_source = await _validated_final_report_source(
            db,
            event=event,
            finalization_id=finalization_id,
            version_id=version_id,
            expected_period_id=period_id,
        )
        return _NotificationContent(
            title="Final report version created",
            message=(
                f"{final_source.report_code} was recorded and its artifact generation was queued."
            ),
            notification_type="Final Report Finalized",
            severity="Success",
            source_type="final.report",
            target_path=(
                "/staff/final-reports-audit"
                f"?periodId={final_source.reporting_period_id}"
                f"&finalId={final_source.finalization_id}"
            ),
            recipient_kind="staff",
        )

    if event.event_type == _OBLIGATION_REMINDER:
        period_id = _required_string(event.payload, "reportingPeriodId")
        phase = _required_string(event.payload, "phase")
        target_path = _required_string(event.payload, "targetPath")
        reminder_source = await _validated_reminder_source(
            db,
            event=event,
            expected_period_id=period_id,
        )
        expected_path = f"/enterprise/reports?periodId={reminder_source.reporting_period_id}"
        if target_path != expected_path:
            raise _source_scope_error("The reminder target does not match its reporting period.")
        phase_details: dict[str, tuple[str, Literal["Info", "Warning"]]] = {
            "pre_window": ("pre-window", "Info"),
            "current_period": ("current-period", "Info"),
            "overdue": ("overdue", "Warning"),
        }
        phase_detail = phase_details.get(phase)
        if phase_detail is None:
            raise DomainEventDeliveryError(
                "A reporting reminder has an unsupported phase.",
                error_code="notification_payload_invalid",
                retryable=False,
            )
        phase_label, severity = phase_detail
        return _NotificationContent(
            title=f"{reminder_source.period_label} report reminder",
            message=f"The {phase_label} reporting reminder is ready for action.",
            notification_type="Reporting Obligation Reminder",
            severity=severity,
            source_type="reporting.obligation",
            target_path=target_path,
            recipient_kind="enterprise",
        )
    return None


async def _recipients(
    db: AsyncSession,
    *,
    event: DomainEventEnvelope,
    recipient_kind: Literal["staff", "enterprise"],
) -> list[Account]:
    active_account = and_(
        Account.status == AccountStatus.ACTIVE,
        Account.activated_at.is_not(None),
    )
    if recipient_kind == "staff":
        statement = select(Account).where(active_account, Account.role == AccountRole.STAFF)
        return list(await db.scalars(statement.order_by(Account.id)))

    if event.enterprise_id is None:
        return []
    now = datetime.now(UTC)
    statement = (
        select(Account)
        .join(EnterpriseMembership, EnterpriseMembership.account_id == Account.id)
        .join(Enterprise, Enterprise.id == EnterpriseMembership.enterprise_id)
        .where(
            active_account,
            Account.role == AccountRole.ENTERPRISE,
            EnterpriseMembership.enterprise_id == event.enterprise_id,
            EnterpriseMembership.classification == event.classification,
            EnterpriseMembership.started_at <= now,
            or_(EnterpriseMembership.ended_at.is_(None), EnterpriseMembership.ended_at > now),
            Enterprise.classification == event.classification,
            Enterprise.lifecycle_state == "active",
        )
        .order_by(Account.id)
    )
    return list(await db.scalars(statement))


async def _validated_report_source(
    db: AsyncSession,
    *,
    event: DomainEventEnvelope,
    report_id: str,
    revision_id: str,
    expected_period_id: str | None,
) -> _ReportSource:
    row = (
        await db.execute(
            select(EnterpriseReport, ReportRevision, ReportingObligation, ReportingPeriod)
            .join(
                ReportRevision,
                and_(
                    ReportRevision.id == revision_id,
                    ReportRevision.enterprise_report_id == EnterpriseReport.id,
                ),
            )
            .join(
                ReportingObligation,
                ReportingObligation.id == EnterpriseReport.reporting_obligation_id,
            )
            .join(
                ReportingPeriod,
                ReportingPeriod.id == ReportingObligation.reporting_period_id,
            )
            .where(EnterpriseReport.id == report_id)
        )
    ).one_or_none()
    if row is None:
        raise _source_scope_error("A report workflow event references missing report facts.")
    report, revision, obligation, period = row
    logical_version = _required_positive_int(event.payload, "logicalVersion")
    if (
        event.aggregate_type != "enterprise_report"
        or event.aggregate_id != report.id
        or event.enterprise_id != report.enterprise_id
        or event.site_id != report.site_id
        or event.classification != "official"
        or report.classification != event.classification
        or revision.enterprise_id != event.enterprise_id
        or revision.site_id != event.site_id
        or revision.classification != event.classification
        or obligation.enterprise_id != event.enterprise_id
        or obligation.site_id != event.site_id
        or obligation.classification != event.classification
        or event.aggregate_version != logical_version
        or report.logical_version < logical_version
        or (expected_period_id is not None and period.id != expected_period_id)
    ):
        raise _source_scope_error("A report workflow event does not match its official source.")
    return _ReportSource(reporting_period_id=period.id, period_label=period.label)


async def _validated_final_report_source(
    db: AsyncSession,
    *,
    event: DomainEventEnvelope,
    finalization_id: str,
    version_id: str,
    expected_period_id: str,
) -> _FinalReportSource:
    row = (
        await db.execute(
            select(ReportFinalization, FinalReportVersion)
            .join(
                FinalReportVersion,
                and_(
                    FinalReportVersion.id == version_id,
                    FinalReportVersion.report_finalization_id == ReportFinalization.id,
                ),
            )
            .where(ReportFinalization.id == finalization_id)
        )
    ).one_or_none()
    if row is None:
        raise _source_scope_error("A final-report event references missing final-report facts.")
    finalization, version = row
    version_number = _required_positive_int(event.payload, "versionNumber")
    report_code = _required_string(event.payload, "reportCode")
    if (
        event.aggregate_type != "report_finalization"
        or event.aggregate_id != finalization.id
        or event.enterprise_id is not None
        or event.site_id is not None
        or event.classification != "official"
        or finalization.classification != event.classification
        or version.classification != event.classification
        or finalization.reporting_period_id != expected_period_id
        or finalization.report_code != report_code
        or version.version_number != version_number
        or event.aggregate_version != version_number
        or finalization.logical_version < version_number
    ):
        raise _source_scope_error("A final-report event does not match its official source.")
    return _FinalReportSource(
        reporting_period_id=finalization.reporting_period_id,
        finalization_id=finalization.id,
        report_code=finalization.report_code,
    )


async def _validated_reminder_source(
    db: AsyncSession,
    *,
    event: DomainEventEnvelope,
    expected_period_id: str,
) -> _ReminderSource:
    row = (
        await db.execute(
            select(ReportingObligation, ReportingPeriod)
            .join(
                ReportingPeriod,
                ReportingPeriod.id == ReportingObligation.reporting_period_id,
            )
            .where(ReportingObligation.id == event.aggregate_id)
        )
    ).one_or_none()
    if row is None:
        raise _source_scope_error("A reminder event references a missing reporting obligation.")
    obligation, period = row
    obligation_id = _required_string(event.payload, "obligationId")
    enterprise_id = _required_string(event.payload, "enterpriseId")
    site_id = _required_string(event.payload, "siteId")
    period_key = _required_string(event.payload, "periodKey")
    period_label = _required_string(event.payload, "periodLabel")
    if (
        event.aggregate_type != "reporting_obligation"
        or obligation_id != obligation.id
        or event.enterprise_id != obligation.enterprise_id
        or enterprise_id != obligation.enterprise_id
        or event.site_id != obligation.site_id
        or site_id != obligation.site_id
        or event.classification != "official"
        or obligation.classification != event.classification
        or period.id != expected_period_id
        or period.natural_key != period_key
        or period.label != period_label
    ):
        raise _source_scope_error("A reminder event does not match its official obligation.")
    return _ReminderSource(reporting_period_id=period.id, period_label=period.label)


def _staff_report_path(period_id: str, report_id: str) -> str:
    return f"/staff/batch-reports?periodId={period_id}&reportId={report_id}"


def _enterprise_report_path(period_id: str, report_id: str) -> str:
    return f"/enterprise/reports?periodId={period_id}&reportId={report_id}"


def _notification_id(event_id: str, recipient_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"tanaw:notification:{event_id}:{recipient_id}"))


def _required_string(payload: Mapping[str, JSONValue], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise DomainEventDeliveryError(
            f"Domain event payload is missing {key}.",
            error_code="notification_payload_invalid",
            retryable=False,
        )
    return value.strip()


def _required_positive_int(payload: Mapping[str, JSONValue], key: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise DomainEventDeliveryError(
            f"Domain event payload is missing {key}.",
            error_code="notification_payload_invalid",
            retryable=False,
        )
    return value


def _source_scope_error(message: str) -> DomainEventDeliveryError:
    return DomainEventDeliveryError(
        message,
        error_code="notification_source_scope_invalid",
        retryable=False,
    )
