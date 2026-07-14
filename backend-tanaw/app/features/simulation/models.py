from datetime import datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class MockDataRun(Base):
    __tablename__ = "mock_data_runs"
    __table_args__ = (
        CheckConstraint("range_end > range_start", name="ck_mock_data_runs_range"),
        CheckConstraint("status IN ('active', 'removed')", name="ck_mock_data_runs_status"),
        CheckConstraint(
            "(status = 'active' AND ended_at IS NULL) OR "
            "(status = 'removed' AND ended_at IS NOT NULL)",
            name="ck_mock_data_runs_lifecycle",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    scenario: Mapped[str] = mapped_column(String(80), nullable=False)
    seed: Mapped[str] = mapped_column(String(80), nullable=False)
    range_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    range_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    target_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    target_enterprise_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    target_enterprise_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="active")
    generated_counts_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MockDataRunAccount(Base):
    __tablename__ = "mock_data_run_accounts"
    __table_args__ = (Index("ix_mock_data_run_accounts_account_id", "account_id"),)

    run_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("mock_data_runs.id", ondelete="CASCADE"), primary_key=True
    )
    account_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
