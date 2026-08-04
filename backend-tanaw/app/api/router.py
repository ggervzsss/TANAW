from fastapi import APIRouter

from app.features.accounts.router import dev_router
from app.features.accounts.router import router as accounts_router
from app.features.activity_logs.router import router as activity_logs_router
from app.features.auth.router import router as auth_router
from app.features.dashboard.router import router as dashboard_router
from app.features.mail.router import router as mail_router
from app.features.maintenance.router import router as maintenance_router
from app.features.monitoring.router import router as monitoring_router
from app.features.notifications.router import router as notifications_router
from app.features.realtime.router import router as realtime_router
from app.features.reporting.router import router as reporting_router
from app.features.support.router import router as support_router

api_router = APIRouter()
api_router.include_router(activity_logs_router)
api_router.include_router(accounts_router)
api_router.include_router(auth_router)
api_router.include_router(dashboard_router)
api_router.include_router(mail_router)
api_router.include_router(maintenance_router)
api_router.include_router(dev_router)
api_router.include_router(monitoring_router)
api_router.include_router(reporting_router)
api_router.include_router(support_router)
api_router.include_router(notifications_router)
api_router.include_router(realtime_router)
