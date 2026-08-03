import multiprocessing
import os

import uvicorn

from app.main import app

__all__ = ["app", "main"]


def main() -> None:
    port = int(os.environ.get("TANAW_ML_SERVICE_PORT", "8765"))
    host = os.environ.get("TANAW_ML_SERVICE_HOST", "127.0.0.1")
    uvicorn.run("app.main:app", host=host, port=port, reload=False, access_log=False)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
