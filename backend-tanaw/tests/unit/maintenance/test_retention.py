from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.config import Settings
from app.features.maintenance import retention


@pytest.mark.asyncio
async def test_retention_cleanup_uses_configured_telemetry_boundary_and_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 9, 1, 12, tzinfo=UTC)
    telemetry_cleanup = AsyncMock(return_value=7)
    monkeypatch.setattr(retention, "_delete_telemetry_snapshots", telemetry_cleanup)
    for helper_name in (
        "_delete_activation_tokens",
        "_delete_password_reset_challenges",
        "_delete_password_reset_rate_buckets",
        "_expire_email_change_requests",
        "_delete_email_change_requests",
        "_delete_email_outbox_records",
    ):
        monkeypatch.setattr(retention, helper_name, AsyncMock(return_value=0))

    session_factory = MagicMock()
    counts = await retention.run_retention_cleanup(
        Settings(
            telemetry_raw_retention_days=60,
            telemetry_retention_batch_size=2_000,
        ),
        now=now,
        session_factory=session_factory,
    )

    telemetry_cleanup.assert_awaited_once_with(
        session_factory,
        cutoff=now - timedelta(days=60),
        batch_size=2_000,
    )
    assert counts.telemetry_snapshots == 7
    assert counts.deleted_records == 7
