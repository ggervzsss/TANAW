# TANAW Desktop ML Service

This FastAPI service provides the local camera-processing runtime used by TANAW Desktop. It owns camera connectivity, person detection and tracking, entry/exit counting, local metrics storage, and report-draft persistence.

The Electron main process starts the service with an ephemeral `TANAW_ML_SERVICE_TOKEN`. Desktop HTTP requests send that token in the `X-TANAW-ML-Token` header, while WebSocket stream requests use the `access_token` query parameter. Running the service directly without the environment variable leaves this authentication boundary disabled for local development tools.

## Development

From this directory:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run pytest
UV_CACHE_DIR=/tmp/uv-cache uv run ruff check .
UV_CACHE_DIR=/tmp/uv-cache uv run ruff format --check .
UV_CACHE_DIR=/tmp/uv-cache uv run mypy .
UV_CACHE_DIR=/tmp/uv-cache uv run pyright
```
