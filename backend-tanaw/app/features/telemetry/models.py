from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
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
_HASH_CHECK = "length(payload_hash) = 71 AND payload_hash LIKE 'sha256:%'"


class DeviceTelemetryEpoch(Base):
    __tablename__ = "device_telemetry_epochs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["edge_device_id", "site_id", "classification"],
            ["edge_devices.id", "edge_devices.site_id", "edge_devices.classification"],
            name="fk_device_telemetry_epochs_device_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["previous_epoch_id", "edge_device_id", "site_id", "classification"],
            [
                "device_telemetry_epochs.id",
                "device_telemetry_epochs.edge_device_id",
                "device_telemetry_epochs.site_id",
                "device_telemetry_epochs.classification",
            ],
            name="fk_device_telemetry_epochs_previous_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_device_telemetry_epochs_classification"),
        CheckConstraint("generation >= 1", name="ck_device_telemetry_epochs_generation"),
        CheckConstraint(
            "status IN ('active', 'retired')",
            name="ck_device_telemetry_epochs_status",
        ),
        CheckConstraint(
            "(status = 'active' AND retired_at IS NULL) OR "
            "(status = 'retired' AND retired_at IS NOT NULL "
            "AND retired_at >= registered_at)",
            name="ck_device_telemetry_epochs_retirement",
        ),
        CheckConstraint(_HASH_CHECK, name="ck_device_telemetry_epochs_payload_hash"),
        UniqueConstraint(
            "edge_device_id", "counter_epoch", name="uq_device_telemetry_epochs_counter_epoch"
        ),
        UniqueConstraint(
            "edge_device_id", "generation", name="uq_device_telemetry_epochs_generation"
        ),
        UniqueConstraint("command_id", name="uq_device_telemetry_epochs_command_id"),
        UniqueConstraint(
            "edge_device_id",
            "idempotency_key",
            name="uq_device_telemetry_epochs_idempotency",
        ),
        UniqueConstraint(
            "id",
            "edge_device_id",
            "site_id",
            "classification",
            name="uq_device_telemetry_epochs_identity_scope",
        ),
        UniqueConstraint(
            "id",
            "edge_device_id",
            "site_id",
            "classification",
            "generation",
            name="uq_device_telemetry_epochs_generation_scope",
        ),
        Index(
            "uq_device_telemetry_epochs_active_device",
            "edge_device_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
            sqlite_where=text("status = 'active'"),
        ),
        Index("ix_device_telemetry_epochs_device_registered", "edge_device_id", "registered_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    edge_device_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    counter_epoch: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    generation: Mapped[int] = mapped_column(BigInteger, nullable=False)
    previous_epoch_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    command_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(240), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TelemetryObservation(Base):
    __tablename__ = "telemetry_observations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["site_id", "enterprise_id", "classification"],
            [
                "enterprise_sites.id",
                "enterprise_sites.enterprise_id",
                "enterprise_sites.classification",
            ],
            name="fk_telemetry_observations_site_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["edge_device_id", "site_id", "classification"],
            ["edge_devices.id", "edge_devices.site_id", "edge_devices.classification"],
            name="fk_telemetry_observations_device_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            [
                "telemetry_epoch_id",
                "edge_device_id",
                "site_id",
                "classification",
                "epoch_generation",
            ],
            [
                "device_telemetry_epochs.id",
                "device_telemetry_epochs.edge_device_id",
                "device_telemetry_epochs.site_id",
                "device_telemetry_epochs.classification",
                "device_telemetry_epochs.generation",
            ],
            name="fk_telemetry_observations_epoch_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_telemetry_observations_classification"),
        CheckConstraint(
            "ingest_kind IN ('command', 'migration')",
            name="ck_telemetry_observations_ingest_kind",
        ),
        CheckConstraint(
            "ordering_status IN ('sequenced', 'unsequenced_import')",
            name="ck_telemetry_observations_ordering_status",
        ),
        CheckConstraint(
            "(ingest_kind = 'command' AND ordering_status = 'sequenced' "
            "AND edge_device_id IS NOT NULL AND telemetry_epoch_id IS NOT NULL "
            "AND epoch_generation >= 1 AND sequence >= 0 AND command_id IS NOT NULL "
            "AND idempotency_key IS NOT NULL) OR "
            "(ingest_kind = 'migration' AND ordering_status = 'unsequenced_import' "
            "AND telemetry_epoch_id IS NULL AND epoch_generation IS NULL "
            "AND sequence IS NULL AND command_id IS NULL AND idempotency_key IS NULL "
            "AND became_current = false)",
            name="ck_telemetry_observations_ordering_evidence",
        ),
        CheckConstraint(_HASH_CHECK, name="ck_telemetry_observations_payload_hash"),
        CheckConstraint(
            "payload_json IS NULL OR length(payload_json) <= 65536",
            name="ck_telemetry_observations_payload_size",
        ),
        CheckConstraint(
            "retention_expires_at IS NULL OR retention_expires_at > received_at",
            name="ck_telemetry_observations_retention",
        ),
        CheckConstraint(
            "downsampled_at IS NULL OR downsampled_at >= received_at",
            name="ck_telemetry_observations_downsampled",
        ),
        UniqueConstraint("command_id", name="uq_telemetry_observations_command_id"),
        UniqueConstraint(
            "edge_device_id",
            "idempotency_key",
            name="uq_telemetry_observations_device_idempotency",
        ),
        UniqueConstraint(
            "id",
            "enterprise_id",
            "site_id",
            "classification",
            name="uq_telemetry_observations_enterprise_site_scope",
        ),
        UniqueConstraint(
            "id",
            "edge_device_id",
            "site_id",
            "classification",
            name="uq_telemetry_observations_identity_scope",
        ),
        UniqueConstraint(
            "id",
            "edge_device_id",
            "site_id",
            "classification",
            "epoch_generation",
            "sequence",
            name="uq_telemetry_observations_ordering_scope",
        ),
        Index(
            "uq_telemetry_observations_device_epoch_sequence",
            "edge_device_id",
            "telemetry_epoch_id",
            "sequence",
            unique=True,
            postgresql_where=text("ordering_status = 'sequenced'"),
            sqlite_where=text("ordering_status = 'sequenced'"),
        ),
        Index("ix_telemetry_observations_site_observed", "site_id", "observed_at"),
        Index("ix_telemetry_observations_device_received", "edge_device_id", "received_at"),
        Index("ix_telemetry_observations_retention", "retention_expires_at"),
        Index(
            "ix_telemetry_observations_pending_downsample",
            "classification",
            "received_at",
            "id",
            postgresql_where=text("downsampled_at IS NULL"),
            sqlite_where=text("downsampled_at IS NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    edge_device_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    ingest_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    ordering_status: Mapped[str] = mapped_column(String(30), nullable=False)
    telemetry_epoch_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    epoch_generation: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sequence: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    command_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(240), nullable=True)
    payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    became_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    retention_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    downsampled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TelemetryMetricFact(Base):
    __tablename__ = "telemetry_metric_facts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["telemetry_observation_id", "enterprise_id", "site_id", "classification"],
            [
                "telemetry_observations.id",
                "telemetry_observations.enterprise_id",
                "telemetry_observations.site_id",
                "telemetry_observations.classification",
            ],
            name="fk_telemetry_metric_facts_observation_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["camera_id", "site_id", "classification"],
            ["cameras.id", "cameras.site_id", "cameras.classification"],
            name="fk_telemetry_metric_facts_camera_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_telemetry_metric_facts_classification"),
        CheckConstraint(
            "fact_status IN ('qualified', 'unqualified_import')",
            name="ck_telemetry_metric_facts_status",
        ),
        CheckConstraint(
            "grain IN ('camera', 'site', 'import_unspecified')",
            name="ck_telemetry_metric_facts_grain",
        ),
        CheckConstraint(
            "(grain = 'camera' AND camera_id IS NOT NULL) OR "
            "(grain IN ('site', 'import_unspecified') AND camera_id IS NULL)",
            name="ck_telemetry_metric_facts_camera_grain",
        ),
        CheckConstraint(
            "definition_version >= 1 AND length(trim(definition)) > 0 AND length(trim(unit)) > 0",
            name="ck_telemetry_metric_facts_identity",
        ),
        CheckConstraint(
            "timezone_name = 'Asia/Manila'",
            name="ck_telemetry_metric_facts_timezone",
        ),
        CheckConstraint(
            "(fact_status = 'qualified' AND grain IN ('camera', 'site') "
            "AND metric_window_start IS NOT NULL "
            "AND metric_window_end IS NOT NULL AND metric_window_end > metric_window_start) OR "
            "(fact_status = 'unqualified_import' AND grain = 'import_unspecified' "
            "AND metric_window_start IS NULL "
            "AND metric_window_end IS NULL AND coverage_evidence_status = 'not_recorded')",
            name="ck_telemetry_metric_facts_window_evidence",
        ),
        CheckConstraint(
            "provenance IN ('camera_derived', 'operator_entered', 'system_derived')",
            name="ck_telemetry_metric_facts_provenance",
        ),
        CheckConstraint(
            "quality IN ('confirmed', 'degraded', 'estimated', 'unknown')",
            name="ck_telemetry_metric_facts_quality",
        ),
        CheckConstraint(
            "(quality = 'unknown' AND value IS NULL) OR "
            "(quality != 'unknown' AND value IS NOT NULL AND value >= 0)",
            name="ck_telemetry_metric_facts_value_quality",
        ),
        CheckConstraint(
            "coverage_evidence_status IN ('recorded', 'not_recorded')",
            name="ck_telemetry_metric_facts_coverage_status",
        ),
        CheckConstraint(
            "(coverage_evidence_status = 'not_recorded' AND monitored_seconds IS NULL "
            "AND expected_seconds IS NULL AND coverage_gap_count IS NULL) OR "
            "(coverage_evidence_status = 'recorded' AND monitored_seconds >= 0 "
            "AND expected_seconds > 0 AND monitored_seconds <= expected_seconds "
            "AND coverage_gap_count >= 0)",
            name="ck_telemetry_metric_facts_coverage",
        ),
        CheckConstraint(
            "retention_expires_at IS NULL OR (metric_window_end IS NOT NULL "
            "AND retention_expires_at > metric_window_end)",
            name="ck_telemetry_metric_facts_retention",
        ),
        Index(
            "uq_telemetry_metric_facts_site_definition",
            "telemetry_observation_id",
            "definition",
            "definition_version",
            unique=True,
            postgresql_where=text("grain = 'site'"),
            sqlite_where=text("grain = 'site'"),
        ),
        Index(
            "uq_telemetry_metric_facts_camera_definition",
            "telemetry_observation_id",
            "camera_id",
            "definition",
            "definition_version",
            unique=True,
            postgresql_where=text("grain = 'camera'"),
            sqlite_where=text("grain = 'camera'"),
        ),
        Index(
            "uq_telemetry_metric_facts_import_definition",
            "telemetry_observation_id",
            "definition",
            "definition_version",
            unique=True,
            postgresql_where=text("grain = 'import_unspecified'"),
            sqlite_where=text("grain = 'import_unspecified'"),
        ),
        Index("ix_telemetry_metric_facts_site_window", "site_id", "metric_window_end"),
        Index("ix_telemetry_metric_facts_definition_window", "definition", "metric_window_end"),
        Index("ix_telemetry_metric_facts_retention", "retention_expires_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    telemetry_observation_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    camera_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    fact_status: Mapped[str] = mapped_column(String(30), nullable=False)
    definition: Mapped[str] = mapped_column(String(120), nullable=False)
    definition_version: Mapped[int] = mapped_column(Integer, nullable=False)
    value: Mapped[Decimal | None] = mapped_column(Numeric(20, 6), nullable=True)
    unit: Mapped[str] = mapped_column(String(60), nullable=False)
    grain: Mapped[str] = mapped_column(String(20), nullable=False)
    metric_window_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    metric_window_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    timezone_name: Mapped[str] = mapped_column(String(64), nullable=False)
    provenance: Mapped[str] = mapped_column(String(30), nullable=False)
    quality: Mapped[str] = mapped_column(String(20), nullable=False)
    coverage_evidence_status: Mapped[str] = mapped_column(String(20), nullable=False)
    monitored_seconds: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    expected_seconds: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    coverage_gap_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retention_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SiteTelemetryHourlyRollup(Base):
    """Long-lived, non-live site metric history partitioned by UTC hour in PostgreSQL."""

    __tablename__ = "site_telemetry_hourly_rollups"
    __table_args__ = (
        ForeignKeyConstraint(
            ["site_id", "enterprise_id", "classification"],
            [
                "enterprise_sites.id",
                "enterprise_sites.enterprise_id",
                "enterprise_sites.classification",
            ],
            name="fk_site_telemetry_hourly_rollups_site_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            _CLASSIFICATION_CHECK,
            name="ck_site_telemetry_hourly_rollups_classification",
        ),
        CheckConstraint(
            "definition_version >= 1 AND length(trim(definition)) > 0 AND length(trim(unit)) > 0",
            name="ck_site_telemetry_hourly_rollups_identity",
        ),
        CheckConstraint(
            "provenance IN ('camera_derived', 'operator_entered', 'system_derived')",
            name="ck_site_telemetry_hourly_rollups_provenance",
        ),
        CheckConstraint(
            "(bucket_start AT TIME ZONE 'UTC') = "
            "date_trunc('hour', bucket_start AT TIME ZONE 'UTC') "
            "AND (bucket_end AT TIME ZONE 'UTC') = "
            "(bucket_start AT TIME ZONE 'UTC') + INTERVAL '1 hour' "
            "AND first_observed_at >= bucket_start AND first_observed_at < bucket_end "
            "AND last_observed_at >= first_observed_at AND last_observed_at < bucket_end",
            name="ck_site_telemetry_hourly_rollups_window",
        ).ddl_if(dialect="postgresql"),
        CheckConstraint(
            "sample_count >= 1 AND known_sample_count >= 0 AND unknown_sample_count >= 0 "
            "AND known_sample_count + unknown_sample_count = sample_count",
            name="ck_site_telemetry_hourly_rollups_samples",
        ),
        CheckConstraint(
            "confirmed_sample_count >= 0 AND degraded_sample_count >= 0 "
            "AND estimated_sample_count >= 0 AND unknown_quality_sample_count >= 0 "
            "AND confirmed_sample_count + degraded_sample_count + estimated_sample_count "
            "+ unknown_quality_sample_count = sample_count",
            name="ck_site_telemetry_hourly_rollups_quality_counts",
        ),
        CheckConstraint(
            "(known_sample_count = 0 AND value_sum IS NULL AND value_min IS NULL "
            "AND value_max IS NULL) OR (known_sample_count > 0 AND value_sum IS NOT NULL "
            "AND value_min IS NOT NULL AND value_max IS NOT NULL AND value_min <= value_max)",
            name="ck_site_telemetry_hourly_rollups_values",
        ),
        CheckConstraint(
            "(last_quality = 'unknown' AND last_value IS NULL) OR "
            "(last_quality != 'unknown' AND last_value IS NOT NULL)",
            name="ck_site_telemetry_hourly_rollups_last_value_quality",
        ),
        CheckConstraint(
            "last_quality IN ('confirmed', 'degraded', 'estimated', 'unknown')",
            name="ck_site_telemetry_hourly_rollups_last_quality",
        ),
        CheckConstraint(
            "coverage_sample_count >= 0 AND coverage_sample_count <= sample_count "
            "AND monitored_seconds_sum >= 0 AND expected_seconds_sum >= 0 "
            "AND monitored_seconds_sum <= expected_seconds_sum AND coverage_gap_count_sum >= 0",
            name="ck_site_telemetry_hourly_rollups_coverage",
        ),
        CheckConstraint(
            "rollup_version >= 1",
            name="ck_site_telemetry_hourly_rollups_version",
        ),
        Index(
            "ix_site_telemetry_hourly_rollups_site_bucket",
            "site_id",
            "classification",
            "bucket_start",
        ),
        Index(
            "ix_site_telemetry_hourly_rollups_enterprise_bucket",
            "enterprise_id",
            "classification",
            "bucket_start",
        ),
        Index(
            "ix_site_telemetry_hourly_rollups_definition_bucket",
            "definition",
            "definition_version",
            "bucket_start",
        ),
    )

    bucket_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True, nullable=False
    )
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    classification: Mapped[str] = mapped_column(String(20), primary_key=True)
    definition: Mapped[str] = mapped_column(String(120), primary_key=True)
    definition_version: Mapped[int] = mapped_column(Integer, primary_key=True)
    unit: Mapped[str] = mapped_column(String(60), primary_key=True)
    provenance: Mapped[str] = mapped_column(String(30), primary_key=True)
    bucket_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sample_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    known_sample_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    unknown_sample_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    value_sum: Mapped[Decimal | None] = mapped_column(Numeric(30, 6), nullable=True)
    value_min: Mapped[Decimal | None] = mapped_column(Numeric(20, 6), nullable=True)
    value_max: Mapped[Decimal | None] = mapped_column(Numeric(20, 6), nullable=True)
    last_value: Mapped[Decimal | None] = mapped_column(Numeric(20, 6), nullable=True)
    first_observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_source_observation_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    last_quality: Mapped[str] = mapped_column(String(20), nullable=False)
    confirmed_sample_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    degraded_sample_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    estimated_sample_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    unknown_quality_sample_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    coverage_sample_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    monitored_seconds_sum: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expected_seconds_sum: Mapped[int] = mapped_column(BigInteger, nullable=False)
    coverage_gap_count_sum: Mapped[int] = mapped_column(BigInteger, nullable=False)
    rollup_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DeviceHealthSample(Base):
    __tablename__ = "device_health_samples"
    __table_args__ = (
        ForeignKeyConstraint(
            ["telemetry_observation_id", "edge_device_id", "site_id", "classification"],
            [
                "telemetry_observations.id",
                "telemetry_observations.edge_device_id",
                "telemetry_observations.site_id",
                "telemetry_observations.classification",
            ],
            name="fk_device_health_samples_observation_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_device_health_samples_classification"),
        CheckConstraint(
            "service_state IN ('healthy', 'degraded', 'unavailable', 'unknown')",
            name="ck_device_health_samples_service_state",
        ),
        CheckConstraint(
            "camera_count >= 0 AND streaming_camera_count >= 0 "
            "AND error_camera_count >= 0 AND streaming_camera_count <= camera_count "
            "AND error_camera_count <= camera_count",
            name="ck_device_health_samples_camera_counts",
        ),
        CheckConstraint(
            "analytics_fps IS NULL OR analytics_fps >= 0",
            name="ck_device_health_samples_analytics_fps",
        ),
        CheckConstraint(
            "sync_evidence_status IN ('recorded', 'not_recorded')",
            name="ck_device_health_samples_sync_status",
        ),
        CheckConstraint(
            "(sync_evidence_status = 'not_recorded' AND pending_count IS NULL "
            "AND oldest_pending_at IS NULL AND last_acknowledged_at IS NULL "
            "AND last_failure_at IS NULL AND last_failure_class IS NULL) OR "
            "(sync_evidence_status = 'recorded' AND pending_count >= 0 "
            "AND ((pending_count = 0 AND oldest_pending_at IS NULL) "
            "OR (pending_count > 0 AND oldest_pending_at IS NOT NULL)) "
            "AND ((last_failure_at IS NULL AND last_failure_class IS NULL) "
            "OR (last_failure_at IS NOT NULL AND last_failure_class IS NOT NULL)))",
            name="ck_device_health_samples_sync_evidence",
        ),
        CheckConstraint(
            "health_json IS NULL OR length(health_json) <= 32768",
            name="ck_device_health_samples_payload_size",
        ),
        CheckConstraint(
            "retention_expires_at IS NULL OR retention_expires_at > received_at",
            name="ck_device_health_samples_retention",
        ),
        UniqueConstraint("telemetry_observation_id", name="uq_device_health_samples_observation"),
        Index("ix_device_health_samples_device_observed", "edge_device_id", "observed_at"),
        Index("ix_device_health_samples_retention", "retention_expires_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    telemetry_observation_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    edge_device_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    service_state: Mapped[str] = mapped_column(String(20), nullable=False)
    camera_count: Mapped[int] = mapped_column(Integer, nullable=False)
    streaming_camera_count: Mapped[int] = mapped_column(Integer, nullable=False)
    error_camera_count: Mapped[int] = mapped_column(Integer, nullable=False)
    analytics_fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    sync_evidence_status: Mapped[str] = mapped_column(String(20), nullable=False)
    pending_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    oldest_pending_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failure_class: Mapped[str | None] = mapped_column(String(120), nullable=True)
    health_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    retention_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SiteLiveState(Base):
    __tablename__ = "site_live_state"
    __table_args__ = (
        ForeignKeyConstraint(
            ["site_id", "enterprise_id", "classification"],
            [
                "enterprise_sites.id",
                "enterprise_sites.enterprise_id",
                "enterprise_sites.classification",
            ],
            name="fk_site_live_state_site_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["edge_device_id", "site_id", "classification"],
            ["edge_devices.id", "edge_devices.site_id", "edge_devices.classification"],
            name="fk_site_live_state_device_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            [
                "telemetry_epoch_id",
                "edge_device_id",
                "site_id",
                "classification",
                "epoch_generation",
            ],
            [
                "device_telemetry_epochs.id",
                "device_telemetry_epochs.edge_device_id",
                "device_telemetry_epochs.site_id",
                "device_telemetry_epochs.classification",
                "device_telemetry_epochs.generation",
            ],
            name="fk_site_live_state_epoch_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            [
                "telemetry_observation_id",
                "edge_device_id",
                "site_id",
                "classification",
                "epoch_generation",
                "sequence",
            ],
            [
                "telemetry_observations.id",
                "telemetry_observations.edge_device_id",
                "telemetry_observations.site_id",
                "telemetry_observations.classification",
                "telemetry_observations.epoch_generation",
                "telemetry_observations.sequence",
            ],
            name="fk_site_live_state_observation_ordering_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(_CLASSIFICATION_CHECK, name="ck_site_live_state_classification"),
        CheckConstraint(
            "epoch_generation >= 1 AND sequence >= 0 AND live_state_version >= 1",
            name="ck_site_live_state_ordering",
        ),
        CheckConstraint(
            "freshness_state IN ('fresh', 'stale', 'offline')",
            name="ck_site_live_state_freshness",
        ),
        CheckConstraint(
            "freshness_expires_at > received_at AND offline_after_at > freshness_expires_at",
            name="ck_site_live_state_freshness_deadlines",
        ),
        CheckConstraint(
            "last_freshness_evaluated_at >= received_at",
            name="ck_site_live_state_freshness_evaluation",
        ),
        CheckConstraint(
            "current_occupancy IS NULL OR current_occupancy >= 0",
            name="ck_site_live_state_current_occupancy",
        ),
        CheckConstraint(
            "entries_window IS NULL OR entries_window >= 0",
            name="ck_site_live_state_entries",
        ),
        CheckConstraint(
            "exits_window IS NULL OR exits_window >= 0",
            name="ck_site_live_state_exits",
        ),
        CheckConstraint(
            "peak_occupancy_window IS NULL OR peak_occupancy_window >= 0",
            name="ck_site_live_state_peak",
        ),
        CheckConstraint(
            "unique_visitor_estimate_window IS NULL OR unique_visitor_estimate_window >= 0",
            name="ck_site_live_state_unique_estimate",
        ),
        CheckConstraint(
            "freshness_state = 'fresh' OR "
            "(current_occupancy IS NULL AND entries_window IS NULL AND exits_window IS NULL "
            "AND peak_occupancy_window IS NULL AND unique_visitor_estimate_window IS NULL)",
            name="ck_site_live_state_stale_metrics",
        ),
        CheckConstraint(
            "metric_quality IN ('confirmed', 'degraded', 'estimated', 'unknown')",
            name="ck_site_live_state_metric_quality",
        ),
        CheckConstraint(
            "metric_provenance IN ('camera_derived', 'operator_entered', 'system_derived')",
            name="ck_site_live_state_metric_provenance",
        ),
        CheckConstraint(
            "freshness_state = 'fresh' OR metric_quality = 'unknown'",
            name="ck_site_live_state_stale_quality",
        ),
        CheckConstraint(
            "metric_quality != 'unknown' OR "
            "(current_occupancy IS NULL AND entries_window IS NULL AND exits_window IS NULL "
            "AND peak_occupancy_window IS NULL AND unique_visitor_estimate_window IS NULL)",
            name="ck_site_live_state_unknown_metrics",
        ),
        CheckConstraint(
            "(metric_window_start IS NULL AND metric_window_end IS NULL) OR "
            "(metric_window_start IS NOT NULL AND metric_window_end IS NOT NULL "
            "AND metric_window_end > metric_window_start)",
            name="ck_site_live_state_metric_window",
        ),
        CheckConstraint(
            "coverage_evidence_status IN ('recorded', 'not_recorded')",
            name="ck_site_live_state_coverage_status",
        ),
        CheckConstraint(
            "(coverage_evidence_status = 'not_recorded' AND monitored_seconds IS NULL "
            "AND expected_seconds IS NULL AND coverage_gap_count IS NULL) OR "
            "(coverage_evidence_status = 'recorded' AND monitored_seconds >= 0 "
            "AND expected_seconds > 0 AND monitored_seconds <= expected_seconds "
            "AND coverage_gap_count >= 0)",
            name="ck_site_live_state_coverage",
        ),
        CheckConstraint(
            "pending_count IS NULL OR (pending_count >= 0 "
            "AND ((pending_count = 0 AND oldest_pending_at IS NULL) "
            "OR (pending_count > 0 AND oldest_pending_at IS NOT NULL)))",
            name="ck_site_live_state_sync_backlog",
        ),
        CheckConstraint(
            "(last_failure_at IS NULL AND last_failure_class IS NULL) OR "
            "(last_failure_at IS NOT NULL AND last_failure_class IS NOT NULL)",
            name="ck_site_live_state_sync_failure",
        ),
        CheckConstraint(
            "service_state IN ('healthy', 'degraded', 'unavailable', 'unknown')",
            name="ck_site_live_state_service_state",
        ),
        Index("ix_site_live_state_enterprise", "enterprise_id"),
        Index("ix_site_live_state_freshness", "classification", "freshness_state"),
        Index("ix_site_live_state_offline_after", "offline_after_at"),
    )

    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    edge_device_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    telemetry_epoch_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    telemetry_observation_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    epoch_generation: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    live_state_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    freshness_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    offline_after_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_freshness_evaluated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    freshness_state: Mapped[str] = mapped_column(String(20), nullable=False)
    current_occupancy: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    entries_window: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    exits_window: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    peak_occupancy_window: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    unique_visitor_estimate_window: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    metric_window_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    metric_window_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    metric_quality: Mapped[str] = mapped_column(String(20), nullable=False)
    metric_provenance: Mapped[str] = mapped_column(String(30), nullable=False)
    coverage_evidence_status: Mapped[str] = mapped_column(String(20), nullable=False)
    monitored_seconds: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    expected_seconds: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    coverage_gap_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    service_state: Mapped[str] = mapped_column(String(20), nullable=False)
    pending_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    oldest_pending_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failure_class: Mapped[str | None] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
