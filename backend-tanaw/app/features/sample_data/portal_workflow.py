"""What is open right now in the sample portals: live alerts, open requests and IT's work.

Live alerts: one place busier than usual and one camera that is not counting. Requests: one in
each way a request starts (from the desktop app, from the sign-in page, and an account change
that needs IT's approval). Every record matches what the live workflow would have written.
"""

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole
from app.features.accounts.service import PENDING_CONTACT_NUMBER_CHANGE_KEY
from app.features.activity_logs.models import ActivityLog
from app.features.auth.profile_helpers import set_pending_account_change
from app.features.mail.models import EmailOutbox, EmailOutboxStatus, EmailTemplateName
from app.features.monitoring.models import OperationalAlert
from app.features.notifications.models import UserNotification
from app.features.requests.models import Request, RequestMessage
from app.features.sample_data.dataset import SAMPLE_SOURCE_PREFIX
from app.features.sample_data.definitions import AdminVisitorScenario
from app.features.sample_data.helpers import sample_uuid


def _name(account: Account) -> str:
    profile = account.enterprise_profile
    return profile.enterprise_name if profile is not None else account.display_name


def _manager(account: Account) -> str:
    profile = account.enterprise_profile
    return (profile.manager_name if profile is not None else None) or account.display_name


def sample_log(
    id_parts: tuple[str, ...],
    at: datetime,
    *,
    group: str,
    severity: str,
    actor: str,
    actor_role: str,
    action: str,
    target: str,
    summary: str,
    source_id: str | None,
    it_detail: str | None = None,
    metadata: dict[str, str | int | None] | None = None,
) -> ActivityLog:
    return ActivityLog(
        id=sample_uuid(*id_parts),
        timestamp=at,
        activity_group=group,
        severity=severity,
        actor=actor,
        actor_role=actor_role,
        action=action,
        target=target,
        summary=summary,
        source_id=source_id,
        it_detail=it_detail,
        metadata_json=json.dumps(metadata, sort_keys=True) if metadata else None,
    )


async def create_portal_workflow_data(
    db: AsyncSession,
    lgu_accounts: list[Account],
    enterprises: list[Account],
    range_end: datetime,
    visitor_scenario: AdminVisitorScenario,
) -> dict[str, int]:
    admin = next(account for account in lgu_accounts if account.role == AccountRole.ADMIN)
    it_account = next(account for account in lgu_accounts if account.role == AccountRole.IT)
    if len(enterprises) < 3:
        raise SystemExit("At least three generated enterprises are required for operations data.")

    busy_enterprise = visitor_scenario.enterprise
    camera_enterprise, report_enterprise, change_enterprise = enterprises[:3]
    logs: list[ActivityLog] = []

    # Live alert: busier than usual.
    busy_at = range_end - timedelta(minutes=18)
    difference = round(
        (visitor_scenario.current_visitors - visitor_scenario.typical_visitors)
        / visitor_scenario.typical_visitors
        * 100
    )
    busy_alert = OperationalAlert(
        id=sample_uuid("operations-alert", busy_enterprise.id),
        alert_code="ALT-SAMPLE-001",
        alert_type="Busier Than Usual",
        severity="Critical" if difference >= 100 else "Warning",
        enterprise_profile_id=busy_enterprise.id,
        enterprise=_name(busy_enterprise),
        summary=(
            f"{_name(busy_enterprise)} has {visitor_scenario.current_visitors} visitors inside, "
            f"more than its usual {visitor_scenario.typical_visitors} around this time."
        ),
        detail=f"{difference}% above usual · Usual from the past 5 weeks",
        status="Active",
        source_id=f"visitor-activity:{busy_enterprise.id}",
        started_at=busy_at,
        active_at=busy_at,
        created_at=busy_at,
        updated_at=busy_at,
    )

    # Live alert: a camera that is not counting.
    camera_at = range_end - timedelta(minutes=12)
    camera_alert = OperationalAlert(
        id=sample_uuid("operations-alert", camera_enterprise.id, "camera"),
        alert_code="ALT-SAMPLE-002",
        alert_type="Camera Not Counting",
        severity="Critical",
        enterprise_profile_id=camera_enterprise.id,
        enterprise=_name(camera_enterprise),
        camera="Entrance",
        summary=(
            f"The Entrance camera at {_name(camera_enterprise)} is not counting. "
            "2 of 3 cameras are counting."
        ),
        detail="Camera: Entrance · Error: the connection was refused · Last count: 2:40 PM",
        status="Active",
        source_id=f"camera:{camera_enterprise.id}:3",
        started_at=camera_at - timedelta(minutes=15),
        active_at=camera_at,
        created_at=camera_at - timedelta(minutes=15),
        updated_at=camera_at,
    )
    db.add_all([busy_alert, camera_alert])
    for alert, action in (
        (busy_alert, "Busier Than Usual"),
        (camera_alert, "Camera Stopped Counting"),
    ):
        logs.append(
            sample_log(
                ("activity-alert", alert.id),
                alert.active_at or alert.started_at,
                group="Monitoring",
                severity="Warning",
                actor="TANAW",
                actor_role="System",
                action=action,
                target=alert.enterprise or "",
                summary=alert.summary,
                source_id=alert.id,
                it_detail=alert.detail,
                metadata={"alertCode": alert.alert_code, "alertType": alert.alert_type},
            )
        )

    # A camera problem the enterprise asked IT about. IT is on it, and the Admin left a note.
    camera_sent = range_end - timedelta(hours=2)
    camera_request = Request(
        id=sample_uuid("operations-request", camera_enterprise.id, "camera"),
        request_code="REQ-SAMPLE-001",
        request_group="Desktop app or camera problem",
        title="Entrance camera keeps disconnecting",
        description=(
            "The entrance camera drops off every few minutes. While it is disconnected, one of "
            "our cameras is not counting."
        ),
        status="In Progress",
        urgent=True,
        enterprise_profile_id=camera_enterprise.id,
        enterprise_name=_name(camera_enterprise),
        requester_name=_manager(camera_enterprise),
        affected_area="Main entrance",
        camera="Entrance",
        created_at=camera_sent,
        updated_at=range_end - timedelta(minutes=40),
    )
    # A report problem nobody has picked up yet.
    report_sent = range_end - timedelta(hours=5)
    report_request = Request(
        id=sample_uuid("operations-request", report_enterprise.id, "report"),
        request_code="REQ-SAMPLE-002",
        request_group="Report problem",
        title="October report upload failed",
        description='The October report will not upload. The app says "Sign in again to send this report".',
        status="Sent",
        enterprise_profile_id=report_enterprise.id,
        enterprise_name=_name(report_enterprise),
        requester_name=_manager(report_enterprise),
        created_at=report_sent,
        updated_at=report_sent,
    )
    # An account change waiting for IT's approval.
    change_sent = range_end - timedelta(hours=4)
    new_number = "+639185550177"
    set_pending_account_change(
        change_enterprise,
        PENDING_CONTACT_NUMBER_CHANGE_KEY,
        {"phone": new_number, "requestedAt": change_sent.astimezone(UTC).isoformat()},
    )
    change_request = Request(
        id=sample_uuid("operations-request", change_enterprise.id, "contact"),
        request_code="REQ-SAMPLE-003",
        request_group="Account change",
        title="Change of contact number",
        description=f"{_name(change_enterprise)} asked to change its contact number to {new_number}.",
        status="Sent",
        enterprise_profile_id=change_enterprise.id,
        enterprise_name=_name(change_enterprise),
        requester_name=_manager(change_enterprise),
        change_field="contactNumber",
        change_value=new_number,
        created_at=change_sent,
        updated_at=change_sent,
    )
    # Someone who could not sign in used the sign-in page's Contact support form.
    help_sent = range_end - timedelta(hours=1, minutes=10)
    help_request = Request(
        id=sample_uuid("operations-request", "sign-in-help"),
        request_code="REQ-SAMPLE-004",
        request_group="Sign-in help",
        title="Sign-in help",
        description="I forgot the password of our desktop app and the reset email does not arrive.",
        status="Sent",
        requester_name="Joy Villanueva",
        requester_email="joy.villanueva@sample.tanaw.local",
        created_at=help_sent,
        updated_at=help_sent,
    )
    requests = [camera_request, report_request, change_request, help_request]
    db.add_all(requests)
    await db.flush()
    db.add_all(
        [
            RequestMessage(
                id=sample_uuid("operations-request-message", camera_request.id, "status"),
                request_id=camera_request.id,
                author_account_id=it_account.id,
                author_name=it_account.display_name,
                author_role=it_account.role.value,
                kind="status",
                message="In Progress",
                created_at=camera_sent + timedelta(minutes=25),
            ),
            RequestMessage(
                id=sample_uuid("operations-request-message", camera_request.id, "reply"),
                request_id=camera_request.id,
                author_account_id=it_account.id,
                author_name=it_account.display_name,
                author_role=it_account.role.value,
                kind="message",
                message="I am checking the cable and the network switch now. Please keep the desktop app open.",
                created_at=camera_sent + timedelta(minutes=40),
            ),
            RequestMessage(
                id=sample_uuid("operations-request-message", camera_request.id, "note"),
                request_id=camera_request.id,
                author_account_id=admin.id,
                author_name=admin.display_name,
                author_role=admin.role.value,
                kind="note",
                message="Please update me here as soon as this is fixed.",
                created_at=range_end - timedelta(minutes=40),
            ),
        ]
    )
    for request in requests:
        sender = request.enterprise_name or request.requester_name
        logs.append(
            sample_log(
                ("activity-request-sent", request.id),
                request.created_at,
                group="Requests",
                severity="Info",
                actor=sender,
                actor_role="Enterprise Account" if request.enterprise_profile_id else "System",
                action="Request Account Change" if request.change_field else "Send Request",
                target=request.request_code,
                summary=(
                    f"{sender} asked to change its contact number."
                    if request.change_field
                    else f"{sender} asked for help signing in."
                    if request.request_group == "Sign-in help"
                    else f"{sender} sent a request: {request.title}."
                ),
                source_id=request.id,
                it_detail=f"{request.request_code} · {request.request_group}",
                metadata={"requestCode": request.request_code},
            )
        )
    logs.append(
        sample_log(
            ("activity-request-progress", camera_request.id),
            camera_sent + timedelta(minutes=25),
            group="Requests",
            severity="Info",
            actor=it_account.display_name,
            actor_role="IT Personnel",
            action="Request In Progress",
            target=camera_request.request_code,
            summary=f"{it_account.display_name} marked {_name(camera_enterprise)}'s request in progress.",
            source_id=camera_request.id,
            it_detail=f"{camera_request.request_code}: Sent → In Progress.",
        )
    )
    logs.append(
        sample_log(
            ("activity-request-note", camera_request.id),
            range_end - timedelta(minutes=40),
            group="Requests",
            severity="Info",
            actor=admin.display_name,
            actor_role="Admin",
            action="Add Note for IT",
            target=camera_request.request_code,
            summary=f"{admin.display_name} added a note for IT on {_name(camera_enterprise)}'s request.",
            source_id=camera_request.id,
            it_detail="Please update me here as soon as this is fixed.",
        )
    )

    it_notifications = [
        UserNotification(
            id=sample_uuid("operations-notification", it_account.id, request.id),
            recipient_account_id=it_account.id,
            recipient_role=it_account.role.value,
            title=f"{request.enterprise_name or request.requester_name} sent request {request.request_code}.",
            message=f"{request.request_group}: {request.title}.",
            notification_type="Request",
            severity="Warning" if request.urgent else "Info",
            source_type="request",
            source_id=request.id,
            created_by_account_id=request.enterprise_profile_id,
            created_by_name=request.enterprise_name or request.requester_name,
            created_at=request.created_at,
        )
        for request in requests
    ]

    failed_email_created_at = range_end - timedelta(hours=3)
    failed_email = EmailOutbox(
        id=sample_uuid("operations-email", report_enterprise.id, "activation-failure"),
        account_id=report_enterprise.id,
        purpose="account_activation",
        source_id=f"{SAMPLE_SOURCE_PREFIX}email:activation:{report_enterprise.id}",
        recipient=report_enterprise.email,
        sender="TANAW <no-reply@tanaw.local>",
        template_name=EmailTemplateName.ACCOUNT_ACTIVATION.value,
        template_version="v1",
        secret_version="v1",
        template_payload_json=json.dumps({"recipientName": report_enterprise.display_name}),
        tags_json=json.dumps({"sample": True}),
        idempotency_key=f"{SAMPLE_SOURCE_PREFIX}email:activation:{report_enterprise.id}",
        provider="brevo",
        status=EmailOutboxStatus.TERMINAL_FAILED.value,
        attempt_count=3,
        max_attempts=3,
        next_attempt_at=failed_email_created_at,
        valid_until=range_end + timedelta(days=1),
        first_provider_attempt_at=failed_email_created_at - timedelta(minutes=10),
        last_provider_attempt_at=failed_email_created_at,
        last_error_code="sample_delivery_failed",
        last_error_message="The provider rejected the sample recipient address.",
        created_at=failed_email_created_at,
        updated_at=failed_email_created_at,
    )
    db.add(failed_email)
    it_notifications.append(
        UserNotification(
            id=sample_uuid("operations-notification", it_account.id, failed_email.id),
            recipient_account_id=it_account.id,
            recipient_role=it_account.role.value,
            title=f"Email to {report_enterprise.email} needs attention.",
            message="The account activation email could not be delivered after three attempts.",
            notification_type="Email Problem",
            severity="Warning",
            source_type="email.delivery",
            source_id=failed_email.id,
            created_by_name="TANAW",
            created_at=failed_email_created_at,
        )
    )
    db.add_all([*it_notifications, *logs])
    await db.flush()
    return {
        "itNotifications": len(it_notifications),
        "operationalAlerts": 2,
        "requests": len(requests),
        "emailProblems": 1,
        "activityLogs": len(logs),
    }
