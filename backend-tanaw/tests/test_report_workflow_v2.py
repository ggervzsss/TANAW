from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.features.reporting.workflow_envelopes import ReportTransitionCommand


def test_return_and_reopen_commands_require_a_reason() -> None:
    for action in ("return_for_correction", "reopen_before_finalization"):
        payload = _command(action)
        payload["reason"] = "  "
        with pytest.raises(ValidationError, match="reason is required"):
            ReportTransitionCommand.model_validate(payload)


def test_accept_command_normalizes_an_optional_note() -> None:
    payload = deepcopy(_command("accept_revision"))
    payload["reason"] = "  Evidence reviewed  "

    command = ReportTransitionCommand.model_validate(payload)

    assert command.reason == "Evidence reviewed"


def _command(action: str) -> dict[str, object]:
    return {
        "contractVersion": 2,
        "commandId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "expectedVersion": 1,
        "action": action,
        "reason": "Correction needed",
    }
