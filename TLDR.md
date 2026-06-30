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
Email:         archies@email.com
Contact:       +639123456789
Enterprise ID: archies_001@tanaw.sanpedro
```

Complete its temporary-password onboarding and remember the password selected
for desktop login. Confirm the generated Enterprise ID; use the actual value if
it is not `archies_001@tanaw.sanpedro`.

## 6. Load the report simulation

This command creates LGU accounts, enterprise accounts, six months of
telemetry, historical submissions, final reports, activity logs, and prepared
current-month desktop counts for Archie's Event Place:

```shell
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data on --range 6m --scenario full-workflow --target-enterprise "archies_001@tanaw.sanpedro"
```

All generated accounts use:

```text
Password: TanawTest123!
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

Check the simulation:

```shell
docker compose exec backend uv run mock-data status
```

If a simulation already exists or needs fresh dates, replace it:

```shell
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data reset --range 6m --scenario full-workflow --target-enterprise "archies_001@tanaw.sanpedro"
```

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

The last command keeps running and opens Electron. It also starts the local ML
service at <http://127.0.0.1:8765>.

If PowerShell blocks `npm.ps1`, use:

```powershell
npm.cmd run dev
```

Sign in to the desktop:

```text
Username: archies@email.com
Password: the password selected during Archie's onboarding
```

A camera is not required for this test. The desktop downloads the target
enterprise's prepared current-month counts.

## 8. Complete the report test

In the enterprise desktop:

1. Wait for prepared counts to appear on the Dashboard.
2. Open **Reports & Submissions**.
3. Create a **New Draft**.
4. Complete any supplementary fields and submit the report.

In the web portal:

1. Sign in as `reports.staff@tanaw.test` with `TanawTest123!`.
2. Open **Batch Reports** for the current month.
3. Review the target report.
4. Mark it **Ready to Consolidate**.
5. Generate the final report.
6. Open **Final Reports Audit** and inspect its source rows.

## 9. Inspect the local ML simulation

Linux:

```shell
curl http://127.0.0.1:8765/mock/status
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/mock/status
```

## 10. Desktop local-data commands

Run these from `desktop-tanaw`. Close the desktop before any `clear` command.

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
run-tagged simulation data from another terminal opened at the repository root:

```shell
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data off
```

Confirm that the run is marked as removed:

```shell
docker compose exec backend uv run mock-data status
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

The database and simulation remain available after the next
`docker compose up -d`.

### Delete the entire Docker database

This deletes every PostgreSQL account and report, including real local records
and the default/temporary accounts:

```shell
docker compose down -v
```

Use `mock-data off` for normal simulation cleanup. Use `down -v` only when a
completely empty local database is intended.

## Everyday command cheat sheet

| Goal                         | Command                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start containers             | `docker compose up -d`                                                                                                                                          |
| Rebuild and start            | `docker compose up --build -d`                                                                                                                                  |
| Show containers              | `docker compose ps`                                                                                                                                             |
| Follow logs                  | `docker compose logs -f backend frontend`                                                                                                                       |
| Install desktop dependencies | From `desktop-tanaw`: `npm ci`, then `uv sync --directory ml-service --frozen`                                                                                  |
| Install default models       | From `desktop-tanaw`: `npm run models:setup`                                                                                                                    |
| Install full model set       | From `desktop-tanaw`: `npm run models:setup:full`                                                                                                               |
| Export OpenVINO models       | From `desktop-tanaw`: `npm run models:setup:openvino`                                                                                                           |
| Start desktop                | From `desktop-tanaw`: `npm run dev`                                                                                                                             |
| Generate mock data           | `docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data on --range 6m --scenario full-workflow --target-enterprise "archies_001@tanaw.sanpedro"` |
| Show mock status             | `docker compose exec backend uv run mock-data status`                                                                                                           |
| Refresh mock data            | `docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data reset --range 6m --scenario full-workflow --target-enterprise "archies_001@tanaw.sanpedro"` |
| Remove mock data             | `docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data off`                                                                                |
| Inspect desktop data         | From `desktop-tanaw`: `npm run local-data -- inspect`                                                                                                           |
| Clear one desktop ledger     | From `desktop-tanaw`: `npm run local-data -- clear --enterprise "archies_001@tanaw.sanpedro" --yes`                                                            |
| Stop containers              | `docker compose down`                                                                                                                                           |
| Delete Docker database       | `docker compose down -v`                                                                                                                                        |
