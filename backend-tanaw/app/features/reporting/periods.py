"""Canonical reporting-period discovery and server-time lifecycle operations."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast
from uuid import UUID, uuid5

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.features.accounts.models import Account, AccountRole
from app.features.reporting.contracts import (
    monthly_reporting_period,
    reporting_period_for_timestamp,
)
from app.features.reporting.models import EnterpriseReport, ReportingObligation, ReportingPeriod
from app.features.reporting.obligation_envelopes import ObligationFreezeCommand, ObligationSummary
from app.features.reporting.obligations import freeze_period_obligations
from app.features.reporting.period_envelopes import (
    ReportingPeriodDiscoveryResource,
    ReportingPeriodLifecycleResult,
    ReportingPeriodPage,
    ReportingPeriodStatus,
)
from app.features.reporting.read_cursor import (
    ReadCursorError,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.features.reporting.read_envelopes import CursorPageInfo

_LIFECYCLE_ADVISORY_LOCK = 8_142_026_071_300_027
_LIFECYCLE_NAMESPACE = UUID("4b5020ac-d6f9-4e72-acbf-5a72b2694357")
_HORIZON_MONTHS_BACK = 1
_HORIZON_MONTHS_FORWARD = 2
_OBLIGATION_FREEZE_LEAD = timedelta(days=7)
_STATUS_ORDER = {"scheduled": 0, "open": 1, "closed": 2}


class ReportingPeriodError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class ReportingPeriodForbidden(ReportingPeriodError):
    pass


class ReportingPeriodNotFound(ReportingPeriodError):
    pass


class ReportingPeriodInvalidCursor(ReportingPeriodError):
    pass


async def list_reporting_periods(
    db: AsyncSession,
    *,
    account: Account,
    limit: int,
    cursor: str | None,
    period_status: ReportingPeriodStatus | None = None,
) -> ReportingPeriodPage:
    """Return newest-first official compliance summaries, including empty periods."""

    _require_staff(account)
    if limit < 1 or limit > 100:
        raise ReportingPeriodError(
            "REPORTING_PERIOD_PAGE_LIMIT_INVALID",
            "Reporting-period page limit must be 1 to 100.",
        )
    fingerprint = filter_fingerprint({"classification": "official", "status": period_status})
    statement = _summary_statement().order_by(
        ReportingPeriod.starts_at.desc(), ReportingPeriod.id.desc()
    )
    if period_status is not None:
        statement = statement.where(ReportingPeriod.status == period_status)
    if cursor is not None:
        cursor_at, cursor_id = _decode_period_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            or_(
                ReportingPeriod.starts_at < cursor_at,
                and_(
                    ReportingPeriod.starts_at == cursor_at,
                    ReportingPeriod.id < cursor_id,
                ),
            )
        )
    rows = list((await db.execute(statement.limit(limit + 1))).all())
    page_rows = rows[:limit]
    items = [_resource_from_row(row) for row in page_rows]
    has_more = len(rows) > limit
    next_cursor = (
        encode_cursor(
            occurred_at=cast(ReportingPeriod, page_rows[-1][0]).starts_at,
            resource_id=cast(ReportingPeriod, page_rows[-1][0]).id,
            fingerprint=fingerprint,
        )
        if has_more and page_rows
        else None
    )
    return ReportingPeriodPage(
        items=items,
        page=CursorPageInfo(
            limit=limit,
            returnedCount=len(items),
            hasMore=has_more,
            nextCursor=next_cursor,
        ),
    )


async def read_reporting_period(
    db: AsyncSession,
    *,
    account: Account,
    reporting_period_id: UUID,
) -> ReportingPeriodDiscoveryResource:
    """Return one period even when it has no obligations or submissions."""

    _require_staff(account)
    row = (
        await db.execute(_summary_statement().where(ReportingPeriod.id == str(reporting_period_id)))
    ).one_or_none()
    if row is None:
        raise ReportingPeriodNotFound(
            "REPORTING_PERIOD_NOT_FOUND",
            "The reporting period does not exist.",
        )
    return _resource_from_row(row)


async def run_reporting_period_lifecycle(
    db: AsyncSession,
    *,
    account: Account,
    now: datetime | None = None,
) -> ReportingPeriodLifecycleResult:
    """Ensure the fixed horizon and freeze periods at the seven-day lead exactly once."""

    _require_staff(account)
    observed_at = _as_utc(now or datetime.now(UTC))
    if db.get_bind().dialect.name != "postgresql":
        raise ReportingPeriodError(
            "REPORTING_PERIOD_LIFECYCLE_STORAGE_UNSUPPORTED",
            "Reporting-period lifecycle requires the PostgreSQL canonical-period guards.",
        )
    # One transaction-scoped lock makes concurrent Staff/maintenance invocations
    # converge without exposing partially advanced horizons.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:lock_key)"),
        {"lock_key": _LIFECYCLE_ADVISORY_LOCK},
    )

    created_count = 0
    transitioned_count = 0
    frozen_count = 0
    periods: list[ReportingPeriod] = []
    for year, month in _horizon_months(observed_at):
        canonical = monthly_reporting_period(year, month)
        target_status = _status_at(
            observed_at,
            opens_at=canonical.submission_opens_at,
            closes_at=canonical.submission_closes_at,
        )
        inserted_id = await db.scalar(
            postgresql_insert(ReportingPeriod)
            .values(
                id=str(uuid5(_LIFECYCLE_NAMESPACE, canonical.natural_key)),
                natural_key=canonical.natural_key,
                cadence=canonical.cadence,
                timezone_name=canonical.timezone,
                local_start_date=canonical.local_start_date,
                local_end_date=canonical.local_end_date,
                starts_at=canonical.starts_at,
                ends_at=canonical.ends_at,
                submission_opens_at=canonical.submission_opens_at,
                submission_closes_at=canonical.submission_closes_at,
                status=target_status,
                label=canonical.label,
            )
            .on_conflict_do_nothing(index_elements=[ReportingPeriod.natural_key])
            .returning(ReportingPeriod.id)
        )
        if inserted_id is not None:
            created_count += 1
        period = await db.scalar(
            select(ReportingPeriod)
            .where(ReportingPeriod.natural_key == canonical.natural_key)
            .with_for_update()
        )
        if period is None:  # pragma: no cover - insert/select share one transaction.
            raise RuntimeError("Canonical reporting-period upsert did not produce a row.")
        if _STATUS_ORDER[target_status] > _STATUS_ORDER[period.status]:
            period.status = target_status
            transitioned_count += 1
            await db.flush([period])
        if (
            period.starts_at - _OBLIGATION_FREEZE_LEAD <= observed_at
            and period.obligations_frozen_at is None
        ):
            acknowledgement = await freeze_period_obligations(
                db,
                account=account,
                reporting_period_id=UUID(period.id),
                command=ObligationFreezeCommand.model_validate(
                    {
                        "contractVersion": 2,
                        "commandId": str(
                            uuid5(_LIFECYCLE_NAMESPACE, f"freeze:{period.natural_key}:official")
                        ),
                    }
                ),
                frozen_at=observed_at,
            )
            if acknowledgement.disposition == "created":
                frozen_count += 1
        periods.append(period)

    await db.flush()
    rows = list(
        (
            await db.execute(
                _summary_statement()
                .where(ReportingPeriod.id.in_([period.id for period in periods]))
                .order_by(ReportingPeriod.starts_at, ReportingPeriod.id)
            )
        ).all()
    )
    return ReportingPeriodLifecycleResult(
        contractVersion=2,
        evaluatedAt=observed_at,
        ensuredPeriodCount=len(rows),
        createdCount=created_count,
        transitionedCount=transitioned_count,
        frozenCount=frozen_count,
        periods=[_resource_from_row(row) for row in rows],
    )


def _summary_statement() -> Select[tuple[Any, ...]]:
    eligible = func.count(ReportingObligation.id).filter(
        ReportingObligation.eligibility_status == "eligible"
    )
    unresolved = func.count(ReportingObligation.id).filter(
        ReportingObligation.eligibility_status == "unknown"
    )
    return (
        select(
            ReportingPeriod,
            func.count(ReportingObligation.id).label("total_frozen"),
            eligible.label("eligible_expected"),
            func.count(ReportingObligation.id)
            .filter(ReportingObligation.eligibility_status == "exempt")
            .label("exempt"),
            func.count(ReportingObligation.id)
            .filter(ReportingObligation.eligibility_status == "ineligible")
            .label("ineligible"),
            unresolved.label("unresolved"),
            func.count(ReportingObligation.id)
            .filter(
                ReportingObligation.eligibility_status == "eligible",
                EnterpriseReport.id.is_(None),
            )
            .label("not_submitted"),
            func.count(ReportingObligation.id)
            .filter(EnterpriseReport.workflow_state == "submitted")
            .label("submitted"),
            func.count(ReportingObligation.id)
            .filter(EnterpriseReport.workflow_state == "returned")
            .label("returned"),
            func.count(ReportingObligation.id)
            .filter(EnterpriseReport.workflow_state == "accepted")
            .label("accepted"),
            func.count(ReportingObligation.id)
            .filter(EnterpriseReport.workflow_state == "consolidated")
            .label("consolidated"),
        )
        .outerjoin(
            ReportingObligation,
            and_(
                ReportingObligation.reporting_period_id == ReportingPeriod.id,
                ReportingObligation.classification == "official",
            ),
        )
        .outerjoin(
            EnterpriseReport,
            and_(
                EnterpriseReport.reporting_obligation_id == ReportingObligation.id,
                EnterpriseReport.classification == "official",
            ),
        )
        .group_by(ReportingPeriod.id)
    )


def _resource_from_row(row: Any) -> ReportingPeriodDiscoveryResource:
    period = cast(ReportingPeriod, row[0])
    eligible = int(row.eligible_expected)
    unresolved = int(row.unresolved)
    complete_count = int(row.accepted) + int(row.consolidated)
    summary = ObligationSummary(
        totalFrozen=int(row.total_frozen),
        eligibleExpected=eligible,
        exempt=int(row.exempt),
        ineligible=int(row.ineligible),
        unresolved=unresolved,
        notSubmitted=int(row.not_submitted),
        submitted=int(row.submitted),
        returned=int(row.returned),
        accepted=int(row.accepted),
        consolidated=int(row.consolidated),
        complete=(
            period.obligations_frozen_at is not None
            and unresolved == 0
            and complete_count == eligible
        ),
    )
    return ReportingPeriodDiscoveryResource(
        contractVersion=2,
        complianceClassification="official",
        reportingPeriodId=UUID(period.id),
        naturalKey=period.natural_key,
        label=period.label,
        cadence="month",
        timezone="Asia/Manila",
        localStartDate=period.local_start_date,
        localEndDate=period.local_end_date,
        startsAt=period.starts_at,
        endsAt=period.ends_at,
        submissionOpensAt=period.submission_opens_at,
        submissionClosesAt=period.submission_closes_at,
        status=cast(ReportingPeriodStatus, period.status),
        obligationsFrozenAt=period.obligations_frozen_at,
        compliance=summary,
    )


def _horizon_months(now: datetime) -> list[tuple[int, int]]:
    # Classify the instant through the reporting contract instead of relying on
    # the process or database session timezone.
    current = reporting_period_for_timestamp(now)
    current_ordinal = current.local_start_date.year * 12 + current.local_start_date.month - 1
    values: list[tuple[int, int]] = []
    for offset in range(-_HORIZON_MONTHS_BACK, _HORIZON_MONTHS_FORWARD + 1):
        year, zero_based_month = divmod(current_ordinal + offset, 12)
        values.append((year, zero_based_month + 1))
    return values


def _status_at(
    now: datetime,
    *,
    opens_at: datetime,
    closes_at: datetime,
) -> Literal["scheduled", "open", "closed"]:
    if now < opens_at:
        return "scheduled"
    if now < closes_at:
        return "open"
    return "closed"


def _decode_period_cursor(cursor: str, *, fingerprint: str) -> tuple[datetime, str]:
    try:
        return decode_cursor(cursor, fingerprint=fingerprint)
    except ReadCursorError as exc:
        raise ReportingPeriodInvalidCursor(
            "REPORTING_PERIOD_CURSOR_INVALID",
            str(exc),
        ) from exc


def _require_staff(account: Account) -> None:
    if account.role != AccountRole.STAFF:
        raise ReportingPeriodForbidden(
            "REPORTING_PERIOD_ACCESS_DENIED",
            "Only an authenticated Staff account may discover reporting periods.",
        )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Reporting-period lifecycle timestamps must include a UTC offset.")
    return value.astimezone(UTC)
