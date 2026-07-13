from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DomainEvent(Base):
    __tablename__ = "domain_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["enterprise_id", "classification"],
            ["enterprises.id", "enterprises.classification"],
            name="fk_domain_events_enterprise_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["site_id", "enterprise_id", "classification"],
            [
                "enterprise_sites.id",
                "enterprise_sites.enterprise_id",
                "enterprise_sites.classification",
            ],
            name="fk_domain_events_site_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "classification IN ('official', 'simulation')",
            name="ck_domain_events_classification",
        ),
        CheckConstraint(
            "site_id IS NULL OR enterprise_id IS NOT NULL",
            name="ck_domain_events_site_enterprise",
        ),
        CheckConstraint("contract_version = 2", name="ck_domain_events_contract_version"),
        CheckConstraint("schema_version >= 1", name="ck_domain_events_schema_version"),
        CheckConstraint("aggregate_version >= 1", name="ck_domain_events_aggregate_version"),
        CheckConstraint(
            "length(payload_hash) = 71 AND payload_hash LIKE 'sha256:%'",
            name="ck_domain_events_payload_hash",
        ),
        CheckConstraint(
            "length(payload_json) <= 65536",
            name="ck_domain_events_payload_size",
        ),
        CheckConstraint(
            "retention_expires_at IS NULL OR retention_expires_at > recorded_at",
            name="ck_domain_events_retention",
        ),
        UniqueConstraint("event_key", name="uq_domain_events_event_key"),
        Index(
            "ix_domain_events_aggregate_version",
            "aggregate_type",
            "aggregate_id",
            "aggregate_version",
        ),
        Index("ix_domain_events_available", "available_at", "recorded_at"),
        Index("ix_domain_events_retention", "retention_expires_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    event_key: Mapped[str] = mapped_column(String(240), nullable=False)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    contract_version: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    aggregate_type: Mapped[str] = mapped_column(String(80), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    aggregate_version: Mapped[int] = mapped_column(Integer, nullable=False)
    enterprise_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    site_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
    correlation_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    causation_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    retention_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class DomainEventDelivery(Base):
    __tablename__ = "domain_event_deliveries"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'leased', 'retry_scheduled', 'delivered', 'dead_letter')",
            name="ck_domain_event_deliveries_status",
        ),
        CheckConstraint("attempt_count >= 0", name="ck_domain_event_deliveries_attempt_count"),
        CheckConstraint(
            "(status = 'leased' AND lock_token IS NOT NULL AND locked_at IS NOT NULL "
            "AND lock_expires_at IS NOT NULL AND lock_expires_at > locked_at) OR "
            "(status != 'leased' AND lock_token IS NULL AND locked_at IS NULL "
            "AND lock_expires_at IS NULL)",
            name="ck_domain_event_deliveries_lease",
        ),
        CheckConstraint(
            "(status = 'delivered' AND delivered_at IS NOT NULL) OR "
            "(status != 'delivered' AND delivered_at IS NULL)",
            name="ck_domain_event_deliveries_delivered",
        ),
        CheckConstraint(
            "(status = 'dead_letter' AND dead_lettered_at IS NOT NULL) OR "
            "(status != 'dead_letter' AND dead_lettered_at IS NULL)",
            name="ck_domain_event_deliveries_dead_letter",
        ),
        UniqueConstraint(
            "domain_event_id", "destination", name="uq_domain_event_deliveries_destination"
        ),
        UniqueConstraint("id", "domain_event_id", name="uq_domain_event_deliveries_identity_event"),
        Index(
            "ix_domain_event_deliveries_ready",
            "next_attempt_at",
            "created_at",
            postgresql_where=text("status IN ('pending', 'retry_scheduled')"),
            sqlite_where=text("status IN ('pending', 'retry_scheduled')"),
        ),
        Index("ix_domain_event_deliveries_lease_expiry", "lock_expires_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    domain_event_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("domain_events.id", ondelete="RESTRICT"),
        nullable=False,
    )
    destination: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lock_token: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lock_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dead_lettered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DomainEventDeliveryAttempt(Base):
    __tablename__ = "domain_event_delivery_attempts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["domain_event_delivery_id", "domain_event_id"],
            ["domain_event_deliveries.id", "domain_event_deliveries.domain_event_id"],
            name="fk_domain_event_delivery_attempts_delivery_event",
            ondelete="RESTRICT",
        ),
        CheckConstraint("attempt_number >= 1", name="ck_domain_event_delivery_attempts_number"),
        CheckConstraint(
            "outcome IN ('succeeded', 'retryable_failure', 'terminal_failure')",
            name="ck_domain_event_delivery_attempts_outcome",
        ),
        CheckConstraint(
            "completed_at >= started_at",
            name="ck_domain_event_delivery_attempts_duration",
        ),
        CheckConstraint(
            "(outcome = 'succeeded' AND error_code IS NULL AND error_message IS NULL) OR "
            "(outcome != 'succeeded' AND error_code IS NOT NULL)",
            name="ck_domain_event_delivery_attempts_error",
        ),
        UniqueConstraint(
            "domain_event_delivery_id",
            "attempt_number",
            name="uq_domain_event_delivery_attempts_number",
        ),
        Index("ix_domain_event_delivery_attempts_event", "domain_event_id", "started_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    domain_event_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    domain_event_delivery_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    worker_id: Mapped[str] = mapped_column(String(120), nullable=False)
    outcome: Mapped[str] = mapped_column(String(30), nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DomainEventConsumerReceipt(Base):
    __tablename__ = "domain_event_consumer_receipts"
    __table_args__ = (
        CheckConstraint(
            "disposition IN ('applied', 'already_applied', 'ignored')",
            name="ck_domain_event_consumer_receipts_disposition",
        ),
        CheckConstraint(
            "length(event_payload_hash) = 71 AND event_payload_hash LIKE 'sha256:%'",
            name="ck_domain_event_consumer_receipts_hash",
        ),
        UniqueConstraint(
            "domain_event_id",
            "consumer_name",
            name="uq_domain_event_consumer_receipts_consumer",
        ),
        Index("ix_domain_event_consumer_receipts_consumed", "consumer_name", "consumed_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    domain_event_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("domain_events.id", ondelete="RESTRICT"),
        nullable=False,
    )
    consumer_name: Mapped[str] = mapped_column(String(120), nullable=False)
    disposition: Mapped[str] = mapped_column(String(30), nullable=False)
    event_payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    consumed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    result_reference: Mapped[str | None] = mapped_column(String(240), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
