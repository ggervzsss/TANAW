from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

_CLASSIFICATION_CHECK = "classification IN ('official', 'simulation')"
_WORKFLOW_STATES = "'submitted', 'returned', 'accepted', 'consolidated'"
_SHA256_CHECK = "length(payload_hash) = 71 AND payload_hash LIKE 'sha256:%'"


class ReportingPeriod(Base):
    __tablename__ = "reporting_periods"
    __table_args__ = (
        CheckConstraint("cadence = 'month'", name="ck_reporting_periods_cadence"),
        CheckConstraint("timezone_name = 'Asia/Manila'", name="ck_reporting_periods_timezone"),
        CheckConstraint("ends_at > starts_at", name="ck_reporting_periods_utc_bounds"),
        CheckConstraint(
            "local_end_date > local_start_date",
            name="ck_reporting_periods_local_bounds",
        ),
        CheckConstraint(
            "submission_opens_at >= ends_at",
            name="ck_reporting_periods_submission_window",
        ),
        CheckConstraint(
            "submission_closes_at > submission_opens_at",
            name="ck_reporting_periods_submission_close",
        ),
        CheckConstraint(
            "status IN ('scheduled', 'open', 'closed')",
            name="ck_reporting_periods_status",
        ),
        CheckConstraint(
            "length(trim(natural_key)) > 0 AND length(trim(label)) > 0",
            name="ck_reporting_periods_identity",
        ),
        UniqueConstraint("natural_key", name="uq_reporting_periods_natural_key"),
        UniqueConstraint(
            "cadence",
            "timezone_name",
            "starts_at",
            "ends_at",
            name="uq_reporting_periods_canonical_bounds",
        ),
        ExcludeConstraint(
            ("cadence", "="),
            ("timezone_name", "="),
            (text("tstzrange(starts_at, ends_at, '[)')"), "&&"),
            name="ex_reporting_periods_no_overlap",
            using="gist",
        ).ddl_if(dialect="postgresql"),
        Index(
            "ix_reporting_periods_status_keyset",
            "status",
            "starts_at",
            "id",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    natural_key: Mapped[str] = mapped_column(String(64), nullable=False)
    cadence: Mapped[str] = mapped_column(String(20), nullable=False, default="month")
    timezone_name: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Manila")
    local_start_date: Mapped[date] = mapped_column(Date, nullable=False)
    local_end_date: Mapped[date] = mapped_column(Date, nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    submission_opens_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    submission_closes_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    obligations_frozen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ReportingObligation(Base):
    __tablename__ = "reporting_obligations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["site_id", "enterprise_id", "classification"],
            [
                "enterprise_sites.id",
                "enterprise_sites.enterprise_id",
                "enterprise_sites.classification",
            ],
            name="fk_reporting_obligations_site_enterprise_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_reporting_obligations_classification"),
        CheckConstraint(
            "eligibility_status IN ('eligible', 'exempt', 'ineligible', 'unknown')",
            name="ck_reporting_obligations_eligibility_status",
        ),
        CheckConstraint(
            "eligibility_basis IN ('registry_snapshot', 'legacy_submission', 'manual_resolution')",
            name="ck_reporting_obligations_eligibility_basis",
        ),
        CheckConstraint(
            "timezone_name = 'Asia/Manila'",
            name="ck_reporting_obligations_timezone",
        ),
        CheckConstraint(
            "eligibility_status != 'exempt' OR "
            "(exemption_reason IS NOT NULL AND length(trim(exemption_reason)) > 0)",
            name="ck_reporting_obligations_exemption_reason",
        ),
        CheckConstraint(
            "length(trim(enterprise_official_code)) > 0 "
            "AND length(trim(enterprise_name)) > 0 "
            "AND length(trim(site_code)) > 0 "
            "AND length(trim(site_name)) > 0",
            name="ck_reporting_obligations_identity_snapshots",
        ),
        UniqueConstraint(
            "enterprise_id",
            "site_id",
            "reporting_period_id",
            name="uq_reporting_obligations_site_period",
        ),
        UniqueConstraint(
            "id",
            "enterprise_id",
            "site_id",
            "classification",
            name="uq_reporting_obligations_identity_scope",
        ),
        UniqueConstraint("id", "classification", name="uq_reporting_obligations_id_classification"),
        Index(
            "ix_reporting_obligations_period_eligibility",
            "reporting_period_id",
            "eligibility_status",
        ),
        Index(
            "ix_reporting_obligations_enterprise_period",
            "enterprise_id",
            "reporting_period_id",
        ),
        Index(
            "ix_reporting_obligations_period_classification_id",
            "reporting_period_id",
            "classification",
            "id",
        ),
        Index(
            "ix_reporting_obligations_acceptance_blocked",
            "acceptance_blocked",
            postgresql_where=text("acceptance_blocked = true"),
            sqlite_where=text("acceptance_blocked = 1"),
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    reporting_period_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("reporting_periods.id", ondelete="RESTRICT"),
        nullable=False,
    )
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    eligibility_status: Mapped[str] = mapped_column(String(20), nullable=False)
    eligibility_basis: Mapped[str] = mapped_column(String(40), nullable=False)
    exemption_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    frozen_barangay: Mapped[str | None] = mapped_column(String(120), nullable=True)
    enterprise_official_code: Mapped[str] = mapped_column(String(120), nullable=False)
    enterprise_name: Mapped[str] = mapped_column(String(120), nullable=False)
    site_code: Mapped[str] = mapped_column(String(80), nullable=False)
    site_name: Mapped[str] = mapped_column(String(160), nullable=False)
    timezone_name: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Manila")
    registration_effective_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    acceptance_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class EnterpriseReport(Base):
    __tablename__ = "enterprise_reports"
    __table_args__ = (
        ForeignKeyConstraint(
            ["reporting_obligation_id", "enterprise_id", "site_id", "classification"],
            [
                "reporting_obligations.id",
                "reporting_obligations.enterprise_id",
                "reporting_obligations.site_id",
                "reporting_obligations.classification",
            ],
            name="fk_enterprise_reports_obligation_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["current_revision_id", "id", "enterprise_id", "site_id", "classification"],
            [
                "report_revisions.id",
                "report_revisions.enterprise_report_id",
                "report_revisions.enterprise_id",
                "report_revisions.site_id",
                "report_revisions.classification",
            ],
            name="fk_enterprise_reports_current_revision_scope",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
        ),
        ForeignKeyConstraint(
            ["accepted_revision_id", "id", "enterprise_id", "site_id", "classification"],
            [
                "report_revisions.id",
                "report_revisions.enterprise_report_id",
                "report_revisions.enterprise_id",
                "report_revisions.site_id",
                "report_revisions.classification",
            ],
            name="fk_enterprise_reports_accepted_revision_scope",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_enterprise_reports_classification"),
        CheckConstraint(
            f"workflow_state IN ({_WORKFLOW_STATES})",
            name="ck_enterprise_reports_workflow_state",
        ),
        CheckConstraint("logical_version >= 1", name="ck_enterprise_reports_logical_version"),
        CheckConstraint(
            "workflow_state NOT IN ('accepted', 'consolidated') "
            "OR (accepted_revision_id IS NOT NULL "
            "AND accepted_revision_id = current_revision_id)",
            name="ck_enterprise_reports_accepted_pointer",
        ),
        UniqueConstraint("reporting_obligation_id", name="uq_enterprise_reports_obligation"),
        UniqueConstraint(
            "id",
            "enterprise_id",
            "site_id",
            "classification",
            name="uq_enterprise_reports_identity_scope",
        ),
        UniqueConstraint(
            "id", "enterprise_id", "classification", name="uq_enterprise_reports_enterprise_scope"
        ),
        Index(
            "ix_enterprise_reports_enterprise_state",
            "enterprise_id",
            "workflow_state",
        ),
        Index(
            "ix_enterprise_reports_state_blocked",
            "workflow_state",
            "acceptance_blocked",
        ),
        Index(
            "ix_enterprise_reports_queue_state_current",
            "classification",
            "workflow_state",
            "current_revision_id",
            "id",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    reporting_obligation_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    workflow_state: Mapped[str] = mapped_column(String(20), nullable=False)
    current_revision_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    accepted_revision_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    logical_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    acceptance_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ReportRevision(Base):
    __tablename__ = "report_revisions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["enterprise_report_id", "enterprise_id", "site_id", "classification"],
            [
                "enterprise_reports.id",
                "enterprise_reports.enterprise_id",
                "enterprise_reports.site_id",
                "enterprise_reports.classification",
            ],
            name="fk_report_revisions_report_scope",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_report_revisions_classification"),
        CheckConstraint("revision_number >= 1", name="ck_report_revisions_revision_number"),
        CheckConstraint(
            "source_window_end > source_window_start", name="ck_report_revisions_window"
        ),
        CheckConstraint(_SHA256_CHECK, name="ck_report_revisions_payload_hash"),
        CheckConstraint(
            "evidence_status IN ('complete', 'incomplete')",
            name="ck_report_revisions_evidence_status",
        ),
        CheckConstraint(
            "(monitored_seconds IS NULL AND expected_seconds IS NULL) OR "
            "(monitored_seconds >= 0 AND expected_seconds > 0 "
            "AND monitored_seconds <= expected_seconds)",
            name="ck_report_revisions_coverage",
        ),
        CheckConstraint(
            "coverage_gap_count IS NULL OR coverage_gap_count >= 0",
            name="ck_report_revisions_gap_count",
        ),
        CheckConstraint(
            "coverage_details_json IS NULL OR length(coverage_details_json) <= 20000",
            name="ck_report_revisions_coverage_details_size",
        ),
        UniqueConstraint(
            "enterprise_report_id",
            "revision_number",
            name="uq_report_revisions_report_number",
        ),
        UniqueConstraint(
            "enterprise_report_id",
            "local_revision_id",
            name="uq_report_revisions_local_revision",
        ),
        UniqueConstraint(
            "enterprise_report_id",
            "idempotency_key",
            name="uq_report_revisions_idempotency",
        ),
        UniqueConstraint(
            "id",
            "enterprise_report_id",
            "enterprise_id",
            "site_id",
            "classification",
            name="uq_report_revisions_identity_scope",
        ),
        UniqueConstraint("id", "site_id", "classification", name="uq_report_revisions_site_scope"),
        UniqueConstraint(
            "id", "enterprise_id", "classification", name="uq_report_revisions_enterprise_scope"
        ),
        UniqueConstraint("id", "classification", name="uq_report_revisions_id_classification"),
        Index("ix_report_revisions_submitted_at", "submitted_at"),
        Index("ix_report_revisions_report_received", "enterprise_report_id", "received_at"),
        Index(
            "ix_report_revisions_queue_received",
            "classification",
            "received_at",
            "enterprise_report_id",
            "id",
        ),
        Index(
            "ix_report_revisions_acceptance_blocked",
            "acceptance_blocked",
            postgresql_where=text("acceptance_blocked = true"),
            sqlite_where=text("acceptance_blocked = 1"),
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    enterprise_report_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    local_revision_id: Mapped[str] = mapped_column(String(120), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(240), nullable=False)
    source_window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_window_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    submitted_by_account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=False
    )
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    evidence_status: Mapped[str] = mapped_column(String(20), nullable=False)
    acceptance_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    monitored_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expected_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    coverage_gap_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    coverage_details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ReportMetricFact(Base):
    __tablename__ = "report_metric_facts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["report_revision_id", "classification"],
            ["report_revisions.id", "report_revisions.classification"],
            name="fk_report_metric_facts_revision_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_report_metric_facts_classification"),
        CheckConstraint(
            "definition_version >= 1", name="ck_report_metric_facts_definition_version"
        ),
        CheckConstraint(
            "grain IN ('camera', 'site', 'enterprise')",
            name="ck_report_metric_facts_grain",
        ),
        CheckConstraint(
            "provenance IN ('camera_derived', 'operator_entered', 'system_derived')",
            name="ck_report_metric_facts_provenance",
        ),
        CheckConstraint(
            "quality IN ('confirmed', 'degraded', 'estimated', 'unknown')",
            name="ck_report_metric_facts_quality",
        ),
        CheckConstraint(
            "(quality = 'unknown' AND value IS NULL) OR "
            "(quality != 'unknown' AND value IS NOT NULL)",
            name="ck_report_metric_facts_quality_value",
        ),
        CheckConstraint("value IS NULL OR value >= 0", name="ck_report_metric_facts_value"),
        CheckConstraint("window_end > window_start", name="ck_report_metric_facts_window"),
        CheckConstraint("timezone_name = 'Asia/Manila'", name="ck_report_metric_facts_timezone"),
        CheckConstraint(
            "(monitored_seconds IS NULL AND expected_seconds IS NULL "
            "AND coverage_gap_count IS NULL) OR "
            "(monitored_seconds >= 0 AND expected_seconds > 0 "
            "AND monitored_seconds <= expected_seconds AND coverage_gap_count >= 0)",
            name="ck_report_metric_facts_coverage",
        ),
        UniqueConstraint(
            "report_revision_id",
            "definition",
            "definition_version",
            "grain",
            name="uq_report_metric_facts_definition",
        ),
        Index("ix_report_metric_facts_revision", "report_revision_id"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    report_revision_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    definition: Mapped[str] = mapped_column(String(120), nullable=False)
    definition_version: Mapped[int] = mapped_column(Integer, nullable=False)
    value: Mapped[Decimal | None] = mapped_column(Numeric(20, 6), nullable=True)
    unit: Mapped[str] = mapped_column(String(60), nullable=False)
    grain: Mapped[str] = mapped_column(String(20), nullable=False)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    timezone_name: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Manila")
    provenance: Mapped[str] = mapped_column(String(30), nullable=False)
    quality: Mapped[str] = mapped_column(String(20), nullable=False)
    monitored_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expected_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    coverage_gap_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ReportDemographicFact(Base):
    __tablename__ = "report_demographic_facts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["report_revision_id", "classification"],
            ["report_revisions.id", "report_revisions.classification"],
            name="fk_report_demographic_facts_revision_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_report_demographic_facts_classification"),
        CheckConstraint("count >= 0", name="ck_report_demographic_facts_count"),
        CheckConstraint(
            "percentage IS NULL OR (percentage >= 0 AND percentage <= 100)",
            name="ck_report_demographic_facts_percentage",
        ),
        CheckConstraint(
            "provenance IN ('operator_entered', 'system_derived')",
            name="ck_report_demographic_facts_provenance",
        ),
        CheckConstraint(
            "quality IN ('confirmed', 'degraded', 'estimated')",
            name="ck_report_demographic_facts_quality",
        ),
        UniqueConstraint(
            "report_revision_id",
            "dimension",
            "value",
            name="uq_report_demographic_facts_dimension_value",
        ),
        Index("ix_report_demographic_facts_revision", "report_revision_id"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    report_revision_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    dimension: Mapped[str] = mapped_column(String(80), nullable=False)
    value: Mapped[str] = mapped_column(String(120), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    percentage: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    provenance: Mapped[str] = mapped_column(String(30), nullable=False)
    quality: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ReportSourceBatch(Base):
    __tablename__ = "report_source_batches"
    __table_args__ = (
        ForeignKeyConstraint(
            ["report_revision_id", "site_id", "classification"],
            ["report_revisions.id", "report_revisions.site_id", "report_revisions.classification"],
            name="fk_report_source_batches_revision_site_classification",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["camera_id", "site_id", "classification"],
            ["cameras.id", "cameras.site_id", "cameras.classification"],
            name="fk_report_source_batches_camera_site_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_report_source_batches_classification"),
        CheckConstraint("event_count >= 0", name="ck_report_source_batches_event_count"),
        CheckConstraint(
            "event_sequence_start >= 0 AND event_sequence_end_exclusive >= event_sequence_start",
            name="ck_report_source_batches_sequence",
        ),
        CheckConstraint(
            "event_sequence_end_exclusive - event_sequence_start = event_count",
            name="ck_report_source_batches_sequence_count",
        ),
        CheckConstraint(
            "length(aggregate_hash) = 71 AND aggregate_hash LIKE 'sha256:%'",
            name="ck_report_source_batches_aggregate_hash",
        ),
        Index("ix_report_source_batches_camera", "camera_id"),
        Index(
            "ix_report_source_batches_revision_order",
            "report_revision_id",
            "camera_id",
            "event_sequence_start",
            "id",
        ),
    )

    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    report_revision_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    camera_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False)
    event_sequence_start: Mapped[int] = mapped_column(Integer, nullable=False)
    event_sequence_end_exclusive: Mapped[int] = mapped_column(Integer, nullable=False)
    aggregate_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ReportReviewEvent(Base):
    __tablename__ = "report_review_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["enterprise_report_id", "enterprise_id", "classification"],
            [
                "enterprise_reports.id",
                "enterprise_reports.enterprise_id",
                "enterprise_reports.classification",
            ],
            name="fk_report_review_events_report_enterprise_classification",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["report_revision_id", "enterprise_id", "classification"],
            [
                "report_revisions.id",
                "report_revisions.enterprise_id",
                "report_revisions.classification",
            ],
            name="fk_report_review_events_revision_enterprise_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_report_review_events_classification"),
        CheckConstraint(
            "event_type IN ('revision_submitted', 'returned', 'accepted', 'reopened', "
            "'consolidated', 'legacy_state_imported')",
            name="ck_report_review_events_type",
        ),
        CheckConstraint(
            f"from_state IS NULL OR from_state IN ({_WORKFLOW_STATES})",
            name="ck_report_review_events_from_state",
        ),
        CheckConstraint(
            f"to_state IN ({_WORKFLOW_STATES})",
            name="ck_report_review_events_to_state",
        ),
        CheckConstraint(
            "expected_version >= 0 AND resulting_version >= 1 "
            "AND resulting_version > expected_version",
            name="ck_report_review_events_versions",
        ),
        CheckConstraint(
            "(actor_account_id IS NULL AND actor_display_name IS NULL) OR "
            "(actor_account_id IS NOT NULL AND actor_display_name IS NOT NULL "
            "AND length(trim(actor_display_name)) > 0)",
            name="ck_report_review_events_actor_snapshot",
        ),
        UniqueConstraint("command_id", name="uq_report_review_events_command_id"),
        Index("ix_report_review_events_report_occurred", "enterprise_report_id", "occurred_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    enterprise_report_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    report_revision_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    from_state: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_state: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
    actor_display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    actor_role: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    command_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    expected_version: Mapped[int] = mapped_column(Integer, nullable=False)
    resulting_version: Mapped[int] = mapped_column(Integer, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ReportIntakeReceipt(Base):
    __tablename__ = "report_intake_receipts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["enterprise_report_id", "enterprise_id", "classification"],
            [
                "enterprise_reports.id",
                "enterprise_reports.enterprise_id",
                "enterprise_reports.classification",
            ],
            name="fk_report_intake_receipts_report_enterprise_classification",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["report_revision_id", "enterprise_id", "classification"],
            [
                "report_revisions.id",
                "report_revisions.enterprise_id",
                "report_revisions.classification",
            ],
            name="fk_report_intake_receipts_revision_enterprise_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_report_intake_receipts_classification"),
        CheckConstraint(
            "receipt_kind IN ('command', 'migration')",
            name="ck_report_intake_receipts_kind",
        ),
        CheckConstraint(
            "(receipt_kind = 'command' AND contract_version = 2 AND command_id IS NOT NULL) "
            "OR (receipt_kind = 'migration' AND contract_version IS NULL AND command_id IS NULL)",
            name="ck_report_intake_receipts_contract",
        ),
        CheckConstraint(_SHA256_CHECK, name="ck_report_intake_receipts_payload_hash"),
        UniqueConstraint("command_id", name="uq_report_intake_receipts_command_id"),
        UniqueConstraint(
            "enterprise_id",
            "idempotency_key",
            name="uq_report_intake_receipts_enterprise_idempotency",
        ),
        Index("ix_report_intake_receipts_revision", "report_revision_id"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    enterprise_report_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    report_revision_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    receipt_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    contract_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    command_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(240), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ReportMigrationException(Base):
    __tablename__ = "report_migration_exceptions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["enterprise_id", "classification"],
            ["enterprises.id", "enterprises.classification"],
            name="fk_report_migration_exceptions_enterprise_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "classification IS NULL OR classification IN ('official', 'simulation')",
            name="ck_report_migration_exceptions_classification",
        ),
        CheckConstraint(
            "(enterprise_id IS NULL AND classification IS NULL) OR "
            "(enterprise_id IS NOT NULL AND classification IS NOT NULL)",
            name="ck_report_migration_exceptions_enterprise_classification_pair",
        ),
        CheckConstraint(
            "status IN ('open', 'resolved', 'waived')",
            name="ck_report_migration_exceptions_status",
        ),
        CheckConstraint(
            "details_json IS NULL OR length(details_json) <= 20000",
            name="ck_report_migration_exceptions_details_size",
        ),
        CheckConstraint(
            "(status = 'open' AND resolved_at IS NULL AND resolved_by_account_id IS NULL) OR "
            "(status IN ('resolved', 'waived') AND resolved_at IS NOT NULL "
            "AND resolved_by_account_id IS NOT NULL)",
            name="ck_report_migration_exceptions_resolution",
        ),
        UniqueConstraint(
            "source_table",
            "source_row_id",
            "exception_code",
            name="uq_report_migration_exceptions_source_code",
        ),
        Index(
            "ix_report_migration_exceptions_open_blocking",
            "status",
            "blocks_acceptance",
            postgresql_where=text("status = 'open' AND blocks_acceptance = true"),
            sqlite_where=text("status = 'open' AND blocks_acceptance = 1"),
        ),
        Index("ix_report_migration_exceptions_revision", "report_revision_id"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    source_table: Mapped[str] = mapped_column(String(120), nullable=False)
    source_row_id: Mapped[str] = mapped_column(String(120), nullable=False)
    exception_code: Mapped[str] = mapped_column(String(80), nullable=False)
    enterprise_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    reporting_period_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("reporting_periods.id", ondelete="RESTRICT"),
        nullable=True,
    )
    report_revision_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("report_revisions.id", ondelete="RESTRICT"),
        nullable=True,
    )
    classification: Mapped[str | None] = mapped_column(String(20), nullable=True)
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    blocks_acceptance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
