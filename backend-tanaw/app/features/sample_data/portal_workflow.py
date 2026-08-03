import json
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.models import ActivityLog
from app.features.mail.models import EmailOutbox, EmailOutboxStatus, EmailTemplateName
from app.features.monitoring.models import OperationalAlert
from app.features.notifications.models import UserNotification
from app.features.sample_data.dataset import (
    SAMPLE_CAMERA_PREFIX,
    SAMPLE_SOURCE_PREFIX,
)
from app.features.sample_data.definitions import (
    AdminVisitorScenario,
)
from app.features.sample_data.helpers import (
    sample_uuid,
)
from app.features.support.models import SupportTicket


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
    support_enterprise, routine_support_enterprise = enterprises[:2]
    busy_profile = busy_enterprise.enterprise_profile
    support_profile = support_enterprise.enterprise_profile
    routine_support_profile = routine_support_enterprise.enterprise_profile
    if busy_profile is None or support_profile is None or routine_support_profile is None:
        raise SystemExit("Sample operations data requires enterprise profiles.")

    alert_created_at = range_end - timedelta(minutes=18)
    difference_percent = round(
        (visitor_scenario.current_visitors - visitor_scenario.typical_visitors)
        / visitor_scenario.typical_visitors
        * 100
    )
    alert = OperationalAlert(
        id=sample_uuid("operations-alert", busy_enterprise.id),
        alert_code="ALT-SAMPLE-001",
        alert_type="Foot Traffic Alert",
        severity="Critical" if difference_percent >= 100 else "Warning",
        enterprise=busy_profile.enterprise_name,
        requester=busy_profile.enterprise_name,
        summary=(
            f"{busy_profile.enterprise_name} currently has {visitor_scenario.current_visitors} "
            f"visitors, compared with its usual {visitor_scenario.typical_visitors} around this "
            "day and time."
        ),
        required_action=(
            "Review the live map and coordinate with the establishment, traffic team, or "
            "public-safety personnel if support is needed."
        ),
        resolution_mode="Admin Monitoring",
        status="New",
        owner="Admin",
        source_id=f"visitor-activity:{busy_enterprise.id}",
        created_at=alert_created_at,
        updated_at=alert_created_at,
    )
    db.add(alert)

    technical_enterprise = enterprises[2]
    technical_profile = technical_enterprise.enterprise_profile
    if technical_profile is None:
        raise SystemExit("Sample IT work data requires an enterprise profile.")
    technical_alert_created_at = range_end - timedelta(minutes=12)
    technical_alert = OperationalAlert(
        id=sample_uuid("operations-alert", technical_enterprise.id, "desktop"),
        alert_code="ALT-SAMPLE-002",
        alert_type="Maintenance Request",
        severity="Critical",
        enterprise=technical_profile.enterprise_name,
        requester=technical_profile.enterprise_name,
        summary="The entrance camera stopped sending visitor counts from the desktop application.",
        required_action="Check the camera connection and restart monitoring from the enterprise desktop application.",
        resolution_mode="Remote Review",
        status="New",
        owner="IT",
        source_id=f"telemetry:{technical_enterprise.id}:{SAMPLE_CAMERA_PREFIX}visitor-3",
        created_at=technical_alert_created_at,
        updated_at=technical_alert_created_at,
    )
    db.add(technical_alert)

    high_ticket_created_at = range_end - timedelta(hours=2)
    high_ticket = SupportTicket(
        id=sample_uuid("operations-ticket", support_enterprise.id, "high"),
        ticket_code="TCK-SAMPLE-001",
        enterprise_profile_id=support_enterprise.id,
        enterprise_name=support_profile.enterprise_name,
        category="Camera Issue",
        priority="High",
        subject="Entrance camera has an intermittent view",
        description=(
            "The entrance camera view becomes unavailable several times during operating hours."
        ),
        affected_area="Main entrance",
        camera_node="Entrance Camera",
        status="In Review",
        created_at=high_ticket_created_at,
        updated_at=range_end - timedelta(hours=1),
    )
    routine_ticket = SupportTicket(
        id=sample_uuid("operations-ticket", routine_support_enterprise.id, "normal"),
        ticket_code="TCK-SAMPLE-002",
        enterprise_profile_id=routine_support_enterprise.id,
        enterprise_name=routine_support_profile.enterprise_name,
        category="Report Concern",
        priority="Normal",
        subject="Question about the monthly report notes",
        description="The enterprise requested guidance on the notes included in its report.",
        affected_area="Reports",
        status="Open",
        created_at=range_end - timedelta(hours=5),
        updated_at=range_end - timedelta(hours=5),
    )
    db.add_all([high_ticket, routine_ticket])

    admin_notifications = [
        UserNotification(
            id=sample_uuid("operations-notification", admin.id, alert.id),
            recipient_account_id=admin.id,
            recipient_role=admin.role.value,
            title=f"{busy_profile.enterprise_name} needs attention.",
            message=alert.summary,
            notification_type="High Visitor Activity",
            severity="Critical",
            source_type="operational.alert",
            source_id=alert.alert_code,
            created_by_account_id=busy_enterprise.id,
            created_by_name=busy_profile.enterprise_name,
            created_at=alert_created_at,
        ),
        UserNotification(
            id=sample_uuid("operations-notification", admin.id, high_ticket.id),
            recipient_account_id=admin.id,
            recipient_role=admin.role.value,
            title=f"{support_profile.enterprise_name} submitted an important support request.",
            message=f"{high_ticket.subject}. IT is reviewing the request.",
            notification_type="Enterprise Support Ticket",
            severity="Warning",
            source_type="support.ticket",
            source_id=high_ticket.id,
            created_by_account_id=support_enterprise.id,
            created_by_name=support_profile.enterprise_name,
            created_at=high_ticket_created_at,
        ),
    ]
    it_notifications = [
        UserNotification(
            id=sample_uuid("operations-notification", it_account.id, ticket.id),
            recipient_account_id=it_account.id,
            recipient_role=it_account.role.value,
            title=f"{ticket.enterprise_name} submitted support ticket {ticket.ticket_code}.",
            message=ticket.subject,
            notification_type="Enterprise Support Ticket",
            severity="Warning" if ticket.priority == "High" else "Info",
            source_type="support.ticket",
            source_id=ticket.id,
            created_by_account_id=ticket.enterprise_profile_id,
            created_by_name=ticket.enterprise_name,
            created_at=ticket.created_at,
        )
        for ticket in (high_ticket, routine_ticket)
    ]
    it_notifications.append(
        UserNotification(
            id=sample_uuid("operations-notification", it_account.id, technical_alert.id),
            recipient_account_id=it_account.id,
            recipient_role=it_account.role.value,
            title=f"{technical_profile.enterprise_name} has a technical issue.",
            message=f"{technical_alert.summary} {technical_alert.required_action}",
            notification_type="Technical Issue",
            severity="Critical",
            source_type="operational.alert",
            source_id=technical_alert.alert_code,
            created_by_account_id=technical_enterprise.id,
            created_by_name=technical_profile.enterprise_name,
            created_at=technical_alert_created_at,
        )
    )

    failed_email_created_at = range_end - timedelta(hours=3)
    failed_email = EmailOutbox(
        id=sample_uuid("operations-email", support_enterprise.id, "activation-failure"),
        account_id=support_enterprise.id,
        purpose="account_activation",
        source_id=f"{SAMPLE_SOURCE_PREFIX}email:activation:{support_enterprise.id}",
        recipient=support_enterprise.email,
        sender="TANAW <no-reply@tanaw.local>",
        template_name=EmailTemplateName.ACCOUNT_ACTIVATION.value,
        template_version="v1",
        secret_version="v1",
        template_payload_json=json.dumps({"recipientName": support_enterprise.display_name}),
        tags_json=json.dumps({"sample": True}),
        idempotency_key=f"{SAMPLE_SOURCE_PREFIX}email:activation:{support_enterprise.id}",
        provider="resend",
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
            title=f"Email to {support_enterprise.email} needs attention.",
            message="The account activation email could not be delivered after three attempts.",
            notification_type="Email Problem",
            severity="Warning",
            source_type="email.delivery",
            source_id=failed_email.id,
            created_by_name="TANAW",
            created_at=failed_email_created_at,
        )
    )
    it_notifications.append(
        UserNotification(
            id=sample_uuid(
                "operations-notification", it_account.id, technical_enterprise.id, "contact"
            ),
            recipient_account_id=it_account.id,
            recipient_role=it_account.role.value,
            title=f"{technical_profile.enterprise_name} requested a contact number change.",
            message="A new enterprise contact number is waiting for IT review.",
            notification_type="Enterprise Profile Change Request",
            severity="Info",
            source_type="enterprise.profile.contact",
            source_id=technical_enterprise.id,
            created_by_account_id=technical_enterprise.id,
            created_by_name=technical_profile.enterprise_name,
            created_at=range_end - timedelta(hours=4),
        )
    )
    db.add_all([*admin_notifications, *it_notifications])
    profile_request_enterprise = enterprises[2]
    profile_request_name = (
        profile_request_enterprise.enterprise_profile.enterprise_name
        if profile_request_enterprise.enterprise_profile
        else profile_request_enterprise.display_name
    )
    db.add_all(
        [
            ActivityLog(
                id=sample_uuid("activity-admin-alert", alert.id),
                timestamp=alert_created_at,
                category="Admin Operation",
                severity=alert.severity,
                actor="TANAW",
                actor_role="System",
                action="Alert Created",
                target=busy_profile.enterprise_name,
                summary=alert.summary,
                source_id=f"{SAMPLE_SOURCE_PREFIX}activity:alert:{alert.id}",
                metadata_json=json.dumps(
                    {"alertType": alert.alert_type, "status": alert.status}, sort_keys=True
                ),
            ),
            ActivityLog(
                id=sample_uuid("activity-support-escalation", high_ticket.id),
                timestamp=high_ticket_created_at,
                category="Enterprise Activity",
                severity="Warning",
                actor=support_profile.enterprise_name,
                actor_role="Enterprise Account",
                action="Submit Important Support Request",
                target=high_ticket.ticket_code,
                summary=(
                    f"{support_profile.enterprise_name} submitted an important support request "
                    "for IT review."
                ),
                source_id=f"{SAMPLE_SOURCE_PREFIX}activity:ticket:{high_ticket.id}",
            ),
            ActivityLog(
                id=sample_uuid("activity-account-request", profile_request_enterprise.id),
                timestamp=range_end - timedelta(hours=4),
                category="Enterprise Activity",
                severity="Info",
                actor=profile_request_name,
                actor_role="Enterprise Account",
                action="Request Account Update",
                target=profile_request_name,
                summary=f"{profile_request_name} requested a contact-number update for IT review.",
                source_id=(
                    f"{SAMPLE_SOURCE_PREFIX}activity:account-request:"
                    f"{profile_request_enterprise.id}"
                ),
            ),
            ActivityLog(
                id=sample_uuid("activity-technical-issue", technical_alert.id),
                timestamp=technical_alert_created_at,
                category="Enterprise Activity",
                severity="Critical",
                actor=technical_profile.enterprise_name,
                actor_role="Enterprise Account",
                action="Desktop Application Problem",
                target=technical_profile.enterprise_name,
                summary=technical_alert.summary,
                source_id=f"{SAMPLE_SOURCE_PREFIX}activity:technical:{technical_alert.id}",
                metadata_json=json.dumps(
                    {"alertType": technical_alert.alert_type, "status": technical_alert.status},
                    sort_keys=True,
                ),
            ),
        ]
    )
    await db.flush()
    return {
        "adminNotifications": len(admin_notifications),
        "itNotifications": len(it_notifications),
        "operationalAlerts": 2,
        "supportTickets": 2,
        "emailProblems": 1,
        "activityLogs": 4,
    }
