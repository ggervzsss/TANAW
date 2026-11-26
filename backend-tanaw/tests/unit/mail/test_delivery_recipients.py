from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import postgresql

from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.mail import router as mail_router
from app.features.mail.models import EmailOutboxStatus
from app.features.mail.router import to_email_delivery_summary
from app.features.mail.service import list_email_outbox
from tests.unit.mail.test_email_outbox import outbox_record


def _account(role: AccountRole) -> Account:
    account = Account(
        id="account-1",
        email="user@example.com",
        password_hash="hash",
        role=role,
        display_name="Laguna Heritage Park" if role == AccountRole.ENTERPRISE else "Maria Santos",
        title="Title",
        status=AccountStatus.ACTIVE,
    )
    if role == AccountRole.ENTERPRISE:
        account.enterprise_profile = EnterpriseProfile(
            account_id="account-1",
            enterprise_id="laguna_heritage_park_001@tanaw.sanpedro",
            enterprise_name="Laguna Heritage Park",
            attraction_code="411",
            manager_name="Ana Cruz",
            barangay="Poblacion",
        )
    return account


@pytest.mark.parametrize(
    ("role", "name", "label"),
    (
        (AccountRole.ENTERPRISE, "Laguna Heritage Park", "Enterprise Account"),
        (AccountRole.STAFF, "Maria Santos", "LGU Staff"),
        (AccountRole.IT, "Maria Santos", "IT Personnel"),
        (AccountRole.ADMIN, "Maria Santos", "Admin"),
    ),
)
def test_delivery_names_the_account_it_was_sent_to(
    role: AccountRole, name: str, label: str
) -> None:
    summary = to_email_delivery_summary(
        outbox_record(status=EmailOutboxStatus.ACCEPTED), _account(role)
    )

    assert summary.accountId == "account-1"
    assert summary.recipientName == name
    assert summary.recipientRole == label


def test_delivery_without_a_known_account_has_no_recipient_name() -> None:
    summary = to_email_delivery_summary(outbox_record(status=EmailOutboxStatus.ACCEPTED))

    assert summary.accountId == "account-1"
    assert summary.recipientName is None
    assert summary.recipientRole is None


@pytest.mark.asyncio
async def test_delivery_list_can_be_limited_to_recent_days() -> None:
    db = MagicMock()
    db.scalars = AsyncMock(return_value=[])
    since = datetime.now(UTC) - timedelta(days=7)

    await list_email_outbox(db, limit=50, created_since=since)
    await list_email_outbox(db, limit=50)

    recent_sql = str(db.scalars.await_args_list[0].args[0].compile(dialect=postgresql.dialect()))
    all_sql = str(db.scalars.await_args_list[1].args[0].compile(dialect=postgresql.dialect()))
    assert "email_outbox.created_at >=" in recent_sql
    assert "email_outbox.created_at >=" not in all_sql


@pytest.mark.asyncio
async def test_delivery_list_endpoint_resolves_recipients_in_one_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = outbox_record(status=EmailOutboxStatus.ACCEPTED)
    list_outbox = AsyncMock(return_value=[record, record])
    monkeypatch.setattr(mail_router, "list_email_outbox", list_outbox)
    db = MagicMock()
    db.scalars = AsyncMock(return_value=[_account(AccountRole.STAFF)])

    summaries = await mail_router.list_email_deliveries(MagicMock(), db, 250, 7)

    created_since = list_outbox.await_args.kwargs["created_since"]  # type: ignore[union-attr]
    assert created_since is not None
    assert datetime.now(UTC) - created_since >= timedelta(days=7)
    assert [summary.recipientName for summary in summaries] == ["Maria Santos"] * 2
    db.scalars.assert_awaited_once()
