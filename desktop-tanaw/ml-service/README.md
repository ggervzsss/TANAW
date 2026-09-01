# TANAW Desktop ML Service

This FastAPI service provides the local camera-processing runtime used by TANAW Desktop. It owns camera connectivity, person detection and tracking, entry/exit counting, local metrics storage, and report-draft persistence.

The Electron main process starts the service on loopback with an ephemeral `TANAW_ML_SERVICE_TOKEN`. Desktop HTTP requests send that token in the `X-TANAW-ML-Token` header, while WebSocket stream requests use the `access_token` query parameter. Running the service directly without the environment variable leaves authentication disabled only when the service binds to a loopback address for local development tools. A non-loopback `TANAW_ML_SERVICE_HOST` is rejected unless `TANAW_ML_SERVICE_TOKEN` is a whitespace-free token of at least 32 characters.

## Development

From this directory:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run pytest
UV_CACHE_DIR=/tmp/uv-cache uv run ruff check .
UV_CACHE_DIR=/tmp/uv-cache uv run ruff format --check .
UV_CACHE_DIR=/tmp/uv-cache uv run mypy .
UV_CACHE_DIR=/tmp/uv-cache uv run pyright
```

## SQLite Schema Migrations

The enterprise-scoped SQLite ledger is created by the lightweight runner in
`app/storage/migrations/runner.py`. Its only permanent revision is currently
`001_initial_schema`, defined in
`app/storage/migrations/revisions/revision_001_initial_schema.py`.

Migration infrastructure is ready but dormant while TANAW remains
pre-production. During this stage, change the canonical `001` statements
directly and reset development databases. The checksum recorded alongside
`001` deliberately rejects a database created from an older form of the edited
baseline.

Do not add `002` or later merely to preserve disposable development data. Only
after the user explicitly declares that existing data must be preserved should
`001` be frozen. A future revision would then declare revision `002`, previous
revision `001`, an upgrade function that uses the provided SQLite connection,
and a checksum, and would be registered after `001` in the runner. The runner
applies and records each revision in one transaction; migration functions must
not commit or roll back independently.

The future revision shape is intentionally small:

```python
REVISION = "002"
NAME = "descriptive_change"
PREVIOUS_REVISION = "001"
STATEMENTS = ("alter table ...",)
CHECKSUM = hashlib.sha256("\0".join(STATEMENTS).encode()).hexdigest()

def upgrade(connection: sqlite3.Connection) -> None:
    for statement in STATEMENTS:
        connection.execute(statement)
```

Add its corresponding `Migration` entry to `DEFAULT_MIGRATIONS`. Do not create
that revision while the pre-production policy remains active.
