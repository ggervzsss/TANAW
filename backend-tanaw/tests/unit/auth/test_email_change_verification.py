from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.accounts.models import AccountRole
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.auth import activation_router
from app.features.auth.email_change import AccountEmailChangeVerificationDetails
from app.features.auth.schemas import AccountEmailChangeVerifyRequest


@pytest.mark.parametrize(
    ("account_role", "activity_role"),
    [
        (AccountRole.ADMIN, "Admin"),
        (AccountRole.IT, "IT Personnel"),
        (AccountRole.STAFF, "LGU Staff"),
        (AccountRole.ENTERPRISE, "Enterprise Account"),
    ],
)
@pytest.mark.asyncio
async def test_email_change_verification_records_a_valid_activity_role(
    monkeypatch: pytest.MonkeyPatch,
    account_role: AccountRole,
    activity_role: str,
) -> None:
    verification = AccountEmailChangeVerificationDetails(
        account_id="account-1",
        account_role=account_role,
        display_name="TANAW Account",
        requested_email="new-email@example.com",
        status="verified",
    )
    verify_email_change = AsyncMock(return_value=verification)

    async def validate_activity_log(*_args: object, **kwargs: object) -> None:
        ActivityLogCreate.model_validate(
            {
                "category": kwargs["category"],
                "severity": kwargs["severity"],
                "actor": kwargs["actor"],
                "actorRole": kwargs["actor_role"],
                "action": kwargs["action"],
                "target": kwargs["target"],
                "summary": kwargs["summary"],
                "sourceId": kwargs["source_id"],
            }
        )

    record_auth_log = AsyncMock(side_effect=validate_activity_log)
    monkeypatch.setattr(
        activation_router,
        "verify_account_email_change",
        verify_email_change,
    )
    monkeypatch.setattr(activation_router, "record_auth_log", record_auth_log)

    response = await activation_router.verify_email_change_link(
        AccountEmailChangeVerifyRequest(token="valid-verification-token"),
        MagicMock(),
    )

    assert response.status == "verified"
    assert record_auth_log.await_args is not None
    assert record_auth_log.await_args.kwargs["actor_role"] == activity_role
