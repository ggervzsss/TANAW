# Local setup and everyday development

Use this guide after cloning TANAW. Docker runs PostgreSQL, the backend, and
the web portal. The enterprise desktop runs directly on your computer.

Run the commands from the stated directory. Shell commands work on Linux and
PowerShell unless separate examples are shown.

## 1. Install the required tools

| Tool                                                                          | What it is needed for                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Git](https://git-scm.com/downloads)                                          | Clone the code and manage changes.                                            |
| [Docker with Docker Compose](https://docs.docker.com/get-started/get-docker/) | Run the local database, backend, and portal.                                  |
| [Node.js and npm](https://nodejs.org/en/download/)                            | Run the desktop and JavaScript development tools. Use Node.js 22.12 or newer. |
| [uv](https://docs.astral.sh/uv/getting-started/installation/)                 | Install Python dependencies and run Python tools.                             |

On Windows, use PowerShell and start Docker Desktop with Linux containers.
Use a short checkout path such as C:\dev\TANAW outside OneDrive.
The supported Windows desktop development target is Windows 10/11 x64.

Check the tools and install the shared local Python version:

```shell
git --version
docker compose version
node --version
npm --version
uv --version
uv python install 3.14
```

The backend uses Python 3.14. The desktop ML service supports Python 3.12 or newer.

## 2. Clone and configure

```shell
git clone https://github.com/ggervzsss/TANAW.git
cd TANAW
```

Create the root .env only if it does not already exist.

Linux:

```shell
test -f .env || cp .env.example .env
```

PowerShell:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit the private root .env:

| Setting                                         | What to provide                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| POSTGRES_PASSWORD                               | The password for the local database.                             |
| DATABASE_URL                                    | The same database password, using db:5432 as the host and port.  |
| JWT_SECRET_KEY                                  | A long, randomly generated secret for this local environment.    |
| VITE_CARTO_BASEMAP_API_KEY                      | A browser key for the portal's map tiles.                        |
| GEOAPIFY_API_KEY                                | A server-side key for address search.                            |
| BOOTSTRAP_IT_USERNAME and BOOTSTRAP_IT_PASSWORD | Credentials for the first local IT account.                      |
| TANAW_SEED_DEVELOPMENT_ACCOUNTS                 | Keep true to create the template's optional local demo accounts. |
| EMAIL_DELIVERY_MODE                             | Keep log for local email previews without sending real messages. |

Keep the matching DEVELOPMENT\_\* values if you want the optional demo accounts.
With email log mode, leave BREVO_API_KEY blank. To test real email delivery,
configure a Brevo key, a verified EMAIL_FROM_ADDRESS, and brevo delivery mode.

Get the CARTO and Geoapify keys from the project maintainer or your own provider
accounts. Cloning the repository does not supply them. The basic stack can start
without those keys, but map tiles and address search need their configuration
to be fully usable.

Never commit populated environment files. The root .env.example is the local
Compose template; the app-level environment templates serve a different purpose
and should not replace it. URL-encode special characters in the password
inside DATABASE_URL. Keep the Docker hostname db rather than localhost.

Generate a JWT secret on Linux:

```shell
openssl rand -base64 48
```

PowerShell:

```powershell
$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes); [Convert]::ToBase64String($bytes) }
finally { $rng.Dispose() }
```

Copy the generated value into JWT_SECRET_KEY. Use a different value for each
environment.

## 3. Start the database, backend, and portal

From the repository root:

```shell
docker compose up --build -d
docker compose ps
```

| Service                       | Local address                |
| ----------------------------- | ---------------------------- |
| Web portal                    | http://localhost:5173        |
| Backend health                | http://localhost:8000/health |
| Interactive API documentation | http://localhost:8000/docs   |

Follow startup logs when needed:

```shell
docker compose logs -f backend frontend
```

Ctrl+C stops following logs; the containers continue running.

The first build and dependency installation can take several minutes. A running
container is not necessarily a ready application. Wait until /health responds
and the portal shows its sign-in form before continuing. If either is unavailable,
check the logs before changing account settings.

## 4. Sign in and activate a test enterprise

With the unchanged root template, a fresh database creates:

| Local role           | Username          | Password   |
| -------------------- | ----------------- | ---------- |
| Protected initial IT | default@email.com | default    |
| Additional IT        | it@email.com      | it123456   |
| Admin                | admin@email.com   | admin123   |
| LGU Staff            | staff@email.com   | staffstaff |

Only the initial IT account is protected. Optional demo accounts require
TANAW_SEED_DEVELOPMENT_ACCOUNTS=true. These are local template values; your
environment or an existing account can have different credentials.
Changing startup settings does not reset an existing account.

Sign in as IT Personnel and create an enterprise under **Enterprise Accounts**.
Complete the activation link and choose its password before using desktop login.

In local email log mode, messages appear in the development email viewer.
While signed in as IT in the development portal, click outside an input and
type devlog. Copy the new enterprise's activation link from its message.
Previews disappear after a backend restart.

Confirm the generated Enterprise ID in the account details or desktop Profile.
For example, the seed lolouweng may produce lolouweng_001@tanaw.sanpedro.
The actual sequence may differ.

## 5. Start the enterprise desktop

Open another terminal at the repository root:

```shell
cd desktop-tanaw
npm ci
uv sync --directory ml-service --frozen
npm run models:setup
npm run models:setup:reid
```

Create .env.local in desktop-tanaw with:

```dotenv
VITE_API_BASE_URL=http://localhost:8000
```

This points the desktop at the local backend. Preserve other values if that
file already exists.

Model setup downloads detector weights and exports the appearance-matching
models. It needs internet access and can take several minutes. The first desktop
launch may also download the Electron runtime. Let each command finish successfully
before moving on.

Start the app:

```shell
npm run dev
```

Sign in with the activated enterprise's registered email and chosen password.
Electron starts the local ML service at 127.0.0.1:8765; the development renderer
uses port 5174. You do not need to start the ML service separately.

For live counting, open **Camera Setup**, add a compatible RTSP camera, and
test its connection. Use **Edit Configuration** to position entry/exit lines
or draw an open-space area. The computer must be able to reach the camera.

## 6. Try the report workflow without a camera

From the repository root, load sample records for your active, activated
enterprise. Replace lolouweng with your account seed or Enterprise ID.

Linux:

```shell
./scripts/mockdata-on lolouweng
```

PowerShell:

```powershell
.\scripts\mockdata-on.ps1 lolouweng
```

No target is selected automatically. A seed must match one enterprise; if
several match, use the numbered or full ID shown in the account details.
An exact account ID, email, or enterprise name also works.

The target account is preserved. The script creates supporting records and
prepared counts that the desktop imports after that enterprise signs in.
Supporting sample accounts use **Visitor sample access phrase 2026**:

| Role         | Username                 |
| ------------ | ------------------------ |
| LGU Staff    | reports.staff@tanaw.test |
| Admin        | system.admin@tanaw.test  |
| IT Personnel | it.operations@tanaw.test |

In the desktop, wait for prepared counts and choose the oldest unfinished month
under **Reports & Submissions**. Complete the demographic fields and submit.
After synchronization, the next prepared month can load. Repeat for each available
month; the sample dataset can contain several overdue periods.

In the portal, sign in as the sample LGU Staff account. Review the submissions
under **Batch Reports**, mark eligible records **Ready to Consolidate**, generate
a final report, and inspect its sources under **Final Reports Audit**.

## Everyday commands

From the repository root:

| Task                                      | Command                                 |
| ----------------------------------------- | --------------------------------------- |
| Start the existing stack                  | docker compose up -d                    |
| Rebuild and start                         | docker compose up --build -d            |
| Check service status                      | docker compose ps                       |
| Follow backend and portal logs            | docker compose logs -f backend frontend |
| Restart after backend dependency changes  | docker compose restart backend          |
| Restart after frontend dependency changes | docker compose restart frontend         |
| Stop and preserve database records        | docker compose down                     |

Sample-data scripts also run from the repository root:

| Task                          | Linux                           | PowerShell                          |
| ----------------------------- | ------------------------------- | ----------------------------------- |
| Create sample data            | ./scripts/mockdata-on TARGET    | .\scripts\mockdata-on.ps1 TARGET    |
| Check sample-data status      | ./scripts/mockdata-status       | .\scripts\mockdata-status.ps1       |
| Replace the sample dataset    | ./scripts/mockdata-reset TARGET | .\scripts\mockdata-reset.ps1 TARGET |
| Remove central sample data    | ./scripts/mockdata-off          | .\scripts\mockdata-off.ps1          |
| Remove all local desktop data | ./scripts/local-mockdata-off    | .\scripts\local-mockdata-off.ps1    |

Only one central sample dataset is supported. Reset validates the target before
replacing the dataset. Defaults are 6m and full-workflow; other ranges are
30d and 12m, and other scenarios are peak-traffic and camera-health.

For example:

```shell
./scripts/mockdata-reset lolouweng --range 12m --scenario peak-traffic
```

The PowerShell equivalent uses .\scripts\mockdata-reset.ps1 with the same
arguments. TANAW_MOCK_TARGET_ENTERPRISE, TANAW_MOCK_RANGE, and
TANAW_MOCK_SCENARIO provide defaults when needed; an explicit target overrides
its environment value. The --seed option changes random sample values, not
account selection.

Generated data uses reserved identifiers. Do not reuse those identifiers for
ordinary records. Central sample cleanup does not delete desktop records.

From desktop-tanaw:

| Task                            | Command                                                 |
| ------------------------------- | ------------------------------------------------------- |
| Start the desktop               | npm run dev                                             |
| Inspect saved local records     | npm run local-data -- inspect                           |
| Prepare OpenVINO models         | npm run models:setup:openvino                           |
| Verify detector and ReID assets | npm run models:verify -- --profile balanced --reid fast |

Camera recordings and evaluation results belong in the ignored
ml-service/evaluation directories. The replay and evaluation tools expose
their options through --help, for example:

```shell
uv run --directory ml-service python -m scripts.replay_tracking --help
uv run --directory ml-service python -m scripts.evaluate_tracking --help
uv run --directory ml-service python -m scripts.replay_open_space --help
```

## Check changes before committing

From frontend-tanaw or desktop-tanaw, install dependencies with npm ci, then:

```shell
npm run lint
npm run type
npm test
```

Use npm run test:e2e for browser workflows. From desktop-tanaw, npm run
test:electron checks the real Electron bridge. Browser fixtures do not run
camera inference or replace physical-camera testing.

The frontend's development email scenario uses TANAW_E2E_DEV_LOG=true with
npm run test:e2e. Its real-backend activation scenario requires
TANAW_E2E_REAL_BACKEND=true and the disposable database and IT account
settings listed in that test.

From backend-tanaw, prepare local Python tools with uv sync --frozen, then:

```shell
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pyright
uv run pytest
```

The same Python commands apply from desktop-tanaw/ml-service after its
dependency setup. PostgreSQL integration tests require TANAW_TEST_DATABASE_URL
pointing to a dedicated disposable test database with the current schema.

After changing backend API schemas, install and run the contract generator
from the repository root:

```shell
npm --prefix backend-tanaw/scripts/contracts ci
npm --prefix backend-tanaw/scripts/contracts run generate
npm --prefix backend-tanaw/scripts/contracts run check
```

Commit the generated types in both clients. Run generation in the monorepo;
each standalone app can build from its committed types without the other
repositories.

## Stop or reset local development data

Quit the desktop through its tray menu and stop npm run dev with Ctrl+C.
Use docker compose down to stop containers while keeping PostgreSQL records.

Close the app before any local-data clear operation:

| Scope                              | Command from desktop-tanaw                                        | What it removes                                                                          |
| ---------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| One enterprise                     | npm run local-data -- clear --enterprise YOUR_ENTERPRISE_ID --yes | That enterprise's complete local database, including camera profiles and reports.        |
| Operational records in all ledgers | npm run local-data -- clear --all-ledgers --yes                   | Operational rows while preserving camera profiles and device preferences.                |
| Full device                        | npm run local-data -- clear --full-device --yes                   | Local databases, saved cameras and credentials, authentication, preferences, and caches. |

Use the Enterprise ID shown in Profile, rather than the login email.
Local resets do not remove central records. The root local-mockdata-off
script performs a full-device reset and refuses to run while the app is open.

While TANAW remains pre-production, PostgreSQL 0001 and SQLite 001 are the
canonical baselines. Update those directly for schema changes and recreate
disposable local databases. Keep migration infrastructure; do not add later
revisions merely to preserve development data. A restart does not reapply an
edited baseline, and a mismatch is rejected without automatically deleting data.

To recreate the complete disposable Docker database:

```shell
docker compose down -v
docker compose up --build -d
```

This deletes every PostgreSQL account and report in the local Compose volume.
It does not clear desktop data.

## Common setup problems

- **Docker will not start:** start its engine and confirm Windows uses Linux containers.
- **A command is missing:** reopen the terminal after installing tools.
- **PowerShell blocks npm.ps1:** use npm.cmd ci or npm.cmd run dev.
- **Dependency paths are too long:** move the checkout to a shorter path outside synchronized folders.
- **The backend cannot connect:** keep DATABASE_URL on db:5432 and match its password to POSTGRES_PASSWORD.
- **A service port is occupied:** inspect docker compose ps and stop an older instance before starting another.
- **Prepared counts do not appear:** sign in as the exact sample-data target and allow time for synchronization.
- **API checks against the local ML service fail:** Electron authenticates that service; use the desktop or local-data inspection rather than unauthenticated requests.
- **A sample dataset already exists:** use mockdata-reset with the target or remove the current sample dataset first.
