from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account
from app.features.monitoring.schemas import OperationalSummary
from app.features.monitoring.telemetry import list_latest_telemetry
from app.features.reporting.intake import list_intake_reports


async def get_operational_summary(db: AsyncSession, account: Account | None) -> OperationalSummary:
    latest = await list_latest_telemetry(db, account)
    reports = await list_intake_reports(db, account)
    last_sync_at = max((item.receivedAt for item in latest), default=None)
    entries = [item.entries for item in latest if item.entries is not None]
    exits = [item.exits for item in latest if item.exits is not None]
    return OperationalSummary(
        enterpriseCount=len(latest),
        onlineGateways=sum(1 for item in latest if item.gatewayStatus == "Connected"),
        delayedGateways=sum(1 for item in latest if item.gatewayStatus == "Sync Delayed"),
        offlineGateways=sum(1 for item in latest if item.gatewayStatus == "Offline"),
        totalCurrentOccupancy=sum(
            item.currentOccupancy or 0 for item in latest if item.gatewayStatus == "Connected"
        ),
        totalEntries=sum(entries) if entries else None,
        totalExits=sum(exits) if exits else None,
        totalUniqueCount=sum(item.uniqueCount or 0 for item in latest),
        activeReports=len(reports),
        pendingReports=sum(1 for report in reports if report.status == "Pending Review"),
        lastSyncAt=last_sync_at,
    )
