# TANAW Backend

FastAPI backend for TANAW authentication, account management, operational sync, reporting, and mock-data tooling.

## Local Setup

1. Create a local PostgreSQL database named `tanaw_local`.
2. Copy `.env.example` to `.env`.
3. Update `DATABASE_URL` if your local PostgreSQL username, password, host, port, or database name differs.
4. Start the API:

```bash
uvicorn main:app --reload
```

On startup, the API creates current tables when needed and seeds the default IT account if it does not already exist:

- Username: `default@email.tanaw`
- Password: `default`

Change the default password before using the system beyond local bootstrap.

## Mock Data Support

TANAW keeps mock data support in the codebase intentionally. It is useful for testing reporting, analytics, Staff review, final report consolidation, desktop sync, and LGU workflows without waiting for months of real operational data.

This is not a code-quality problem as long as mock execution remains:

- explicit
- disabled by default
- tagged for audit and cleanup
- separate from normal production behavior

Mock data does not run automatically during backend startup.

### Safety Guard

Mock commands refuse to create or remove mock data unless this environment variable is enabled:

```bash
TANAW_ALLOW_MOCK_DATA=true
```

Do not enable this variable in production unless an administrator intentionally needs mock tooling in a controlled diagnostic environment.

### Commands

Run commands from the backend root:

```bash
uv run mock-data on
uv run mock-data off
uv run mock-data status
uv run mock-data reset
```

For the deterministic target-enterprise acceptance workflow, use:

```bash
TANAW_ALLOW_MOCK_DATA=true uv run mock-data reset \
  --range 6m \
  --target-enterprise "archies_001@tanaw.sanpedro"
```

See [MOCK_DATA_TARGET_ACCOUNT_GUIDE.md](./MOCK_DATA_TARGET_ACCOUNT_GUIDE.md) for the complete desktop-to-Staff testing manual.

Common local workflow:

```bash
TANAW_ALLOW_MOCK_DATA=true uv run mock-data on --range 6m
TANAW_ALLOW_MOCK_DATA=true uv run mock-data reset --range 6m
TANAW_ALLOW_MOCK_DATA=true uv run mock-data off
```

When the backend is running through Docker Compose, run the command inside the backend container:

```bash
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data on --range 6m
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data reset --range 6m
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data off
```

If the target enterprise is logged into the desktop, the desktop automatically retrieves finite current-period counts for its scoped local ledger. A running CCTV/IP camera is optional:

```bash
TANAW_ALLOW_MOCK_DATA=true uv run mock-data reset \
  --range 6m \
  --target-enterprise "archies_001@tanaw.sanpedro"
```

From Docker Compose:

```bash
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend \
  uv run mock-data reset \
  --range 6m \
  --target-enterprise "archies_001@tanaw.sanpedro"
```

The prepared count package does not create a report automatically. The enterprise tester creates and submits that report manually. If a real camera is running, subsequent camera events continue accumulating in the same draft. Docker does not need direct access to the local ML service.

### Authentic Presentation

Generated accounts, enterprise identifiers, gateway identifiers, reports, activity logs, and desktop analytics metadata use normal operational wording and production-style formats. The word `mock` is intentionally excluded from user-facing account details, reports, audit summaries, notes, errors, and analytics identity values.

Generated email addresses use the reserved `.test` domain so they look natural inside TANAW without risking delivery to real recipients. All generated testing accounts use this local-only password:

```text
TanawTest123
```

Internal provenance is intentionally unchanged. Database fields such as `source_kind` and `mock_run_id`, the guarded terminal command, and internal cleanup APIs must continue to identify generated records. This distinction gives QA an authentic user experience while keeping generated records auditable and safely removable.

Generator changes apply to newly created records. Refresh an older active dataset with `mock-data reset` to replace previously generated labels and identifiers.

### Time Range Behavior

The default mock range is a rolling 6-month reporting window. It is calculated when the command runs.

For example:

- Running in June 2026 creates January 2026 through June 2026.
- Running in July 2026 creates February 2026 through July 2026.
- Running in January 2027 creates August 2026 through January 2027.

This means the range is not permanently fixed to one set of months. It follows the current date whenever mock data is generated.

However, active mock data does not automatically roll forward every month. A mock run is a snapshot. If development continues for several months, refresh it with:

```bash
TANAW_ALLOW_MOCK_DATA=true uv run mock-data reset --range 6m
```

Recommended rhythm:

- Local development: reset whenever the dataset feels stale.
- Staging/demo: reset before demos or major QA sessions.
- Monthly reporting tests: reset at the beginning of a new reporting month.

### Supported Ranges And Scenarios

Ranges:

```bash
--range 30d
--range 6m
--range 12m
```

Scenarios:

```bash
--scenario full-workflow
--scenario peak-traffic
--scenario camera-health
```

The default is:

```bash
--range 6m --scenario full-workflow
```

The default workflow is deterministic:

- all active enterprises have consolidated historical submissions;
- all supporting enterprises are ready for the current month;
- only the selected target enterprise is missing for the current month;
- the target desktop receives prepared counts but no automatic current report.

### Cleanup Rules

Mock data is tagged with provenance fields:

- `source_kind`: `real`, `mock`, or `hybrid`
- `mock_run_id`: identifies one generated mock run

Cleanup uses `mock_run_id`. It does not delete records by name, date, email prefix, or report code alone.

This keeps real records safe when running:

```bash
TANAW_ALLOW_MOCK_DATA=true uv run mock-data off
```

## Reporting And Operational Sync

The backend stores operational data received from enterprise desktop apps:

- telemetry snapshots
- intake report submissions
- report review statuses
- final reports
- final report source rows
- operational activity logs

The preferred testing model is:

```text
mock producer, real pipeline
```

That means mock data should enter through the same operational shapes that real TANAW data uses. Staff dashboards, analytics, report review, and final report consolidation should consume backend data normally.

## Deployment Guidance

Before a full deployment:

1. Keep mock-data code in the repository.
2. Leave `TANAW_ALLOW_MOCK_DATA` unset or set to `false` in production.
3. Do not seed mock data during startup.
4. Run `mock-data off` in any staging/demo database that might be copied into production.
5. Confirm production contains no active `mock_data_runs`.
6. Use real operational ingestion for production data.

Keeping the mock-data implementation is acceptable and useful. The important rule is that mock execution must be opt-in, auditable, and removable.

## Render Deployment

Set these environment variables on the Render web service before deploying:

- `TANAW_ENV`: set to `production` on Render.
- `DATABASE_URL`: PostgreSQL internal database URL for the Render database.
- `JWT_SECRET_KEY`: a long random secret.
- `DEFAULT_IT_USERNAME` and `DEFAULT_IT_PASSWORD`: bootstrap credentials.
- `CORS_ORIGINS`: comma-separated frontend origins allowed to call the API. Production should be `https://tanaw-sanpedro.vercel.app` only unless another TANAW-owned frontend origin is intentionally deployed.
- `TANAW_ALLOW_MOCK_DATA`: omit or set to `false` for production.

Wildcard CORS origins are rejected in production. Keep localhost origins in local `.env` files only.
Localhost and private-network CORS origins are also rejected in production, and browser WebSocket connections are checked against the same allowed origin list.

The backend opens the database connection during FastAPI startup to create tables and seed the default IT account. If `DATABASE_URL` is missing or points to `localhost`, Render will deploy the image but the service will fail at startup because there is no PostgreSQL server inside the web container.

## Backend Structure

The backend is organized by shared infrastructure and feature domains:

```text
app/
  api/                 # Top-level API router composition
  core/                # Settings, security, and app-wide utilities
  db/                  # SQLAlchemy base, engine, sessions, metadata imports
  features/
    accounts/          # Account models, dependencies, services, account APIs
    activity_logs/     # Operational and account activity records
    auth/              # Login, logout, password change, recovery flows
    mock_data/         # Explicit CLI-driven mock data tooling
    operational/       # Desktop sync, telemetry, intake reports, final reports
```

Desktop-specific ML processing stays in the desktop application. The backend receives resulting records and workflow events through operational APIs.
