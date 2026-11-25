import base64
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.features.accounts.models import (
    Account,
    AccountEmailChangeRequest,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.auth.schemas import SupportRequest
from app.features.auth.support_router import create_support_request
from app.features.notifications.service import list_user_notifications
from app.features.requests.models import Request
from app.features.requests.router import reply_to_request
from app.features.requests.schemas import (
    MAX_REQUEST_ATTACHMENT_BYTES,
    RequestAttachmentCreate,
    RequestCreate,
    RequestMessageCreate,
)
from app.features.requests.service import (
    RequestConflictError,
    add_request_message,
    allowed_statuses,
    list_requests,
    reopen_request,
    set_request_status,
    to_request_summary,
    update_request_fields,
)

NOW = datetime(2026, 11, 23, 6, 0, tzinfo=UTC)


def account(role: AccountRole) -> Account:
    record = Account(
        id=f"{role.value}-account",
        email=f"{role.value}@example.com",
        phone="+639170000000",
        password_hash="hash",
        role=role,
        display_name=f"{role.value.title()} User",
        title=role.value.title(),
        status=AccountStatus.ACTIVE,
    )
    if role == AccountRole.ENTERPRISE:
        profile = EnterpriseProfile(
            account_id=record.id,
            enterprise_id="ENT-001",
            enterprise_name="Test Enterprise",
            attraction_code="411",
            manager_name="Test Manager",
            barangay="Poblacion",
        )
        profile.account = record
        record.enterprise_profile = profile
    return record


def request(**overrides: object) -> Request:
    enterprise = account(AccountRole.ENTERPRISE)
    values: dict[str, object] = {
        "id": "request-1",
        "request_code": "REQ-000001",
        "request_group": "Desktop app or camera problem",
        "title": "Entrance camera keeps disconnecting",
        "description": "The entrance camera drops off every few minutes.",
        "status": "In Progress",
        "enterprise_profile_id": enterprise.id,
        "enterprise_name": "Test Enterprise",
        "requester_name": "Test Manager",
        "requester_email": None,
        "created_at": NOW - timedelta(hours=1),
        "updated_at": NOW - timedelta(minutes=10),
    }
    values.update(overrides)
    record = Request(**values)
    record.enterprise_profile = enterprise.enterprise_profile
    return record


def fake_db() -> MagicMock:
    db = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    scalars = MagicMock()
    scalars.all.return_value = ["request-1"]
    db.scalars = AsyncMock(return_value=scalars)
    return db


def test_senders_pick_only_the_groups_people_send() -> None:
    with pytest.raises(ValidationError):
        RequestCreate(
            group="Account change",  # type: ignore[arg-type]
            title="Change my name",
            description="Please change our enterprise name.",
        )


def test_a_camera_is_kept_only_for_camera_problems() -> None:
    report = RequestCreate(
        group="Report problem",
        title="  October   report  ",
        description="The October report would not upload.",
        camera="Gate A",
    )
    camera = RequestCreate(
        group="Desktop app or camera problem",
        title="Gate A is offline",
        description="Gate A stopped counting this morning.",
        camera="Gate A",
    )

    assert report.title == "October report"
    assert report.camera is None
    assert camera.camera == "Gate A"


def test_attachments_reject_malformed_mismatched_and_oversized_photos() -> None:
    with pytest.raises(ValidationError, match="Upload a valid image file"):
        RequestAttachmentCreate(
            fileName="evidence.png",
            mediaType="image/png",
            sizeBytes=3,
            dataUrl="data:image/png;base64,not-valid-base64!",
        )
    encoded = base64.b64encode(b"actual attachment bytes").decode()
    with pytest.raises(ValidationError, match="Photo size does not match"):
        RequestAttachmentCreate(
            fileName="evidence.png",
            mediaType="image/png",
            sizeBytes=1,
            dataUrl=f"data:image/png;base64,{encoded}",
        )
    oversized = base64.b64encode(b"x" * (MAX_REQUEST_ATTACHMENT_BYTES + 1)).decode()
    with pytest.raises(ValidationError, match="Each photo must be under 5 MB"):
        RequestAttachmentCreate(
            fileName="evidence.png",
            mediaType="image/png",
            sizeBytes=1,
            dataUrl=f"data:image/png;base64,{oversized}",
        )


@pytest.mark.asyncio
async def test_staff_notifications_keep_only_report_submissions() -> None:
    db = MagicMock()
    db.scalars = AsyncMock(return_value=[])

    assert await list_user_notifications(db, account(AccountRole.STAFF)) == []

    statement = db.scalars.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "user_notifications.source_type = 'enterprise.report'" in sql


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [AccountRole.ADMIN, AccountRole.IT])
async def test_admin_and_it_read_every_request(role: AccountRole) -> None:
    db = MagicMock()
    result = MagicMock()
    result.unique.return_value.all.return_value = []
    db.scalars = AsyncMock(return_value=result)

    assert await list_requests(db, account(role)) == []

    sql = str(db.scalars.await_args.args[0].compile(compile_kwargs={"literal_binds": True}))
    assert "WHERE" not in sql


@pytest.mark.asyncio
async def test_staff_read_no_requests() -> None:
    db = MagicMock()

    assert await list_requests(db, account(AccountRole.STAFF)) == []
    db.scalars.assert_not_called()


def test_read_marks_show_new_and_updated_requests() -> None:
    reader = account(AccountRole.ADMIN)
    item = request()

    never_read = to_request_summary(item, viewer=reader, read_at=None, now=NOW)
    read_before_change = to_request_summary(
        item, viewer=reader, read_at=NOW - timedelta(minutes=30), now=NOW
    )
    read_after_change = to_request_summary(item, viewer=reader, read_at=NOW, now=NOW)

    assert (never_read.unread, never_read.updated) == (True, False)
    assert (read_before_change.unread, read_before_change.updated) == (False, True)
    assert (read_after_change.unread, read_after_change.updated) == (False, False)


def test_only_lgu_readers_see_a_sign_in_help_email() -> None:
    item = request(request_group="Sign-in help", requester_email="joy@example.com")

    assert to_request_summary(item, viewer=account(AccountRole.IT), now=NOW).requesterEmail == (
        "joy@example.com"
    )
    assert (
        to_request_summary(item, viewer=account(AccountRole.ENTERPRISE), now=NOW).requesterEmail
        is None
    )


def email_change(status: str, *, expires_in: timedelta) -> AccountEmailChangeRequest:
    return AccountEmailChangeRequest(
        id="email-change-1",
        account_id="enterprise-account",
        old_email="old@example.com",
        requested_email="new@example.com",
        status=status,
        expires_at=NOW + expires_in,
        requested_by_name="Test Manager",
        requested_by_role="enterprise",
    )


@pytest.mark.parametrize(
    ("status", "expires_in", "verification", "can_approve"),
    [
        ("pending_verification", timedelta(hours=1), "pending_verification", False),
        ("verified", timedelta(hours=1), "verified", True),
        ("verified", -timedelta(minutes=1), "expired", False),
    ],
)
def test_a_business_email_change_can_be_approved_only_once_verified(
    status: str, expires_in: timedelta, verification: str, can_approve: bool
) -> None:
    item = request(
        request_group="Account change",
        change_field="businessEmail",
        change_value="new@example.com",
    )

    change = to_request_summary(
        item,
        viewer=account(AccountRole.IT),
        email_request=email_change(status, expires_in=expires_in),
        now=NOW,
        contact=("enterprise@example.com", "+639170000000"),
    ).accountChange

    assert change is not None
    assert change.label == "Business email"
    assert change.currentValue == "enterprise@example.com"
    assert change.verification == verification
    assert change.canApprove is can_approve


def test_account_changes_end_approved_or_resolved() -> None:
    assert allowed_statuses(request(change_field="enterpriseName")) == {
        "In Progress",
        "Approved",
        "Resolved",
    }
    assert allowed_statuses(request()) == {"In Progress", "Resolved"}


@pytest.mark.asyncio
async def test_status_changes_are_written_on_the_timeline() -> None:
    db = fake_db()
    item = request()
    it_account = account(AccountRole.IT)

    previous = await set_request_status(db, item, it_account, "Resolved")

    assert previous == "In Progress"
    assert item.status == "Resolved"
    assert item.closed_at is not None
    timeline_entry = db.add.call_args.args[0]
    assert (timeline_entry.kind, timeline_entry.message) == ("status", "Resolved")


@pytest.mark.asyncio
async def test_a_resolved_request_can_be_reopened_once() -> None:
    db = fake_db()
    item = request(status="Resolved", closed_at=NOW)

    await reopen_request(db, item, account(AccountRole.ENTERPRISE))

    assert item.status == "In Progress"
    assert item.closed_at is None
    assert db.add.call_args.args[0].message == "Reopened"
    with pytest.raises(RequestConflictError):
        await reopen_request(db, item, account(AccountRole.ENTERPRISE))


@pytest.mark.asyncio
async def test_a_decided_account_change_stays_closed() -> None:
    for status in ("Approved", "Resolved"):
        item = request(change_field="contactNumber", status=status, closed_at=NOW)
        with pytest.raises(RequestConflictError):
            await set_request_status(fake_db(), item, account(AccountRole.IT), "In Progress")
        with pytest.raises(RequestConflictError):
            await reopen_request(fake_db(), item, account(AccountRole.ENTERPRISE))


@pytest.mark.asyncio
async def test_only_account_changes_belong_in_the_account_change_group() -> None:
    with pytest.raises(RequestConflictError):
        await update_request_fields(
            fake_db(), request(), account(AccountRole.IT), group="Account change"
        )


@pytest.mark.asyncio
async def test_an_it_reply_keeps_the_request_in_progress() -> None:
    db = fake_db()
    item = request()

    record = await add_request_message(db, item, account(AccountRole.IT), "Checking it now.")

    assert item.status == "In Progress"
    assert record.kind == "message"


@pytest.mark.asyncio
async def test_an_admin_note_does_not_change_the_status() -> None:
    db = fake_db()
    item = request()

    record = await add_request_message(
        db, item, account(AccountRole.ADMIN), "Please update me here.", kind="note"
    )

    assert item.status == "In Progress"
    assert record.kind == "note"


@pytest.mark.asyncio
async def test_a_closed_request_takes_no_replies_until_reopened(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = request(status="Resolved")
    monkeypatch.setattr(
        "app.features.requests.router.get_request_for_account", AsyncMock(return_value=item)
    )
    db = fake_db()

    with pytest.raises(HTTPException) as raised:
        await reply_to_request(
            item.id,
            RequestMessageCreate(message="A late follow-up message."),
            account(AccountRole.ENTERPRISE),
            db,
        )

    assert raised.value.status_code == 409
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_the_sign_in_page_sends_a_sign_in_help_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = request(
        request_group="Sign-in help",
        title="Sign-in help",
        enterprise_name=None,
        requester_name="Requester",
        requester_email="requester@example.com",
    )
    create = AsyncMock(return_value=created)
    notify = AsyncMock(return_value=[])
    log = AsyncMock()
    monkeypatch.setattr("app.features.auth.support_router.create_sign_in_help_request", create)
    monkeypatch.setattr("app.features.auth.support_router.create_role_notifications", notify)
    monkeypatch.setattr("app.features.auth.support_router.record_activity_log", log)
    monkeypatch.setattr(
        "app.features.auth.support_router.get_account_by_email", AsyncMock(return_value=None)
    )

    result = await create_support_request(
        SupportRequest(
            name="  Requester  ",
            email="Requester@Example.com",
            message="  Unable to sign in to TANAW.  ",
        ),
        MagicMock(),
    )

    assert result.status == "ok"
    created_call, notify_call, log_call = create.await_args, notify.await_args, log.await_args
    assert created_call is not None and notify_call is not None and log_call is not None
    assert str(created_call.args[1].email) == "requester@example.com"
    assert created_call.kwargs["matched_account"] is None
    assert notify_call.kwargs["recipient_roles"] == [AccountRole.IT]
    assert log_call.kwargs["group"] == "Requests"
