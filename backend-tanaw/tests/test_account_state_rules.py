from datetime import UTC, datetime

import pytest
from fastapi import HTTPException

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.router import ensure_account_can_deactivate
from app.features.accounts.schemas import LguAccountCreate


def _account(*, activated: bool) -> Account:
    return Account(
        id="account-id",
        email="account@example.com",
        password_hash="hash",
        role=AccountRole.STAFF,
        display_name="Test Account",
        title="LGU Staff",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC) if activated else None,
    )


def test_lgu_contact_number_is_optional_and_normalized_when_present() -> None:
    without_phone = LguAccountCreate(
        firstName="Test",
        lastName="User",
        email="test@example.com",
        role="staff",
    )
    with_phone = LguAccountCreate(
        firstName="Test",
        lastName="User",
        email="test@example.com",
        phone="0918 123 4567",
        role="staff",
    )

    assert without_phone.phone is None
    assert with_phone.phone == "+639181234567"


def test_pending_account_cannot_be_deactivated() -> None:
    with pytest.raises(HTTPException) as raised:
        ensure_account_can_deactivate(_account(activated=False), AccountStatus.INACTIVE)

    assert raised.value.status_code == 409
    assert raised.value.detail == {
        "code": "account_activation_pending",
        "message": "This account has not completed activation and cannot be deactivated.",
    }


def test_activated_account_can_be_deactivated() -> None:
    ensure_account_can_deactivate(_account(activated=True), AccountStatus.INACTIVE)
