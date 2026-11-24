"""Requests and everyday portal activity for the Admin portal's Requests and Recent Activity.

The operations data in ``portal_workflow`` covers what is open right now. This module adds what
a few working days leave behind: requests handled and resolved earlier, sign-ins, a password
change and enterprise account changes. Every log uses the same category, action and source ID as
the live workflow that would have written it, so the portals read it the same way.
"""

import json
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.models import ActivityLog
from app.features.monitoring.models import OperationalAlert
from app.features.sample_data.helpers import sample_uuid
from app.features.support.models import SupportTicket, SupportTicketMessage

_AUTH_CATEGORY = {
    AccountRole.ADMIN: "Admin Operation",
    AccountRole.IT: "IT Activity",
    AccountRole.STAFF: "Staff Operation",
}
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

    # An urgent camera request two days ago that IT took on and resolved the same day.
    camera_enterprise = enterprises[3]
    camera_opened = range_end - timedelta(days=2, hours=3)
    camera_ticket = SupportTicket(
        id=sample_uuid("history-ticket", camera_enterprise.id, "camera"),
        ticket_code="TCK-SAMPLE-003",
        enterprise_profile_id=camera_enterprise.id,
        enterprise_name=_name(camera_enterprise),
        category="Camera Issue",
        priority="Urgent",
        subject="Visitor counts stopped updating",
        description=(
            "The desktop app shows the camera feed, but the visitor count has not changed since "
            "this morning."
        ),
        affected_area="Main entrance",
        camera_node="Main Entrance",
        status="Resolved",
        created_at=camera_opened,
        updated_at=camera_opened + timedelta(hours=5),
    )
    db.add(camera_ticket)
    db.add(
        SupportTicketMessage(
            id=sample_uuid("history-ticket-message", camera_ticket.id),
            ticket_id=camera_ticket.id,
            author_account_id=it_account.id,
            author_name=it_account.display_name,
            author_role=it_account.role.value,
            message=(
                "We restarted counting remotely and the counts are updating again. Please tell us "
                "if they stop."
            ),
            created_at=camera_opened + timedelta(hours=4, minutes=40),
        )
    )
    logs.append(_ticket_submitted(camera_ticket, camera_opened))
    logs.append(
        _ticket_status(
            camera_ticket, it_account, "Open", "In Review", camera_opened + timedelta(hours=1)
        )
    )
    logs.append(
        _ticket_status(
            camera_ticket, it_account, "In Review", "Resolved", camera_opened + timedelta(hours=5)
        )
    )

    # An important account request from yesterday that IT has not picked up yet.
    account_enterprise = enterprises[4]
    account_opened = range_end - timedelta(days=1, hours=2)
    account_ticket = SupportTicket(
        id=sample_uuid("history-ticket", account_enterprise.id, "account"),
        ticket_code="TCK-SAMPLE-004",
        enterprise_profile_id=account_enterprise.id,
        enterprise_name=_name(account_enterprise),
        category="Account & Security",
        priority="High",
        subject="Account for weekend front-desk staff",
        description="We need a second sign-in for the staff who run the front desk on weekends.",
        affected_area="Front desk",
        status="Open",
        created_at=account_opened,
        updated_at=account_opened,
    )
    db.add(account_ticket)
    logs.append(_ticket_submitted(account_ticket, account_opened))

    # A busy-visitors alert two days ago. TANAW raises these from camera counts and clears them
    # when visitors return to their usual level; the Admin Dashboard shows them, not Requests.
    busy_enterprise = enterprises[5]
    busy_raised = range_end - timedelta(days=2, hours=6)
    busy_alert = OperationalAlert(
        id=sample_uuid("history-alert", busy_enterprise.id, "busy"),
        alert_code="ALT-SAMPLE-003",
        alert_type="Foot Traffic Alert",
        severity="Warning",
        enterprise=_name(busy_enterprise),
        requester=_name(busy_enterprise),
        summary=(
            f"{_name(busy_enterprise)} had 96 visitors, compared with its usual 62 around this day "
            "and time. The latest visitor level has returned to its usual range."
        ),
        required_action=(
            "Review the live map and coordinate with the establishment if support is needed."
        ),
        resolution_mode="Admin Monitoring",
        status="Resolved",
        owner="Admin",
        source_id=f"visitor-activity:{busy_enterprise.id}:history",
        created_at=busy_raised,
        updated_at=busy_raised + timedelta(hours=2),
    )
    db.add(busy_alert)
    logs.append(
        _log(
            ("history-alert-created", busy_alert.id),
            busy_raised,
            category="Admin Operation",
            severity="Warning",
            actor="TANAW",
            actor_role="System",
            action="Alert Created",
            target=_name(busy_enterprise),
            summary=(
                f"{_name(busy_enterprise)} had 96 visitors, compared with its usual 62 around this "
                "day and time."
            ),
            source_id=busy_alert.id,
            metadata={"alertType": busy_alert.alert_type, "status": "New"},
        )
    )
    logs.append(
        _log(
            ("history-alert-resolved", busy_alert.id),
            busy_raised + timedelta(hours=2),
            category="Admin Operation",
            severity="Success",
            actor="TANAW",
            actor_role="System",
            action="Alert Resolved",
            target=_name(busy_enterprise),
            summary=busy_alert.summary,
            source_id=busy_alert.id,
            metadata={"alertType": busy_alert.alert_type, "status": "Resolved"},
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
            _log(
                ("history-enterprise-created", enterprise.id),
                enterprise.created_at,
                category="IT Activity",
                severity="Success",
                actor=it_account.display_name,
                actor_role="IT Personnel",
                action="Create Enterprise Account",
                target=_name(enterprise),
                summary=f"{it_account.display_name} created enterprise account {_name(enterprise)}.",
                source_id=enterprise.id,
                metadata={"enterpriseId": _enterprise_id(enterprise)},
            )
        )
    updated_enterprise = enterprises[7]
    logs.append(
        _log(
            ("history-enterprise-updated", updated_enterprise.id),
            range_end - timedelta(days=4, hours=2),
            category="IT Activity",
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
    return {"operationalAlerts": 1, "supportTickets": 2, "activityLogs": len(logs)}


def _account_with_role(accounts: list[Account], role: AccountRole) -> Account:
    account = next((item for item in accounts if item.role == role), None)
    if account is None:
        raise SystemExit(f"The sample dataset needs a {role.value} account.")
    return account


def _name(enterprise: Account) -> str:
    profile = enterprise.enterprise_profile
    return profile.enterprise_name if profile is not None else enterprise.display_name


def _enterprise_id(enterprise: Account) -> str | None:
    profile = enterprise.enterprise_profile
    return profile.enterprise_id if profile is not None else None


def _log(
    id_parts: tuple[str, ...],
    at: datetime,
    *,
    category: str,
    severity: str,
    actor: str,
    actor_role: str,
    action: str,
    target: str,
    summary: str,
    source_id: str,
    metadata: dict[str, str | None] | None = None,
) -> ActivityLog:
    return ActivityLog(
        id=sample_uuid(*id_parts),
        timestamp=at,
        category=category,
        severity=severity,
        actor=actor,
        actor_role=actor_role,
        action=action,
        target=target,
        summary=summary,
        source_id=source_id,
        metadata_json=json.dumps(metadata, sort_keys=True) if metadata else None,
    )


def _auth_log(account: Account, action: str, summary: str, at: datetime) -> ActivityLog:
    return _log(
        ("history-auth", account.id, action, at.isoformat()),
        at,
        category=_AUTH_CATEGORY[account.role],
        severity="Info",
        actor=account.display_name,
        actor_role=_ACTOR_ROLE[account.role],
        action=action,
        target=account.email,
        summary=summary,
        source_id=account.id,
    )


def _ticket_submitted(ticket: SupportTicket, at: datetime) -> ActivityLog:
    return _log(
        ("history-ticket-submitted", ticket.id),
        at,
        category="Enterprise Activity",
        severity="Warning" if ticket.priority in {"High", "Urgent"} else "Info",
        actor=ticket.enterprise_name,
        actor_role="Enterprise Account",
        action="Submit Support Ticket",
        target=ticket.ticket_code,
        summary=f"{ticket.enterprise_name} submitted {ticket.ticket_code}: {ticket.subject}.",
        source_id=ticket.id,
        metadata={
            "ticketCode": ticket.ticket_code,
            "category": ticket.category,
            "priority": ticket.priority,
        },
    )


def _ticket_status(
    ticket: SupportTicket, it_account: Account, previous: str, status: str, at: datetime
) -> ActivityLog:
    return _log(
        ("history-ticket-status", ticket.id, status),
        at,
        category="IT Activity",
        severity="Success",
        actor=it_account.display_name,
        actor_role="IT Personnel",
        action="Update Support Ticket Status",
        target=ticket.ticket_code,
        summary=f"{it_account.display_name} updated {ticket.ticket_code} from {previous} to {status}.",
        source_id=ticket.id,
        metadata={"ticketCode": ticket.ticket_code, "status": status},
    )
