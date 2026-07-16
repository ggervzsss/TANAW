import asyncio
from unittest.mock import AsyncMock

import pytest

from app.core.config import Settings
from app.features.reporting import runtime


@pytest.fixture(autouse=True)
def reset_reporting_period_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime, "_worker_task", None)
    monkeypatch.setattr(runtime, "_worker_stop_event", None)


@pytest.mark.asyncio
async def test_reporting_period_worker_reconciles_immediately_and_stops_cleanly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reconcile = AsyncMock(return_value=None)
    monkeypatch.setattr(runtime, "run_reporting_period_lifecycle_now", reconcile)
    settings = Settings(reporting_period_lifecycle_interval_seconds=3600)

    await runtime.start_reporting_period_lifecycle_worker(settings)
    await asyncio.sleep(0)

    assert runtime.reporting_period_lifecycle_worker_ready() is True
    reconcile.assert_awaited_once_with()

    await runtime.stop_reporting_period_lifecycle_worker()

    assert runtime.reporting_period_lifecycle_worker_ready() is False
