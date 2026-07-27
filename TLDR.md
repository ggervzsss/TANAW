# TANAW TL;DR Test Guide

This is the shortest command-focused guide for cloning TANAW, starting the
system, loading test data, completing the report workflow, managing desktop
data, and shutting everything down.

For architecture, configuration details, production guidance, and
troubleshooting, read the [full README](./README.md).

## Terminal notes

- Use Bash/Zsh on Linux or PowerShell on Windows.
- Commands marked `shell` work in both.
- Windows development currently targets 64-bit Windows 10/11 on x86-64.
- Start Docker Desktop with Linux containers before running Docker commands on
  Windows.
- Run Docker commands from the repository root unless stated otherwise.
- Docker runs PostgreSQL, the backend, and the web portal. The desktop app runs
  locally on the host.

## 1. Install the required tools

Install:

- Git
- Docker with Docker Compose
- Node.js `22.12.0` or newer
- [uv](https://docs.astral.sh/uv/)

Verify them:

```shell
git --version
docker compose version
node --version
npm --version
uv --version
```

Install the Python version used by backend tooling. The desktop ML service
supports Python 3.12 or newer, but Python 3.14 works across the repo:

```shell
uv python install 3.14
```

## 2. Clone the project

```shell
git clone https://github.com/ggervzsss/TANAW.git
cd TANAW
```

On Windows, a short path such as `C:\dev\TANAW` is recommended. Avoid OneDrive
or other synchronized folders for the development checkout.

## 3. Create the root environment file

Linux:

```shell
test -f .env || cp .env.example .env
```

Windows PowerShell:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Open `.env` and replace:

- `POSTGRES_PASSWORD`
- the matching password inside `DATABASE_URL`
- `JWT_SECRET_KEY`

Generate a unique JWT secret for this environment, then copy the printed value
into `JWT_SECRET_KEY` in `.env`.

Linux:

```shell
openssl rand -base64 48
```

Windows PowerShell:

```powershell
$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
    [Convert]::ToBase64String($bytes)
} finally {
    $rng.Dispose()
}
```

Keep the generated secret private, never commit it, and use a different value
for each development or production environment.

Keep `DATABASE_URL` pointed at the Docker hostname `db`:

```dotenv
DATABASE_URL=postgresql+asyncpg://postgres:your-password@db:5432/TanawDB
```

## 4. Start PostgreSQL, the backend, and the web portal

```shell
docker compose up --build -d
```

Check that the containers are running:

```shell
docker compose ps
```

Open:

- Web portal: <http://localhost:5173>
- API health: <http://localhost:8000/health>
- API documentation: <http://localhost:8000/docs>

Follow application logs if startup fails:

```shell
docker compose logs -f backend frontend
```

Press `Ctrl+C` to stop following logs. The containers continue running.

## 5. Test the web portal

The backend creates the original protected default account on startup:

```text
Role: IT Personnel
Username: default@email.com
Password: default
```

For now, it also creates these protected temporary accounts:

```text
Role: IT Personnel
Username: it@email.com
Password: it123456

Role: Admin
Username: admin@email.com
Password: admin123

Role: LGU Staff
Username: staff@email.com
Password: staffstaff
```

Sign in at <http://localhost:5173>. These startup-seeded passwords bypass
first-login password-change onboarding.

Create the persistent target account under **Enterprise Accounts** before
loading sample data:

```text
Enterprise:    Archie's Event Place
Category:      Events Venue
Manager:       Gervy Masbate
Barangay:      San Antonio
Address:       Narra Road, San Pedro, Laguna 4023
Email:         archies@email.com
Contact:       +639123456789
Enterprise ID: archies_001@tanaw.sanpedro
```

Complete its temporary-password onboarding and remember the password selected
for desktop login. Confirm the generated Enterprise ID; use the actual value if
it is not `archies_001@tanaw.sanpedro`.

## 6. Load the sample report workflow

This command creates LGU accounts, enterprise accounts, six months of
telemetry, historical submissions, closed-period final reports, activity logs,
and prepared previous-period plus current-period desktop counts for Archie's
Event Place:

```shell
./scripts/mockdata-on
```

PowerShell: `.\scripts\mockdata-on.ps1`

All sample accounts use:

```text
Password: Visitor sample access phrase 2026
```

Useful generated accounts:

| Purpose                 | Username                   |
| ----------------------- | -------------------------- |
| LGU Staff report review | `reports.staff@tanaw.test` |
| Admin portal            | `system.admin@tanaw.test`  |
| IT portal               | `it.operations@tanaw.test` |

Archie's is user-created, not generated:

```text
Desktop username: archies@email.com
Desktop password: the password selected during Archie's onboarding
```

Check the sample dataset:

```shell
./scripts/mockdata-status
```

PowerShell: `.\scripts\mockdata-status.ps1`

If a sample dataset already exists or needs fresh dates, replace it:

```shell
./scripts/mockdata-reset
```

PowerShell: `.\scripts\mockdata-reset.ps1`

Other ranges are `30d` and `12m`. Other scenarios are `peak-traffic` and
`camera-health`.

## 7. Install and start the enterprise desktop

Open a second terminal in the repository root:

```shell
cd desktop-tanaw
npm ci
uv sync --directory ml-service --frozen
npm run models:setup
npm run models:setup:reid
```

Linux:

```shell
printf 'VITE_API_BASE_URL=http://localhost:8000\n' > .env.local
npm run dev
```

Windows PowerShell:

```powershell
Set-Content -Path .env.local -Value "VITE_API_BASE_URL=http://localhost:8000"
npm run dev
```

The last command keeps running and opens Electron. It also starts the local ML
service at <http://127.0.0.1:8765>. The desktop `.env.local` points the Electron
renderer at the Dockerized backend.

If PowerShell blocks `npm.ps1`, use:

```powershell
npm.cmd ci
npm.cmd run models:setup
npm.cmd run models:setup:reid
npm.cmd run dev
```

Sign in to the desktop:

```text
Username: archies@email.com
Password: the password selected during Archie's onboarding
```

A camera is not required for this test. The desktop downloads the target
enterprise's overdue prepared counts first, then loads the current-period
counts after the overdue report syncs. If multiple unfinished periods are
available, use the desktop **Reporting Month** selector.

## 8. Complete the report test

In the enterprise desktop:

1. Wait for overdue prepared counts to appear on the Dashboard.
2. Open **Reports & Submissions**.
3. Select the overdue **Reporting Month** if needed.
4. Complete the demographic fields and submit the overdue report.
5. Wait for current-period prepared counts to appear.
6. Complete the demographic fields and submit the current report.

In the web portal:

1. Sign in as `reports.staff@tanaw.test` with
   `Visitor sample access phrase 2026`.
2. Open **Batch Reports** for the relevant reporting periods.
3. Review the target reports.
4. Mark them **Ready to Consolidate**.
5. Generate the final report.
6. Open **Final Reports Audit** and inspect its source rows.

## 9. Inspect local desktop metrics

Linux:

```shell
curl http://127.0.0.1:8765/metrics/summary
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/metrics/summary
```

## 10. Desktop local-data commands

Close the desktop before clearing local data.

Permanently remove all local desktop data, including databases, RTSP camera
definitions and encrypted credentials, authentication state, Chromium storage,
preferences, and caches:

```shell
./scripts/local-mockdata-off
```

PowerShell: `.\scripts\local-mockdata-off.ps1`

This is the full device reset. It is safe to run repeatedly and before or after
`mockdata-off`, which independently clears backend sample data. Lower-level
inspection and selective ledger commands still run from `desktop-tanaw`.

Inspect all enterprise ledgers:

```shell
npm run local-data -- inspect
```

Inspect one enterprise by its Enterprise ID:

```shell
npm run local-data -- inspect --enterprise "archies_001@tanaw.sanpedro"
```

The Enterprise ID is shown in the desktop Profile and by the unfiltered
`inspect` command. It is not the login email.

Completely remove one enterprise's local database, including camera profiles:

```shell
npm run local-data -- clear --enterprise "archies_001@tanaw.sanpedro" --yes
```

Clear every enterprise's operational rows but preserve SQLite camera profiles and Electron
preferences:

```shell
npm run local-data -- clear --all-ledgers --yes
```

Reset all desktop data, including authentication, saved cameras, preferences,
and caches:

```shell
npm run local-data -- clear --full-device --yes
```

These commands affect only the desktop device. They do not remove PostgreSQL
accounts or reports.

## 11. End the test and shut down

### Recommended clean ending

Keep the containers running, then remove the deterministic central sample
dataset from another terminal opened at the repository root:

```shell
./scripts/mockdata-off
```

PowerShell: `.\scripts\mockdata-off.ps1`

Confirm that the sample accounts are absent:

```shell
./scripts/mockdata-status
```

Quit the desktop app. If `npm run dev` is still active, press `Ctrl+C` in its
terminal.

Return to the repository root and stop the containers while preserving the
PostgreSQL volume:

```shell
docker compose down
```

### Stop now and preserve the sample dataset

Quit the desktop, then run:

```shell
docker compose down
```

The database and sample dataset remain available after the next
`docker compose up -d`.

### Delete the entire Docker database

This deletes every PostgreSQL account and report, including real local records
and the default/temporary accounts:

```shell
docker compose down -v
```

Use `sample-data off` for sample cleanup. Use `down -v` only when a
completely empty local database is intended.

## Everyday command cheat sheet

| Goal                         | Command                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Start containers             | `docker compose up -d`                                                         |
| Rebuild and start            | `docker compose up --build -d`                                                 |
| Show containers              | `docker compose ps`                                                            |
| Follow logs                  | `docker compose logs -f backend frontend`                                      |
| Install desktop dependencies | From `desktop-tanaw`: `npm ci`, then `uv sync --directory ml-service --frozen` |
| Install YOLO11 models        | From `desktop-tanaw`: `npm run models:setup`                                   |
| Install ReID models          | From `desktop-tanaw`: `npm run models:setup:reid`                              |
| Export OpenVINO models       | From `desktop-tanaw`: `npm run models:setup:openvino`                          |
| Start desktop                | From `desktop-tanaw`: `npm run dev`                                            |
| Generate sample data         | `./scripts/mockdata-on` or `.\scripts\mockdata-on.ps1`                         |
| Show sample-data status      | `./scripts/mockdata-status` or `.\scripts\mockdata-status.ps1`                 |
| Refresh sample data          | `./scripts/mockdata-reset` or `.\scripts\mockdata-reset.ps1`                   |
| Remove sample data           | `./scripts/mockdata-off` or `.\scripts\mockdata-off.ps1`                       |
| Inspect desktop data         | From `desktop-tanaw`: `npm run local-data -- inspect`                          |
| Reset all desktop data       | `./scripts/local-mockdata-off` or `.\scripts\local-mockdata-off.ps1`           |
| Stop containers              | `docker compose down`                                                          |
| Delete Docker database       | `docker compose down -v`                                                       |
