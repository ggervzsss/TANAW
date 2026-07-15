from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, event, insert, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.base import (
    Account,
    AccountRole,
    AccountStatus,
    Base,
    Enterprise,
    EnterpriseReport,
    EnterpriseSite,
    ReportingObligation,
    ReportingPeriod,
    ReportIntakeReceipt,
    ReportMetricFact,
    ReportRevision,
)


@pytest.fixture
def sqlite_engine() -> Engine:
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection: Any, _connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    return engine


def test_reporting_schema_uses_native_postgres_uuids_and_creates_on_sqlite(
    sqlite_engine: Engine,
) -> None:
    assert ReportingPeriod.__table__.c.id.type.compile(dialect=postgresql.dialect()) == "UUID"
    assert (
        ReportRevision.__table__.c.enterprise_report_id.type.compile(dialect=postgresql.dialect())
        == "UUID"
    )
    assert (
        ReportRevision.__table__.c.submitted_by_account_id.type.compile(
            dialect=postgresql.dialect()
        )
        == "UUID"
    )
    assert {
        "reporting_periods",
        "reporting_obligations",
        "enterprise_reports",
        "report_revisions",
        "report_metric_facts",
        "report_demographic_facts",
        "report_source_batches",
        "report_review_events",
        "report_intake_receipts",
    }.issubset(Base.metadata.tables)
    assert "report_migration_exceptions" not in Base.metadata.tables


def test_period_bounds_and_natural_key_are_constrained(sqlite_engine: Engine) -> None:
    period = _period("month:Asia/Manila:2026-06")
    with Session(sqlite_engine) as session:
        session.add(period)
        session.commit()

        session.add(_period("month:Asia/Manila:2026-06"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        invalid = _period("month:Asia/Manila:2026-07")
        invalid.ends_at = invalid.starts_at
        session.add(invalid)
        with pytest.raises(IntegrityError):
            session.commit()


def test_obligation_rejects_cross_classification_site(sqlite_engine: Engine) -> None:
    enterprise_id, site_id, _account_id = _topology(sqlite_engine)
    period_id = _insert_period(sqlite_engine)
    with Session(sqlite_engine) as session:
        session.add(
            ReportingObligation(
                reporting_period_id=period_id,
                enterprise_id=enterprise_id,
                site_id=site_id,
                classification="simulation",
                eligibility_status="eligible",
                eligibility_basis="registry_snapshot",
                enterprise_official_code="ENT-CROSS-SCOPE",
                enterprise_name="Cross-scope enterprise",
                site_code="PRIMARY",
                site_name="Primary site",
                timezone_name="Asia/Manila",
                acceptance_blocked=False,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_logical_report_and_revision_can_commit_with_deferred_exact_pointer(
    sqlite_engine: Engine,
) -> None:
    graph = _insert_report_graph(sqlite_engine)

    with Session(sqlite_engine) as session:
        report = session.get(EnterpriseReport, graph["report_id"])
        revision = session.get(ReportRevision, graph["revision_id"])
        assert report is not None
        assert revision is not None
        assert report.current_revision_id == revision.id
        assert revision.enterprise_report_id == report.id


def test_metric_quality_and_receipt_contract_are_database_enforced(
    sqlite_engine: Engine,
) -> None:
    graph = _insert_report_graph(sqlite_engine)
    period = graph["period"]
    with Session(sqlite_engine) as session:
        session.add(
            ReportMetricFact(
                report_revision_id=graph["revision_id"],
                classification="official",
                definition="visitor_entries",
                definition_version=1,
                value=Decimal("10"),
                unit="crossings",
                grain="enterprise",
                window_start=period.starts_at,
                window_end=period.ends_at,
                timezone_name="Asia/Manila",
                provenance="camera_derived",
                quality="unknown",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(
            ReportIntakeReceipt(
                enterprise_report_id=graph["report_id"],
                report_revision_id=graph["revision_id"],
                enterprise_id=graph["enterprise_id"],
                classification="official",
                receipt_kind="command",
                contract_version=None,
                command_id=None,
                idempotency_key="report:install:revision",
                payload_hash=f"sha256:{'a' * 64}",
                occurred_at=period.ends_at,
                acknowledged_at=period.ends_at,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_accepted_state_requires_current_revision_to_be_the_accepted_revision(
    sqlite_engine: Engine,
) -> None:
    graph = _insert_report_graph(sqlite_engine)
    second_revision_id = str(uuid4())
    period = graph["period"]
    now = datetime(2026, 7, 2, tzinfo=UTC)

    with pytest.raises(IntegrityError), sqlite_engine.begin() as connection:
        connection.execute(
            insert(ReportRevision),
            {
                "id": second_revision_id,
                "enterprise_report_id": graph["report_id"],
                "enterprise_id": graph["enterprise_id"],
                "site_id": graph["site_id"],
                "classification": "official",
                "revision_number": 2,
                "local_revision_id": "local-2",
                "idempotency_key": "report:install:local-2",
                "source_window_start": period.starts_at,
                "source_window_end": period.ends_at,
                "submitted_by_account_id": graph["account_id"],
                "submitted_at": now,
                "received_at": now,
                "payload_hash": f"sha256:{'c' * 64}",
                "evidence_status": "complete",
                "acceptance_blocked": False,
            },
        )
        connection.execute(
            update(EnterpriseReport)
            .where(EnterpriseReport.id == graph["report_id"])
            .values(
                workflow_state="accepted",
                accepted_revision_id=second_revision_id,
            )
        )


def _topology(engine: Engine) -> tuple[str, str, str]:
    account_id = str(uuid4())
    with Session(engine, expire_on_commit=False) as session:
        session.add(
            Account(
                id=account_id,
                email=f"{account_id}@reporting.test",
                password_hash="hashed",
                role=AccountRole.ENTERPRISE,
                display_name="Reporting account",
                title="Manager",
                status=AccountStatus.ACTIVE,
            )
        )
        enterprise = Enterprise(
            official_code=f"ENT-{uuid4().hex[:12]}",
            name="Reporting enterprise",
            classification="official",
            lifecycle_state="active",
        )
        session.add(enterprise)
        session.commit()
        site = EnterpriseSite(
            enterprise_id=enterprise.id,
            classification="official",
            site_code="primary",
            name="Primary site",
        )
        session.add(site)
        session.commit()
        return enterprise.id, site.id, account_id


def _period(natural_key: str) -> ReportingPeriod:
    starts_at = datetime(2026, 5, 31, 16, tzinfo=UTC)
    ends_at = datetime(2026, 6, 30, 16, tzinfo=UTC)
    return ReportingPeriod(
        natural_key=natural_key,
        cadence="month",
        timezone_name="Asia/Manila",
        local_start_date=date(2026, 6, 1),
        local_end_date=date(2026, 7, 1),
        starts_at=starts_at,
        ends_at=ends_at,
        submission_opens_at=ends_at,
        submission_closes_at=ends_at + timedelta(days=15),
        status="open",
        label="June 2026",
    )


def _insert_period(engine: Engine) -> str:
    with Session(engine, expire_on_commit=False) as session:
        period = _period(f"month:Asia/Manila:2026-{uuid4().int % 12 + 1:02d}")
        session.add(period)
        session.commit()
        return period.id


def _insert_report_graph(engine: Engine) -> dict[str, Any]:
    enterprise_id, site_id, account_id = _topology(engine)
    with Session(engine, expire_on_commit=False) as session:
        period = _period(f"month:Asia/Manila:2026-{uuid4().int % 12 + 1:02d}")
        session.add(period)
        session.commit()
        obligation = ReportingObligation(
            reporting_period_id=period.id,
            enterprise_id=enterprise_id,
            site_id=site_id,
            classification="official",
            eligibility_status="eligible",
            eligibility_basis="registry_snapshot",
            enterprise_official_code="ENT-REPORTING",
            enterprise_name="Reporting enterprise",
            site_code="PRIMARY",
            site_name="Primary site",
            timezone_name="Asia/Manila",
            acceptance_blocked=False,
        )
        session.add(obligation)
        session.commit()
        obligation_id = obligation.id

    report_id = str(uuid4())
    revision_id = str(uuid4())
    now = datetime(2026, 7, 1, tzinfo=UTC)
    with engine.begin() as connection:
        connection.execute(
            insert(EnterpriseReport),
            {
                "id": report_id,
                "reporting_obligation_id": obligation_id,
                "enterprise_id": enterprise_id,
                "site_id": site_id,
                "classification": "official",
                "workflow_state": "submitted",
                "current_revision_id": revision_id,
                "accepted_revision_id": None,
                "logical_version": 1,
                "acceptance_blocked": False,
            },
        )
        connection.execute(
            insert(ReportRevision),
            {
                "id": revision_id,
                "enterprise_report_id": report_id,
                "enterprise_id": enterprise_id,
                "site_id": site_id,
                "classification": "official",
                "revision_number": 1,
                "local_revision_id": "local-1",
                "idempotency_key": "report:install:local-1",
                "source_window_start": period.starts_at,
                "source_window_end": period.ends_at,
                "submitted_by_account_id": account_id,
                "submitted_at": now,
                "received_at": now,
                "payload_hash": f"sha256:{'b' * 64}",
                "evidence_status": "complete",
                "acceptance_blocked": False,
            },
        )
    return {
        "enterprise_id": enterprise_id,
        "site_id": site_id,
        "account_id": account_id,
        "period": period,
        "report_id": report_id,
        "revision_id": revision_id,
    }
