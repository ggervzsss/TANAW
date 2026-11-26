from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import DateTime, String, Text, event, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.request_context import current_request_context
from app.db.session import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    activity_group: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    actor: Mapped[str] = mapped_column(String(120), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    target: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    it_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


@event.listens_for(ActivityLog, "init")
def _capture_request_context(target: ActivityLog, args: Any, kwargs: dict[str, Any]) -> None:
    """Fill in who made the HTTP request this activity was recorded during, when not given."""
    context = current_request_context()
    kwargs.setdefault("ip_address", context.ip_address)
    kwargs.setdefault("user_agent", context.user_agent)
    kwargs.setdefault("session_id", context.session_id)
