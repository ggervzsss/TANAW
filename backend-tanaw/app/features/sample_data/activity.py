"""Requests and everyday activity a few working days leave behind.

The operations data in ``portal_workflow`` covers what is open right now. This module adds
requests handled earlier, an ended busier-than-usual alert, sign-ins, a password change and
enterprise account changes. Each record matches what the live workflow would have written.
"""

from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.models import ActivityLog
from app.features.monitoring.models import OperationalAlert
from app.features.requests.models import Request, RequestMessage
from app.features.sample_data.helpers import sample_uuid
from app.features.sample_data.portal_workflow import sample_log

_SAMPLE_BROWSER = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
_ACTOR_ROLE = {
    AccountRole.ADMIN: "Admin",
    AccountRole.IT: "IT Personnel",
    AccountRole.STAFF: "LGU Staff",
}


async def create_request_and_user_activity(
    db: AsyncSession,
    lgu_accounts: list[Account],
    enterprises: list[Account],
    range_end: datetime,
) -> dict[str, int]:
    admin = _account_with_role(lgu_accounts, AccountRole.ADMIN)
    it_account = _account_with_role(lgu_accounts, AccountRole.IT)
    staff = _account_with_role(lgu_accounts, AccountRole.STAFF)
    if len(enterprises) < 8:
        raise SystemExit("At least eight generated enterprises are required for request history.")

    logs: list[ActivityLog] = []

    # A camera problem two days ago that IT took on and resolved the same day.
    camera_enterprise = enterprises[3]
    camera_opened = range_end - timedelta(days=2, hours=3)
    camera_request = Request(
        id=sample_uuid("history-request", camera_enterprise.id, "camera"),
        request_code="REQ-SAMPLE-005",
        request_group="Desktop app or camera problem",
        title="Visitor counts stopped updating",
        description=(
            "The desktop app shows the camera feed, but the visitor count has not changed since "
            "this morning."
        ),
        status="Resolved",
        enterprise_profile_id=camera_enterprise.id,
        enterprise_name=_name(camera_enterprise),
        requester_name=_manager(camera_enterprise),
        affected_area="Main entrance",
        camera="Main Entrance",
        handled_by_account_id=it_account.id,
        handled_by_name=it_account.display_name,
        handled_at=camera_opened + timedelta(hours=4, minutes=40),
        created_at=camera_opened,
        updated_at=camera_opened + timedelta(hours=5),
        closed_at=camera_opened + timedelta(hours=5),
    )
    # A question about the report that is still waiting.
    other_enterprise = enterprises[4]
    other_opened = range_end - timedelta(days=1, hours=2)
    other_request = Request(
        id=sample_uuid("history-request", other_enterprise.id, "other"),
        request_code="REQ-SAMPLE-006",
        request_group="Other",
        title="Update the listed opening hours",
        description="We now open at 9:00 AM instead of 10:00 AM. Please update what TANAW shows.",
        status="In Progress",
        enterprise_profile_id=other_enterprise.id,
        enterprise_name=_name(other_enterprise),
        requester_name=_manager(other_enterprise),
        created_at=other_opened,
        updated_at=other_opened,
    )
    # An enterprise name change IT approved last week.
    renamed = enterprises[6]
    rename_opened = range_end - timedelta(days=6, hours=1)
    rename_request = Request(
        id=sample_uuid("history-request", renamed.id, "name"),
        request_code="REQ-SAMPLE-007",
        request_group="Account change",
        title="Change of enterprise name",
        description=f"{_name(renamed)} asked to change its enterprise name to {_name(renamed)}.",
        status="Approved",
        enterprise_profile_id=renamed.id,
        enterprise_name=_name(renamed),
        requester_name=_manager(renamed),
        change_field="enterpriseName",
        change_value=_name(renamed),
        handled_by_account_id=it_account.id,
        handled_by_name=it_account.display_name,
        handled_at=rename_opened + timedelta(hours=3),
        created_at=rename_opened,
        updated_at=rename_opened + timedelta(hours=3),
        closed_at=rename_opened + timedelta(hours=3),
    )
    db.add_all([camera_request, other_request, rename_request])
    await db.flush()
    db.add_all(
        [
            RequestMessage(
                id=sample_uuid("history-request-message", camera_request.id),
                request_id=camera_request.id,
                author_account_id=it_account.id,
                author_name=it_account.display_name,
                author_role=it_account.role.value,
                kind="message",
                message=(
                    "We restarted counting remotely and the counts are updating again. Please "
                    "tell us if they stop."
                ),
                created_at=camera_opened + timedelta(hours=4, minutes=40),
            ),
            _status(camera_request, it_account, "Resolved", camera_opened + timedelta(hours=5)),
            _status(rename_request, it_account, "Approved", rename_opened + timedelta(hours=3)),
        ]
    )
    for request in (camera_request, other_request, rename_request):
        logs.append(
            sample_log(
                ("history-request-sent", request.id),
                request.created_at,
                group="Requests",
                severity="Info",
                actor=request.enterprise_name or request.requester_name,
                actor_role="Enterprise Account",
                action="Request Account Change" if request.change_field else "Send Request",
                target=request.request_code,
                summary=(
                    f"{request.enterprise_name} asked to change its enterprise name."
                    if request.change_field
                    else f"{request.enterprise_name} sent a request: {request.title}."
                ),
                source_id=request.id,
                it_detail=f"{request.request_code} · {request.request_group}",
            )
        )
    logs.append(
        sample_log(
            ("history-request-resolved", camera_request.id),
            camera_opened + timedelta(hours=5),
            group="Requests",
            severity="Success",
            actor=it_account.display_name,
            actor_role="IT Personnel",
            action="Request Resolved",
            target=camera_request.request_code,
            summary=f"{it_account.display_name} marked {_name(camera_enterprise)}'s request resolved.",
            source_id=camera_request.id,
            it_detail=f"{camera_request.request_code}: In Progress → Resolved.",
        )
    )
    logs.append(
        sample_log(
            ("history-account-change-approved", rename_request.id),
            rename_opened + timedelta(hours=3),
            group="Accounts",
            severity="Success",
            actor=it_account.display_name,
            actor_role="IT Personnel",
            action="Approve Account Change",
            target=_name(renamed),
            summary=f"{it_account.display_name} approved {_name(renamed)}'s enterprise name change.",
            source_id=renamed.id,
        )
    )

    # A busier-than-usual alert two days ago that ended when visitors went back to usual.
    busy_enterprise = enterprises[5]
    busy_raised = range_end - timedelta(days=2, hours=6)
    busy_alert = OperationalAlert(
        id=sample_uuid("history-alert", busy_enterprise.id, "busy"),
        alert_code="ALT-SAMPLE-003",
        alert_type="Busier Than Usual",
        severity="Warning",
        enterprise_profile_id=busy_enterprise.id,
        enterprise=_name(busy_enterprise),
        summary=(
            f"{_name(busy_enterprise)} has 96 visitors inside, more than its usual 62 around "
            "this time."
        ),
        detail="55% above usual · Usual from the past 5 weeks",
        status="Ended",
        source_id=f"visitor-activity:{busy_enterprise.id}:history",
        started_at=busy_raised,
        active_at=busy_raised,
        ended_at=busy_raised + timedelta(hours=2),
        created_at=busy_raised,
        updated_at=busy_raised + timedelta(hours=2),
    )
    db.add(busy_alert)
    logs.append(
        sample_log(
            ("history-alert-started", busy_alert.id),
            busy_raised,
            group="Monitoring",
            severity="Warning",
            actor="TANAW",
            actor_role="System",
            action="Busier Than Usual",
            target=_name(busy_enterprise),
            summary=busy_alert.summary,
            source_id=busy_alert.id,
            it_detail=busy_alert.detail,
        )
    )
    logs.append(
        sample_log(
            ("history-alert-ended", busy_alert.id),
            busy_raised + timedelta(hours=2),
            group="Monitoring",
            severity="Success",
            actor="TANAW",
            actor_role="System",
            action="Back to Usual",
            target=_name(busy_enterprise),
            summary=f"{_name(busy_enterprise)} is back to its usual number of visitors.",
            source_id=busy_alert.id,
        )
    )
    # A lockout, recorded as a heads-up rather than an alert.
    logs.append(
        sample_log(
            ("history-lockout", staff.id),
            range_end - timedelta(days=1, hours=7),
            group="Login & Security",
            severity="Warning",
            actor=staff.display_name,
            actor_role="LGU Staff",
            action="Account Locked",
            target=staff.email,
            summary=(
                f"{staff.display_name}'s account was locked for 5 minutes after too many "
                "wrong passwords."
            ),
            source_id=staff.id,
            it_detail="3 failed sign-ins in a row. Locked for 5 minutes.",
        )
    )

    # Sign-ins over the last two days, a sign-out and a password change.
    for account, ago in (
        (admin, timedelta(minutes=25)),
        (staff, timedelta(hours=3)),
        (it_account, timedelta(hours=5)),
        (admin, timedelta(days=1, hours=2)),
        (staff, timedelta(days=1, hours=6)),
    ):
        logs.append(
            _auth_log(
                account, "Login", f"{account.display_name} signed in to TANAW.", range_end - ago
            )
        )
    logs.append(
        _auth_log(
            staff,
            "Logout",
            f"{staff.display_name} signed out of TANAW.",
            range_end - timedelta(days=1, hours=1),
        )
    )
    logs.append(
        _auth_log(
            staff,
            "Password Changed",
            f"{staff.display_name} changed their account password.",
            range_end - timedelta(days=3, hours=1),
        )
    )

    # IT created each enterprise account when it registered, and later updated one of them.
    for enterprise in enterprises:
        logs.append(
            sample_log(
                ("history-enterprise-created", enterprise.id),
                enterprise.created_at,
                group="Enterprises",
                severity="Success",
                actor=it_account.display_name,
                actor_role="IT Personnel",
                action="Create Enterprise Account",
                target=_name(enterprise),
                summary=(
                    f"{it_account.display_name} registered enterprise account {_name(enterprise)} "
                    "and sent the activation email."
                ),
                source_id=enterprise.id,
                metadata={"enterpriseId": _enterprise_id(enterprise)},
            )
        )
    updated_enterprise = enterprises[7]
    logs.append(
        sample_log(
            ("history-enterprise-updated", updated_enterprise.id),
            range_end - timedelta(days=4, hours=2),
            group="Enterprises",
            severity="Success",
            actor=it_account.display_name,
            actor_role="IT Personnel",
            action="Update Enterprise Account",
            target=_name(updated_enterprise),
            summary=(
                f"{it_account.display_name} updated enterprise account {_name(updated_enterprise)}."
            ),
            source_id=updated_enterprise.id,
            metadata={"enterpriseId": _enterprise_id(updated_enterprise)},
        )
    )

    db.add_all(logs)
    await db.flush()
    return {"operationalAlerts": 1, "requests": 3, "activityLogs": len(logs)}


def _account_with_role(accounts: list[Account], role: AccountRole) -> Account:
    account = next((item for item in accounts if item.role == role), None)
    if account is None:
        raise SystemExit(f"The sample dataset needs a {role.value} account.")
    return account


def _name(enterprise: Account) -> str:
    profile = enterprise.enterprise_profile
    return profile.enterprise_name if profile is not None else enterprise.display_name


def _manager(enterprise: Account) -> str:
    profile = enterprise.enterprise_profile
    return (profile.manager_name if profile is not None else None) or enterprise.display_name


def _enterprise_id(enterprise: Account) -> str | None:
    profile = enterprise.enterprise_profile
    return profile.enterprise_id if profile is not None else None


def _status(request: Request, actor: Account, status: str, at: datetime) -> RequestMessage:
    return RequestMessage(
        id=sample_uuid("history-request-status", request.id, status),
        request_id=request.id,
        author_account_id=actor.id,
        author_name=actor.display_name,
        author_role=actor.role.value,
        kind="status",
        message=status,
        created_at=at,
    )


def _auth_log(account: Account, action: str, summary: str, at: datetime) -> ActivityLog:
    log = sample_log(
        ("history-auth", account.id, action, at.isoformat()),
        at,
        group="Login & Security",
        severity="Info",
        actor=account.display_name,
        actor_role=_ACTOR_ROLE[account.role],
        action=action,
        target=account.email,
        summary=summary,
        source_id=account.id,
    )
    # What the live request context records: the caller's address, browser and session hash.
    # The addresses come from the documentation range, so they belong to no real computer.
    log.ip_address = f"192.0.2.{10 + list(_ACTOR_ROLE).index(account.role)}"
    log.user_agent = _SAMPLE_BROWSER
    log.session_id = sample_uuid("history-session", account.id, at.date().isoformat()).replace(
        "-", ""
    )[:16]
    return log
