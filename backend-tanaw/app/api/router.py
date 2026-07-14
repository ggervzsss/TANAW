from fastapi import APIRouter

from app.features.accounts.router import dev_router
from app.features.accounts.router import router as accounts_router
from app.features.activity_logs.router import router as activity_logs_router
from app.features.alerts.router import router as alerts_router
from app.features.auth.router import router as auth_router
from app.features.events.operational_router import router as operational_realtime_router
from app.features.final_reports.router import router as final_reports_router
from app.features.mail.router import router as mail_router
from app.features.maintenance.router import router as maintenance_router
from app.features.notifications.router import router as notifications_router
from app.features.reporting.router import router as reporting_router
from app.features.simulation.router import router as simulation_router
from app.features.support.router import router as support_router
from app.features.telemetry.router import router as telemetry_router

api_router = APIRouter()
api_router.include_router(activity_logs_router)
api_router.include_router(alerts_router)
api_router.include_router(accounts_router)
api_router.include_router(auth_router)
api_router.include_router(mail_router)
api_router.include_router(maintenance_router)
api_router.include_router(notifications_router)
api_router.include_router(operational_realtime_router)
api_router.include_router(dev_router)
api_router.include_router(final_reports_router)
api_router.include_router(reporting_router)
api_router.include_router(simulation_router)
api_router.include_router(support_router)
api_router.include_router(telemetry_router)
