from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.models import ActivityLog
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log, list_activity_logs_for_account
from app.features.events.models import DomainEvent, DomainEventDelivery


def _payload(**extra: object) -> dict[str, object]:
    return {
        "category": "System",
        "severity": "Info",
        "actor": "Recorded Actor",
        "actorRole": "System",
        "action": "Record Target Event",
        "target": "Operational audit",
        "summary": "Server-owned activity classification.",
        **extra,
    }


@pytest.mark.parametrize("field", ("sourceKind", "mockRunId", "classification"))
def test_activity_log_command_rejects_client_classification(field: str) -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ActivityLogCreate.model_validate(_payload(**{field: "simulation"}))


@pytest.mark.asyncio
async def test_activity_log_creation_assigns_official_classification() -> None:
    db = MagicMock()
    db.flush = AsyncMock()

    async def refresh(log: ActivityLog) -> None:
        log.id = str(uuid4())
        log.timestamp = datetime.now(UTC)

    db.refresh = AsyncMock(side_effect=refresh)

    await create_activity_log(db, ActivityLogCreate.model_validate(_payload()))

    added = [call.args[0] for call in db.add.call_args_list]
    log = next(item for item in added if isinstance(item, ActivityLog))
    event = next(item for item in added if isinstance(item, DomainEvent))
    delivery = next(item for item in added if isinstance(item, DomainEventDelivery))
    assert isinstance(log, ActivityLog)
    assert log.classification == "official"
    assert log.simulation_run_id is None
    assert event.event_type == "activity_log.created.v2"
    assert event.aggregate_id == log.id
    assert delivery.domain_event_id == event.id
    assert delivery.destination == "realtime_broadcast"


@pytest.mark.asyncio
async def test_activity_log_read_is_database_scoped_to_official() -> None:
    db = MagicMock()
    db.scalar = AsyncMock(return_value=None)
    scalar_result = MagicMock()
    scalar_result.all.return_value = []
    db.scalars = AsyncMock(return_value=scalar_result)
    account = MagicMock(spec=Account)
    account.id = uuid4()
    account.role = AccountRole.IT

    await list_activity_logs_for_account(db, account, limit=100, cursor=None)

    statement = db.scalars.await_args.args[0]
    assert "activity_logs.classification = :classification_1" in str(statement.whereclause)
    assert statement.compile().params["classification_1"] == "official"
