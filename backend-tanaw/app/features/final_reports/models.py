"""Final-report persistence rooted at ``report_finalizations``."""

from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
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
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

_CLASSIFICATION_CHECK = "classification IN ('official', 'simulation')"
_SHA256_CHECK = "length(content_hash) = 71 AND content_hash LIKE 'sha256:%'"


class ReportFinalization(Base):
    """Logical identity whose current pointer advances to immutable versions."""

    __tablename__ = "report_finalizations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["current_version_id", "id", "classification"],
            [
                "final_report_versions.id",
                "final_report_versions.report_finalization_id",
                "final_report_versions.classification",
            ],
            name="fk_report_finalizations_current_version_scope",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
            use_alter=True,
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_report_finalizations_classification"),
        CheckConstraint("logical_version >= 1", name="ck_report_finalizations_logical_version"),
        UniqueConstraint("report_code", name="uq_report_finalizations_report_code"),
        UniqueConstraint("id", "classification", name="uq_report_finalizations_id_classification"),
        Index(
            "ix_report_finalizations_period_classification",
            "reporting_period_id",
            "classification",
        ),
        Index(
            "ix_report_finalizations_period_current",
            "classification",
            "reporting_period_id",
            "current_version_id",
            "id",
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
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    report_code: Mapped[str] = mapped_column(String(80), nullable=False)
    current_version_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    logical_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class FinalReportVersion(Base):
    """Immutable report facts; only ``disposition`` may become superseded."""

    __tablename__ = "final_report_versions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["report_finalization_id", "classification"],
            ["report_finalizations.id", "report_finalizations.classification"],
            name="fk_final_report_versions_finalization_classification",
            ondelete="RESTRICT",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_final_report_versions_classification"),
        CheckConstraint("version_number >= 1", name="ck_final_report_versions_number"),
        CheckConstraint(
            "scope_type IN ('citywide', 'barangay', 'enterprise_selection')",
            name="ck_final_report_versions_scope_type",
        ),
        CheckConstraint(
            "(scope_type = 'barangay' AND scope_barangay IS NOT NULL "
            "AND length(trim(scope_barangay)) > 0) OR "
            "(scope_type != 'barangay' AND scope_barangay IS NULL)",
            name="ck_final_report_versions_barangay_scope",
        ),
        CheckConstraint("length(trim(scope_label)) > 0", name="ck_final_report_versions_label"),
        CheckConstraint(_SHA256_CHECK, name="ck_final_report_versions_content_hash"),
        CheckConstraint(
            "disposition IN ('current', 'superseded')",
            name="ck_final_report_versions_disposition",
        ),
        CheckConstraint(
            "source_count > 0 AND scope_member_count > 0 AND source_count = scope_member_count",
            name="ck_final_report_versions_counts",
        ),
        UniqueConstraint(
            "report_finalization_id",
            "version_number",
            name="uq_final_report_versions_finalization_number",
        ),
        UniqueConstraint(
            "id",
            "report_finalization_id",
            "classification",
            name="uq_final_report_versions_identity_scope",
        ),
        UniqueConstraint("id", "classification", name="uq_final_report_versions_id_classification"),
        Index("ix_final_report_versions_finalized", "classification", "finalized_at"),
        Index(
            "uq_final_report_versions_current",
            "report_finalization_id",
            unique=True,
            postgresql_where=text("disposition = 'current'"),
            sqlite_where=text("disposition = 'current'"),
        ),
        Index(
            "ix_final_report_versions_current_keyset",
            "classification",
            "finalized_at",
            "report_finalization_id",
            postgresql_where=text("disposition = 'current'"),
            sqlite_where=text("disposition = 'current'"),
        ),
        Index(
            "ix_final_report_versions_current_scope_keyset",
            "classification",
            "scope_type",
            "finalized_at",
            "report_finalization_id",
            postgresql_where=text("disposition = 'current'"),
            sqlite_where=text("disposition = 'current'"),
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    report_finalization_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    disposition: Mapped[str] = mapped_column(String(20), nullable=False, default="current")
    scope_type: Mapped[str] = mapped_column(String(30), nullable=False)
    scope_barangay: Mapped[str | None] = mapped_column(String(120), nullable=True)
    scope_label: Mapped[str] = mapped_column(String(200), nullable=False)
    source_count: Mapped[int] = mapped_column(Integer, nullable=False)
    scope_member_count: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    prepared_by_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
    prepared_by_name: Mapped[str] = mapped_column(String(120), nullable=False)
    prepared_by_role: Mapped[str] = mapped_column(String(120), nullable=False)
    finalized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FinalReportSourceClaim(Base):
    """Owns one exact source revision for one logical finalization forever."""

    __tablename__ = "final_report_source_claims"
    __table_args__ = (
        ForeignKeyConstraint(
            ["report_finalization_id", "classification"],
            ["report_finalizations.id", "report_finalizations.classification"],
            name="fk_final_report_source_claims_finalization_classification",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["report_revision_id", "classification"],
            ["report_revisions.id", "report_revisions.classification"],
            name="fk_final_report_source_claims_revision_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_final_report_source_claims_classification"),
        UniqueConstraint("report_revision_id", name="uq_final_report_source_claims_revision"),
        UniqueConstraint(
            "report_revision_id",
            "report_finalization_id",
            "classification",
            name="uq_final_report_source_claims_revision_owner",
        ),
        Index("ix_final_report_source_claims_finalization", "report_finalization_id", "claimed_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    report_finalization_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    report_revision_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FinalReportScopeMember(Base):
    __tablename__ = "final_report_scope_members"
    __table_args__ = (
        ForeignKeyConstraint(
            ["final_report_version_id", "report_finalization_id", "classification"],
            [
                "final_report_versions.id",
                "final_report_versions.report_finalization_id",
                "final_report_versions.classification",
            ],
            name="fk_final_report_scope_members_version_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["reporting_obligation_id", "enterprise_id", "site_id", "classification"],
            [
                "reporting_obligations.id",
                "reporting_obligations.enterprise_id",
                "reporting_obligations.site_id",
                "reporting_obligations.classification",
            ],
            name="fk_final_report_scope_members_obligation_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_final_report_scope_members_classification"),
        CheckConstraint(
            "length(trim(enterprise_official_code)) > 0 "
            "AND length(trim(enterprise_name)) > 0 "
            "AND length(trim(site_code)) > 0 "
            "AND length(trim(site_name)) > 0",
            name="ck_final_report_scope_members_identity_snapshots",
        ),
        UniqueConstraint(
            "final_report_version_id",
            "reporting_obligation_id",
            name="uq_final_report_scope_members_obligation",
        ),
        UniqueConstraint(
            "final_report_version_id",
            "reporting_obligation_id",
            "classification",
            name="uq_final_report_scope_members_item_scope",
        ),
        Index("ix_final_report_scope_members_enterprise", "enterprise_id", "site_id"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    final_report_version_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    report_finalization_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    reporting_obligation_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    enterprise_official_code: Mapped[str] = mapped_column(String(120), nullable=False)
    enterprise_name: Mapped[str] = mapped_column(String(120), nullable=False)
    enterprise_category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    site_code: Mapped[str] = mapped_column(String(80), nullable=False)
    site_name: Mapped[str] = mapped_column(String(160), nullable=False)
    frozen_barangay: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FinalReportItem(Base):
    __tablename__ = "final_report_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["final_report_version_id", "report_finalization_id", "classification"],
            [
                "final_report_versions.id",
                "final_report_versions.report_finalization_id",
                "final_report_versions.classification",
            ],
            name="fk_final_report_items_version_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["final_report_version_id", "reporting_obligation_id", "classification"],
            [
                "final_report_scope_members.final_report_version_id",
                "final_report_scope_members.reporting_obligation_id",
                "final_report_scope_members.classification",
            ],
            name="fk_final_report_items_scope_member",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["report_revision_id", "report_finalization_id", "classification"],
            [
                "final_report_source_claims.report_revision_id",
                "final_report_source_claims.report_finalization_id",
                "final_report_source_claims.classification",
            ],
            name="fk_final_report_items_source_claim",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_final_report_items_classification"),
        CheckConstraint(
            "length(source_payload_hash) = 71 AND source_payload_hash LIKE 'sha256:%'",
            name="ck_final_report_items_payload_hash",
        ),
        UniqueConstraint(
            "final_report_version_id",
            "report_revision_id",
            name="uq_final_report_items_revision",
        ),
        UniqueConstraint(
            "final_report_version_id",
            "reporting_obligation_id",
            name="uq_final_report_items_obligation",
        ),
        Index("ix_final_report_items_revision", "report_revision_id"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    final_report_version_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    report_finalization_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    reporting_obligation_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    report_revision_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    source_payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FinalReportMetricFact(Base):
    __tablename__ = "final_report_metric_facts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["final_report_version_id", "classification"],
            ["final_report_versions.id", "final_report_versions.classification"],
            name="fk_final_report_metric_facts_version_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_final_report_metric_facts_classification"),
        CheckConstraint("definition_version >= 1", name="ck_final_report_metric_facts_version"),
        CheckConstraint(
            "aggregation_method IN ('sum', 'maximum', 'summed_site_estimate')",
            name="ck_final_report_metric_facts_aggregation",
        ),
        CheckConstraint(
            "quality IN ('confirmed', 'degraded', 'estimated', 'unknown')",
            name="ck_final_report_metric_facts_quality",
        ),
        CheckConstraint(
            "(quality = 'unknown' AND value IS NULL) OR "
            "(quality != 'unknown' AND value IS NOT NULL)",
            name="ck_final_report_metric_facts_quality_value",
        ),
        CheckConstraint("value IS NULL OR value >= 0", name="ck_final_report_metric_facts_value"),
        CheckConstraint("source_fact_count > 0", name="ck_final_report_metric_facts_source_count"),
        UniqueConstraint(
            "final_report_version_id",
            "definition",
            "definition_version",
            "unit",
            name="uq_final_report_metric_facts_definition",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    final_report_version_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    definition: Mapped[str] = mapped_column(String(120), nullable=False)
    definition_version: Mapped[int] = mapped_column(Integer, nullable=False)
    value: Mapped[Decimal | None] = mapped_column(Numeric(20, 6), nullable=True)
    unit: Mapped[str] = mapped_column(String(60), nullable=False)
    aggregation_method: Mapped[str] = mapped_column(String(40), nullable=False)
    quality: Mapped[str] = mapped_column(String(20), nullable=False)
    source_fact_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FinalReportDemographicFact(Base):
    __tablename__ = "final_report_demographic_facts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["final_report_version_id", "classification"],
            ["final_report_versions.id", "final_report_versions.classification"],
            name="fk_final_report_demographic_facts_version_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            _CLASSIFICATION_CHECK, name="ck_final_report_demographic_facts_classification"
        ),
        CheckConstraint("count >= 0", name="ck_final_report_demographic_facts_count"),
        CheckConstraint(
            "percentage IS NULL OR (percentage >= 0 AND percentage <= 100)",
            name="ck_final_report_demographic_facts_percentage",
        ),
        CheckConstraint(
            "quality IN ('confirmed', 'degraded', 'estimated')",
            name="ck_final_report_demographic_facts_quality",
        ),
        CheckConstraint(
            "source_fact_count > 0", name="ck_final_report_demographic_facts_source_count"
        ),
        UniqueConstraint(
            "final_report_version_id",
            "dimension",
            "value",
            name="uq_final_report_demographic_facts_dimension_value",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    final_report_version_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    dimension: Mapped[str] = mapped_column(String(80), nullable=False)
    value: Mapped[str] = mapped_column(String(120), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    percentage: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    quality: Mapped[str] = mapped_column(String(20), nullable=False)
    source_fact_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FinalReportEvent(Base):
    __tablename__ = "final_report_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["report_finalization_id", "classification"],
            ["report_finalizations.id", "report_finalizations.classification"],
            name="fk_final_report_events_finalization_classification",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["final_report_version_id", "report_finalization_id", "classification"],
            [
                "final_report_versions.id",
                "final_report_versions.report_finalization_id",
                "final_report_versions.classification",
            ],
            name="fk_final_report_events_version_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["final_report_artifact_id", "final_report_version_id", "classification"],
            [
                "final_report_artifacts.id",
                "final_report_artifacts.final_report_version_id",
                "final_report_artifacts.classification",
            ],
            name="fk_final_report_events_artifact_scope",
            ondelete="RESTRICT",
            use_alter=True,
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_final_report_events_classification"),
        CheckConstraint(
            "event_type IN ('version_finalized', 'artifact_ready', 'artifact_failed', "
            "'artifact_retry_scheduled', "
            "'artifact_repair_requested')",
            name="ck_final_report_events_type",
        ),
        CheckConstraint(
            "((event_type = 'version_finalized' AND "
            "final_report_artifact_id IS NULL AND expected_version >= 0 AND "
            "resulting_version > expected_version) OR "
            "(event_type IN ('artifact_ready', 'artifact_failed', "
            "'artifact_retry_scheduled', 'artifact_repair_requested') AND "
            "final_report_artifact_id IS NOT NULL AND expected_version = resulting_version "
            "AND resulting_version >= 1))",
            name="ck_final_report_events_versions",
        ),
        CheckConstraint(
            "(actor_account_id IS NULL AND actor_display_name IS NULL) OR "
            "(actor_account_id IS NOT NULL AND actor_display_name IS NOT NULL "
            "AND length(trim(actor_display_name)) > 0)",
            name="ck_final_report_events_actor_snapshot",
        ),
        UniqueConstraint("command_id", name="uq_final_report_events_command_id"),
        Index(
            "ix_final_report_events_finalization_occurred", "report_finalization_id", "occurred_at"
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    report_finalization_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    final_report_version_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    final_report_artifact_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    actor_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
    actor_display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    actor_role: Mapped[str | None] = mapped_column(String(40), nullable=True)
    command_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    expected_version: Mapped[int] = mapped_column(Integer, nullable=False)
    resulting_version: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FinalReportArtifact(Base):
    __tablename__ = "final_report_artifacts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["final_report_version_id", "classification"],
            ["final_report_versions.id", "final_report_versions.classification"],
            name="fk_final_report_artifacts_version_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_final_report_artifacts_classification"),
        CheckConstraint(
            "status IN ('pending', 'repairing', 'ready', 'failed')",
            name="ck_final_report_artifacts_status",
        ),
        CheckConstraint("generation_attempts >= 0", name="ck_final_report_artifacts_attempts"),
        CheckConstraint(
            "(status = 'ready' AND storage_key IS NOT NULL AND content_hash IS NOT NULL "
            "AND generated_at IS NOT NULL AND generated_by_account_id IS NOT NULL) OR "
            "(status != 'ready' AND generated_at IS NULL)",
            name="ck_final_report_artifacts_ready_metadata",
        ),
        CheckConstraint(
            "content_hash IS NULL OR " + _SHA256_CHECK,
            name="ck_final_report_artifacts_content_hash",
        ),
        UniqueConstraint(
            "final_report_version_id",
            "template_version",
            "mime_type",
            name="uq_final_report_artifacts_rendering",
        ),
        UniqueConstraint(
            "id",
            "final_report_version_id",
            "classification",
            name="uq_final_report_artifacts_event_scope",
        ),
        Index("ix_final_report_artifacts_status", "status", "updated_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    final_report_version_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    template_version: Mapped[str] = mapped_column(String(80), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(71), nullable=True)
    generation_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    generated_by_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class FinalReportCommandReceipt(Base):
    __tablename__ = "final_report_command_receipts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["report_finalization_id", "classification"],
            ["report_finalizations.id", "report_finalizations.classification"],
            name="fk_final_report_command_receipts_finalization_classification",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["final_report_version_id", "report_finalization_id", "classification"],
            [
                "final_report_versions.id",
                "final_report_versions.report_finalization_id",
                "final_report_versions.classification",
            ],
            name="fk_final_report_command_receipts_version_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            _CLASSIFICATION_CHECK, name="ck_final_report_command_receipts_classification"
        ),
        CheckConstraint("contract_version = 2", name="ck_final_report_command_receipts_contract"),
        CheckConstraint(
            "length(payload_hash) = 71 AND payload_hash LIKE 'sha256:%'",
            name="ck_final_report_command_receipts_payload_hash",
        ),
        CheckConstraint(
            "expected_version >= 0 AND resulting_version > expected_version",
            name="ck_final_report_command_receipts_versions",
        ),
        UniqueConstraint("command_id", name="uq_final_report_command_receipts_command_id"),
        UniqueConstraint("idempotency_key", name="uq_final_report_command_receipts_idempotency"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    report_finalization_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    final_report_version_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    contract_version: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    command_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(240), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    expected_version: Mapped[int] = mapped_column(Integer, nullable=False)
    resulting_version: Mapped[int] = mapped_column(Integer, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
