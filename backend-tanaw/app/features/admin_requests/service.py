from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole
from app.features.accounts.service import get_account_by_id, to_account_summary_with_requests
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.admin_requests.schemas import AdminRequestMessageResult, AdminRequestSourceType
from app.features.monitoring.models import OperationalAlert
from app.features.notifications.service import create_role_notifications
from app.features.support.service import get_support_ticket_for_account

# The alert owners an Admin can list (see list_operational_alerts).
ADMIN_VISIBLE_ALERT_OWNERS = frozenset({"Admin", "System"})
ADMIN_REQUEST_MESSAGE_ACTION = "Message IT"
ADMIN_REQUEST_MESSAGE_NOTIFICATION = "Admin Request Message"
NOTIFICATION_TITLE_LIMIT = 160
ACTIVITY_TARGET_LIMIT = 255


@dataclass(frozen=True)
class RequestSource:
    """One request an Admin can see on the Requests screen, resolved from its source record."""

    source_type: AdminRequestSourceType
    source_id: str
    reference: str
    """The reference shown to people: an alert or ticket code, or the enterprise name."""
    description: str
    """How the request is named in a sentence, such as "TCK-000123" or "X's profile change"."""


async def find_request_source(
    db: AsyncSession,
    admin: Account,
    source_type: AdminRequestSourceType,
    source_id: str,
) -> RequestSource | None:
    """Return the request the Admin can see, or None when it does not exist for them."""
    if source_type == "operational.alert":
        alert = await db.scalar(
            select(OperationalAlert).where(OperationalAlert.alert_code == source_id)
        )
        if alert is None or alert.owner not in ADMIN_VISIBLE_ALERT_OWNERS:
            return None
        return RequestSource(
            source_type=source_type,
            source_id=alert.alert_code,
            reference=alert.alert_code,
            description=alert.alert_code,
        )
    if source_type == "support.ticket":
        ticket = await get_support_ticket_for_account(db, admin, source_id)
        if ticket is None:
            return None
        return RequestSource(
            source_type=source_type,
            source_id=ticket.id,
            reference=ticket.ticket_code,
            description=ticket.ticket_code,
        )

    account = await get_account_by_id(db, source_id)
    if (
        account is None
        or account.role != AccountRole.ENTERPRISE
        or account.enterprise_profile is None
    ):
        return None
    summary = await to_account_summary_with_requests(db, account)
    if not summary.profileChangeRequests:
        return None
    name = account.enterprise_profile.enterprise_name
    return RequestSource(
        source_type=source_type,
        source_id=account.id,
        reference=name,
        description=f"{name}'s profile change request",
    )


async def send_admin_request_message(
    db: AsyncSession,
    admin: Account,
    source: RequestSource,
    message: str,
) -> AdminRequestMessageResult:
    """Notify every active IT account and keep the message in the Admin activity history.

    The message never joins an enterprise-visible conversation: IT reads it in a notification
    linked to the request, and Admins read it in the request's activity.
    """
    notifications = await create_role_notifications(
        db,
        recipient_roles=[AccountRole.IT],
        title=bounded(
            f"{admin.display_name} sent a message about {source.description}.",
            NOTIFICATION_TITLE_LIMIT,
        ),
        message=message,
        notification_type=ADMIN_REQUEST_MESSAGE_NOTIFICATION,
        severity="Info",
        actor=admin,
        source_type=source.source_type,
        source_id=source.source_id,
    )
    activity = await create_activity_log(
        db,
        ActivityLogCreate(
            category="Admin Operation",
            severity="Info",
            actor=admin.display_name,
            actorRole="Admin",
            action=ADMIN_REQUEST_MESSAGE_ACTION,
            target=bounded(source.reference, ACTIVITY_TARGET_LIMIT),
            summary=bounded(
                f"{admin.display_name} sent IT a message about {source.description}.", 1000
            ),
            sourceId=source.source_id,
            metadata={
                "sourceType": source.source_type,
                "message": message,
                "recipientCount": len(notifications),
            },
        ),
    )
    return AdminRequestMessageResult(activity=activity, recipientCount=len(notifications))


def bounded(value: str, limit: int) -> str:
    """Shorten text to fit a column, ending with an ellipsis when it was cut."""
    if len(value) <= limit:
        return value
    return f"{value[: limit - 1].rstrip()}…"
