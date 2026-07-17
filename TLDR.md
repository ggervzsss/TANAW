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

Generate a strong JWT secret in your terminal.

Linux:

```shell
openssl rand -hex 32
```

Windows PowerShell:

```powershell
$bytes = New-Object byte[] 32
([Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($bytes)
[BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()
```

Open `.env` and replace:

- `POSTGRES_PASSWORD`
- the matching password inside `DATABASE_URL`
- `JWT_SECRET_KEY` with the generated JWT secret

Keep `DATABASE_URL` pointed at the Docker hostname `db`:

```dotenv
DATABASE_URL=postgresql+asyncpg://postgres:your-password@db:5432/tanaw_local
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
loading mock data:

```text
Enterprise:    Archie's Event Place
Category:      Events Venue
Manager:       Gervy Masbate
Barangay:      San Antonio
Address:       Narra Road, San Pedro, Laguna 4023
Email:         your current enterprise login email
Contact:       +639123456789
Enterprise ID: archies_001@tanaw.sanpedro
```

Complete its temporary-password onboarding and remember the password selected
for desktop login. Confirm the generated Enterprise ID; use the actual value if
it is not `archies_001@tanaw.sanpedro`.

## 6. Load mock report data

This command creates LGU and enterprise test accounts, canonical monthly
obligations, historical submissions for the five generated enterprises, an
already-submitted previous-month report for Archie's, and current-month desktop
counts for Archie's:

```shell
./scripts/mockdata-on
```

PowerShell: `.\scripts\mockdata-on.ps1`

All generated accounts use:

```text
Password: Visitor simulation access phrase 2026
```

Useful generated accounts:

| Purpose                 | Username                   |
| ----------------------- | -------------------------- |
| LGU Staff report review | `reports.staff@tanaw.test` |
| Admin portal            | `system.admin@tanaw.test`  |
| IT portal               | `it.operations@tanaw.test` |

Archie's is user-created, not generated:

```text
Desktop username: the current email attached to Archie's Enterprise ID
Desktop password: the password selected during Archie's onboarding
```

Check the mock-data run:

```shell
./scripts/mockdata-status
```

PowerShell: `.\scripts\mockdata-status.ps1`

If mock data already exists or needs fresh dates, replace it:

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
npm run dev
```

The last command keeps running and opens Electron. Electron starts the local ML
service on an ephemeral loopback port, transfers a fresh capability through a
private pipe, verifies the child, and proxies all access through narrow IPC and
the controlled `tanaw-ml:` stream protocol. There is no fixed or directly
accessible ML URL.

If PowerShell blocks `npm.ps1`, use:

```powershell
npm.cmd run dev
```

Sign in to the desktop:

```text
Username: the current email attached to Archie's Enterprise ID
Password: the password selected during Archie's onboarding
```

A camera is not required for this test. The desktop reads the previous-month
submission from central history and loads only the current-month package as a
draft. TANAW enables submission automatically after that month ends.

## 8. Complete the report test

In the enterprise desktop:

1. Open **Reports & Submissions**.
2. Confirm that the previous month is present in submitted history.
3. Confirm that current-month counts are available as a draft; submit them only
   after the reporting month ends.

In the web portal:

1. Sign in as `reports.staff@tanaw.test` with
   `Visitor simulation access phrase 2026`.
2. Open **Batch Reports** for a historical reporting period.
3. Confirm the five generated enterprises and Archie's submitted reports.
4. Mark them **Ready to Consolidate**.
5. Generate the final report.
6. Open **Final Reports Audit** and inspect its exact immutable revision items.

## 9. Inspect prepared mock data

Use the signed-in desktop Dashboard and reporting-period selector. The desktop
has no built-in simulator or Simulation Lab; mock data is loaded and removed
only through the repository scripts. Direct browser, renderer fetch,
PowerShell, and `curl` access to the Electron-owned ML child is intentionally
unsupported.

## 10. Desktop local-data commands

Close the desktop before clearing local data.

Remove all local desktop ledger data, including official CCTV-derived rows and
simulation runs, while preserving camera definitions, Electron preferences, authentication
storage, and caches:

```shell
./scripts/local-data-reset
```

PowerShell: `.\scripts\local-data-reset.ps1`

The lower-level inspection and full reset commands still run from
`desktop-tanaw`.

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

Clear only one enterprise's local ledger:

```shell
npm run local-data -- clear --enterprise "archies_001@tanaw.sanpedro" --yes
```

Clear every enterprise ledger but preserve camera definitions and Electron
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

Keep the target desktop signed in and the containers running, then remove all
run-owned mock data from another terminal opened at the repository root:

```shell
./scripts/mockdata-off
```

PowerShell: `.\scripts\mockdata-off.ps1`

Confirm that the run is marked as removed:

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

### Stop now and preserve the simulation

Quit the desktop, then run:

```shell
docker compose down
```

The database and mock data remain available after the next
`docker compose up -d`.

### Delete the entire Docker database

This deletes every PostgreSQL account and report, including real local records
and the default/temporary accounts:

```shell
docker compose down -v
```

Use `mockdata off` for normal mock-data cleanup. Use `down -v` only when a
completely empty local database is intended.

## Everyday command cheat sheet

| Goal                         | Command                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start containers             | `docker compose up -d`                                                                                                                                          |
| Rebuild and start            | `docker compose up --build -d`                                                                                                                                  |
| Show containers              | `docker compose ps`                                                                                                                                             |
| Follow logs                  | `docker compose logs -f backend frontend`                                                                                                                       |
| Install desktop dependencies | From `desktop-tanaw`: `npm ci`, then `uv sync --directory ml-service --frozen`                                                                                  |
| Install YOLO11 models        | From `desktop-tanaw`: `npm run models:setup`                                                                                                                    |
| Export OpenVINO models       | From `desktop-tanaw`: `npm run models:setup:openvino`                                                                                                           |
| Start desktop                | From `desktop-tanaw`: `npm run dev`                                                                                                                             |
| Generate mock data           | `./scripts/mockdata-on` or `.\scripts\mockdata-on.ps1`                                                                                                       |
| Show mock-data status        | `./scripts/mockdata-status` or `.\scripts\mockdata-status.ps1`                                                                                               |
| Refresh mock data            | `./scripts/mockdata-reset` or `.\scripts\mockdata-reset.ps1`                                                                                                 |
| Remove mock data             | `./scripts/mockdata-off` or `.\scripts\mockdata-off.ps1`                                                                                                     |
| Inspect desktop data         | From `desktop-tanaw`: `npm run local-data -- inspect`                                                                                                           |
| Clear desktop local ledgers  | `./scripts/local-data-reset` or `.\scripts\local-data-reset.ps1`                                                                                               |
| Stop containers              | `docker compose down`                                                                                                                                           |
| Delete Docker database       | `docker compose down -v`                                                                                                                                        |
