import multiprocessing
import os

import uvicorn

from app.config.service_settings import ServiceSettings
from app.main import app, create_app

__all__ = ["app", "main"]


def main() -> None:
    settings = ServiceSettings.from_environment()
    port = int(os.environ.get("TANAW_ML_SERVICE_PORT", "8765"))
    application = create_app(settings=settings)
    uvicorn.run(application, host=settings.bind_host, port=port, reload=False, access_log=False)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
