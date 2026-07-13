from fastapi import APIRouter

from app.features.accounts.router import dev_router
from app.features.accounts.router import router as accounts_router
from app.features.activity_logs.router import router as activity_logs_router
from app.features.auth.router import router as auth_router
from app.features.mail.router import router as mail_router
from app.features.maintenance.router import router as maintenance_router
from app.features.operational.router import router as operational_router
from app.features.reporting.router import router as reporting_router

api_router = APIRouter()
api_router.include_router(activity_logs_router)
api_router.include_router(accounts_router)
api_router.include_router(auth_router)
api_router.include_router(mail_router)
api_router.include_router(maintenance_router)
api_router.include_router(dev_router)
api_router.include_router(reporting_router)
api_router.include_router(operational_router)
