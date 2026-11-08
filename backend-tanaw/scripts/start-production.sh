#!/bin/sh
set -eu

alembic upgrade head
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-server-header
