from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.activity_logs.service import (
    LOG_RETENTION_DAYS,
    activity_log_retention_cutoff,
    purge_expired_activity_logs,
    resolve_activity_log_retention_days,
)


def test_log_retention_defaults_to_180_days() -> None:
    assert resolve_activity_log_retention_days({}) == LOG_RETENTION_DAYS


def test_log_retention_uses_stable_numeric_setting() -> None:
    assert resolve_activity_log_retention_days({"logs.retentionDays": 90}) == 90


def test_log_retention_migrates_valid_legacy_label_value() -> None:
    assert resolve_activity_log_retention_days({"logs.Log Retention Period": "365 days"}) == 365


def test_log_retention_ignores_invalid_values() -> None:
    assert resolve_activity_log_retention_days({"logs.retentionDays": "90"}) == LOG_RETENTION_DAYS
    assert resolve_activity_log_retention_days({"logs.retentionDays": True}) == LOG_RETENTION_DAYS
    assert (
        resolve_activity_log_retention_days({"logs.Log Retention Period": "30 days"})
        == LOG_RETENTION_DAYS
    )


def test_log_retention_cutoff_uses_selected_days() -> None:
    now = datetime(2026, 7, 3, 12, 0, tzinfo=UTC)

    assert activity_log_retention_cutoff(90, now) == datetime(2026, 4, 4, 12, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_purge_expired_activity_logs_deletes_before_cutoff_and_commits() -> None:
    fake_db = _FakeAsyncSession(rowcount=4)

    deleted_count = await purge_expired_activity_logs(
        cast(AsyncSession, fake_db),
        retention_days=90,
        now=datetime(2026, 7, 3, tzinfo=UTC),
    )

    assert deleted_count == 4
    assert fake_db.committed is True
    assert fake_db.statement is not None
    statement_text = str(fake_db.statement)
    assert "DELETE FROM activity_logs" in statement_text
    assert "activity_logs.timestamp <" in statement_text


class _DeleteResult:
    def __init__(self, rowcount: int | None) -> None:
        self.rowcount = rowcount


class _FakeAsyncSession:
    def __init__(self, rowcount: int | None) -> None:
        self.committed = False
        self.rowcount = rowcount
        self.statement: object | None = None

    async def execute(self, statement: object) -> _DeleteResult:
        self.statement = statement
        return _DeleteResult(self.rowcount)

    async def commit(self) -> None:
        self.committed = True
