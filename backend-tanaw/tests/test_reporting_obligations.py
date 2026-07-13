from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.features.reporting.models import ReportingPeriod
from app.features.reporting.obligation_envelopes import ObligationFreezeCommand
from app.features.reporting.obligations import (
    compliance_status,
    derive_eligibility,
    reminder_phase,
)


@pytest.mark.parametrize(
    ("lifecycle", "barangay", "overlap", "status", "blocked"),
    [
        ("active", "Barangay Uno", False, "eligible", False),
        ("inactive", "Barangay Uno", False, "ineligible", False),
        ("retired", "Barangay Uno", False, "ineligible", False),
        ("active", None, False, "unknown", True),
        ("active", "Barangay Uno", True, "unknown", True),
    ],
)
def test_eligibility_derivation_is_explicit_and_fail_closed(
    lifecycle: str,
    barangay: str | None,
    overlap: bool,
    status: str,
    blocked: bool,
) -> None:
    decision = derive_eligibility(
        enterprise_lifecycle_state=lifecycle,
        frozen_barangay=barangay,
        overlapping_site_versions=overlap,
    )

    assert decision.status == status
    assert decision.acceptance_blocked is blocked
    assert (decision.reason is not None) is (status != "eligible")


def test_reminder_phase_uses_immutable_period_boundaries() -> None:
    starts_at = datetime(2026, 5, 31, 16, tzinfo=UTC)
    opens_at = datetime(2026, 6, 30, 16, tzinfo=UTC)
    period = cast(
        ReportingPeriod,
        SimpleNamespace(starts_at=starts_at, submission_opens_at=opens_at),
    )

    assert reminder_phase(period, as_of=starts_at.replace(microsecond=0)) == "current_period"
    assert reminder_phase(period, as_of=starts_at.replace(year=2025)) == "pre_window"
    assert reminder_phase(period, as_of=opens_at) == "overdue"


@pytest.mark.parametrize(
    ("eligibility", "workflow", "expected"),
    [
        ("eligible", None, "not_submitted"),
        ("eligible", "submitted", "submitted"),
        ("eligible", "returned", "returned"),
        ("eligible", "accepted", "accepted"),
        ("eligible", "consolidated", "consolidated"),
        ("exempt", None, None),
        ("ineligible", None, None),
        ("unknown", None, None),
    ],
)
def test_compliance_projection_separates_eligibility_from_workflow(
    eligibility: str,
    workflow: str | None,
    expected: str | None,
) -> None:
    assert compliance_status(eligibility_status=eligibility, workflow_state=workflow) == expected


def test_freeze_command_requires_reasoned_unique_manual_resolutions() -> None:
    site_id = str(uuid4())
    base = {
        "contractVersion": 2,
        "commandId": str(uuid4()),
        "resolutions": [
            {
                "siteId": site_id,
                "eligibilityStatus": "exempt",
                "reason": "Seasonal closure",
            }
        ],
    }
    command = ObligationFreezeCommand.model_validate(base)
    assert command.resolutions[0].reason == "Seasonal closure"

    with pytest.raises(ValidationError, match="appear only once"):
        ObligationFreezeCommand.model_validate(
            {
                "contractVersion": 2,
                "commandId": str(uuid4()),
                "resolutions": [
                    {
                        "siteId": site_id,
                        "eligibilityStatus": "exempt",
                        "reason": "Seasonal closure",
                    },
                    {
                        "siteId": site_id,
                        "eligibilityStatus": "ineligible",
                        "reason": "Registration invalid",
                    },
                ],
            }
        )
    with pytest.raises(ValidationError, match="require a reason"):
        ObligationFreezeCommand.model_validate(
            {
                **base,
                "resolutions": [
                    {
                        "siteId": site_id,
                        "eligibilityStatus": "ineligible",
                    }
                ],
            }
        )
    with pytest.raises(ValidationError, match="require a frozen barangay"):
        ObligationFreezeCommand.model_validate(
            {
                **base,
                "resolutions": [
                    {
                        "siteId": site_id,
                        "eligibilityStatus": "eligible",
                    }
                ],
            }
        )
