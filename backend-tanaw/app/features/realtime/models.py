from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class RealtimeOutbox(Base):
    __tablename__ = "realtime_outbox"
    __table_args__ = (
        CheckConstraint("schema_version = 1", name="ck_realtime_outbox_schema_version"),
        CheckConstraint("attempt_count >= 0", name="ck_realtime_outbox_attempt_count"),
        Index("ix_realtime_outbox_pending", "published_at", "sequence"),
        Index(
            "uq_realtime_outbox_pending_coalesce",
            "coalesce_key",
            unique=True,
            postgresql_where=text("published_at IS NULL AND coalesce_key IS NOT NULL"),
        ),
    )

    sequence: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(
        String(36), unique=True, nullable=False, server_default=text("gen_random_uuid()::text")
    )
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    scope: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    actor: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    audience_roles: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    coalesce_key: Mapped[str | None] = mapped_column(String(160), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(String(1000), nullable=True)
