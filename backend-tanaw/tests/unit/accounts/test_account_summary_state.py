from datetime import UTC, datetime, timedelta

from app.features.accounts.models import (
    Account,
    AccountEmailChangeRequest,
    AccountEmailChangeStatus,
    AccountRole,
    AccountStatus,
)
from app.features.accounts.service import to_account_invitation, to_account_summary
from app.features.auth.models import AccountActivationToken

NOW = datetime(2026, 11, 20, 4, 0, tzinfo=UTC)


def _account(
    *,
    account_id: str = "account-1",
    activated: bool = True,
    status: AccountStatus = AccountStatus.ACTIVE,
) -> Account:
    return Account(
        id=account_id,
        email=f"{account_id}@example.com",
        password_hash="hash",
        role=AccountRole.STAFF,
        display_name="Maria Santos",
        title="LGU Staff",
        status=status,
        is_protected_system_account=False,
        activated_at=NOW if activated else None,
        created_at=NOW - timedelta(days=3),
        last_login_at=None,
    )


def _token(
    *,
    created_at: datetime,
    expires_at: datetime,
    invalidated_at: datetime | None = None,
) -> AccountActivationToken:
    return AccountActivationToken(
        id="token-1",
        account_id="account-1",
        token_hash="hash",
        created_at=created_at,
        expires_at=expires_at,
        invalidated_at=invalidated_at,
        consumed_at=None,
    )


def _email_change(*, requested_by: str | None) -> AccountEmailChangeRequest:
    return AccountEmailChangeRequest(
        id="email-change-1",
        account_id="account-1",
        old_email="account-1@example.com",
        requested_email="maria.new@example.com",
        status=AccountEmailChangeStatus.VERIFIED.value,
        expires_at=datetime.now(UTC) + timedelta(hours=2),
        requested_by_account_id=requested_by,
        requested_by_name="Jose Reyes",
        requested_by_role="IT Personnel",
        created_at=datetime.now(UTC) - timedelta(minutes=5),
    )


def test_invitation_describes_the_newest_activation_link_of_a_pending_account() -> None:
    account = _account(activated=False)
    token = _token(created_at=NOW - timedelta(hours=1), expires_at=NOW + timedelta(hours=23))

    invitation = to_account_invitation(account, token, now=NOW)

    assert invitation is not None
    assert invitation.sentAt == NOW - timedelta(hours=1)
    assert invitation.expiresAt == NOW + timedelta(hours=23)
    assert invitation.expired is False


def test_invitation_is_expired_after_its_deadline_or_once_replaced() -> None:
    account = _account(activated=False)
    lapsed = _token(created_at=NOW - timedelta(days=2), expires_at=NOW - timedelta(days=1))
    replaced = _token(
        created_at=NOW - timedelta(hours=1),
        expires_at=NOW + timedelta(hours=23),
        invalidated_at=NOW,
    )

    lapsed_invitation = to_account_invitation(account, lapsed, now=NOW)
    replaced_invitation = to_account_invitation(account, replaced, now=NOW)

    assert lapsed_invitation is not None and lapsed_invitation.expired is True
    assert replaced_invitation is not None and replaced_invitation.expired is True


def test_activated_accounts_have_no_invitation() -> None:
    account = _account(activated=True)
    token = _token(created_at=NOW - timedelta(hours=1), expires_at=NOW + timedelta(hours=23))

    assert to_account_invitation(account, token, now=NOW) is None
    assert to_account_summary(account, activation_token=token).invitation is None


def test_summary_reports_who_deactivated_the_account_and_when() -> None:
    account = _account(status=AccountStatus.INACTIVE)
    account.deactivated_at = NOW
    account.deactivated_by_name = "Jose Reyes"

    summary = to_account_summary(account)

    assert summary.deactivatedAt == NOW
    assert summary.deactivatedByName == "Jose Reyes"
    assert _account().deactivated_at is None


def test_email_change_names_the_requester_and_only_another_it_account_can_approve() -> None:
    account = _account()
    change = _email_change(requested_by="it-requester")
    requester = _account(account_id="it-requester")
    other_it = _account(account_id="it-other")

    as_requester = to_account_summary(account, email_change_request=change, viewer=requester)
    as_owner = to_account_summary(account, email_change_request=change, viewer=account)
    as_other = to_account_summary(account, email_change_request=change, viewer=other_it)

    request = as_other.profileChangeRequests[0]
    assert request.requestedByName == "Jose Reyes"
    assert request.requestedByAccountId == "it-requester"
    assert request.isVerified is True
    assert request.canApprove is True
    assert as_requester.profileChangeRequests[0].canApprove is False
    assert as_owner.profileChangeRequests[0].canApprove is False


def test_unverified_email_change_cannot_be_approved_by_anyone() -> None:
    account = _account()
    change = _email_change(requested_by="it-requester")
    change.status = AccountEmailChangeStatus.PENDING_VERIFICATION.value

    summary = to_account_summary(
        account, email_change_request=change, viewer=_account(account_id="it-other")
    )

    assert summary.profileChangeRequests[0].canApprove is False
