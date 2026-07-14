# TANAW Enterprise Desktop

Electron, React, TypeScript, Vite, and local FastAPI ML service for
enterprise-side camera monitoring, local counting, local report drafting, cloud
sync, and offline-friendly operational workflows.

## Full Setup After Cloning

The backend, web portal, and PostgreSQL should be started with the root Docker
Compose stack. The desktop app itself runs locally on the host because it needs
native Electron behavior, local storage, ML model files, and camera/network
access.

The desktop app requires Node.js 22.12 or newer, npm, Python 3.12 or newer for
the local ML service, and `uv`. Camera AI requires detector and ReID model
assets under `ml-service/models/`.

The desktop renderer runs on port `5174` in development. Electron starts the
local ML service on an operating-system-selected ephemeral loopback port. The
port and its per-launch capability are private implementation details; there is
no fixed or user-configurable ML port.

### Linux

From the TANAW repository root:

```bash
test -f .env || cp .env.example .env
docker compose up --build -d
cd desktop-tanaw
npm ci
uv sync --directory ml-service --frozen
npm run models:setup
printf 'VITE_API_BASE_URL=http://localhost:8000\n' > .env.local
npm run dev
```

If `.env` already exists, do not overwrite it. The desktop `.env.local` points
the local Electron renderer at the Dockerized backend.

### Windows PowerShell

From the TANAW repository root:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up --build -d
Set-Location desktop-tanaw
npm ci
uv sync --directory ml-service --frozen
npm run models:setup
Set-Content -Path .env.local -Value "VITE_API_BASE_URL=http://localhost:8000"
npm run dev
```

If `.env` already exists, do not overwrite it. The desktop `.env.local` points
the local Electron renderer at the Dockerized backend.

### Expected Local Services

- Dockerized web portal: `http://localhost:5173`
- Dockerized backend API: `http://localhost:8000`
- Desktop renderer: `http://127.0.0.1:5174`
- Local ML service: Electron-owned ephemeral `127.0.0.1` endpoint (not directly accessible)

Electron starts the ML service automatically from `ml-service/main.py`, sends a
fresh cryptographic capability through a private bootstrap pipe, verifies the
spawned child PID and an authenticated health challenge, and owns every local
REST, WebSocket, and stream connection. The renderer uses validated named IPC
operations and the controlled `tanaw-ml:` media protocol. Direct browser,
renderer `fetch`, and `curl` access are deliberately unsupported. A process on
an old or guessed fixed port is never trusted.

Camera credentials are transformed into Electron's operating-system-backed
secure store, bound to the exact camera type and stream endpoint, and never
returned to the renderer. TANAW removes the former browser credential record
after that one-time transform and fails closed when secure storage is
unavailable.

### Docker Boundary

The desktop app is not containerized for normal development or production use.
Dockerizing the Electron runtime would make camera access, native app storage,
tray behavior, installer packaging, and Windows permissions harder for end
users. Use Docker for the central backend/frontend/database stack, and run the
desktop locally.

Containerizing desktop internals can still be useful for CI or isolated
ML-service checks, but it is not the supported way to run the enterprise app.

## Development Commands

Linux and PowerShell use the same commands from `desktop-tanaw`:

```bash
npm run dev
npm run build
npm run dist
npm run lint
npm run type
npm run preview:web
```

`npm run dev` starts the Vite/Electron development flow. `npm run dist` builds
the renderer and packages the Electron app.

## ML Model Setup

ML model binaries are intentionally not committed to Git. Keep local assets under:

```text
ml-service/models/
```

Default setup:

```bash
npm run models:setup
```

This prepares the detector inventory and validates an existing fast ReID model
or downloads its checkpoint and exports a fresh ONNX model when missing:

- `models/yolo11n.pt` for emergency and compatibility fallback profiles
- `models/yolo11s.pt` for the default balanced profile
- `models/yolo11m.pt` for the high-accuracy profile
- `models/person_reid_cpu.onnx` for fast person re-identification

To download a smaller detector subset for constrained testing while still
provisioning ReID, run the focused setup commands:

```bash
npm run models:setup:detector -- --models yolo11n yolo11s
npm run models:setup:reid
```

Generate CPU/Intel OpenVINO exports:

```bash
npm run models:setup:openvino
```

Expected OpenVINO export folders:

```text
models/yolo11n_480_openvino_model/
models/yolo11n_640_openvino_model/
models/yolo11s_640_openvino_model/
models/yolo11m_640_openvino_model/
```

PowerShell uses the same npm scripts.

## ML Processing Profiles

- `auto`: selects the best available stable profile for the device.
- `emergency`: YOLO11n at 480px, ByteTrack, OpenVINO -> CPU -> CUDA, ReID off.
- `compatibility`: YOLO11n at 640px, ByteTrack, CUDA -> OpenVINO -> CPU, ReID off by default.
- `balanced`: YOLO11s at 640px, BoT-SORT, CUDA -> OpenVINO -> CPU, fast ReID.
- `high_accuracy`: YOLO11m at 640px, BoT-SORT, CUDA -> OpenVINO -> CPU, fast ReID.

Stable detector runtimes are `cpu`, `cuda`, and `openvino`. TensorRT and DirectML provider detection may appear in diagnostics, but they are not stable detector runtime choices.

## Counting, Tripwires, And Unique Visitors

Normal users should configure only the camera stream, start/stop processing, and adjust the entry/exit tripwires. Advanced AI tuning is kept behind the advanced settings area.

Counting uses:

- tracking confidence to keep person tracks alive;
- stricter counting confidence before a track can be counted;
- full-frame ROI by default;
- entry and exit tripwire sequence;
- cooldowns to avoid duplicate counts;
- optional ReID for estimated daily unique visitors.

Unique visitor fields are estimates:

- `estimated_unique_count`: daily unique estimate used by the UI.
- `confirmed_unique_count`: entries linked to a ReID visitor ID.
- `degraded_unique_count`: entries counted as unique when ReID is off, unavailable, or timed out.
- `pending_unique_entries`: entries waiting briefly for async ReID.
- `repeat_entry_count`: entry events linked to an existing visitor or otherwise not unique.

## Local Data And Ledgers

TANAW Enterprise Desktop stores count events, occupancy corrections, report drafts, submitted local reports, visitor identity metadata, camera settings, and application preferences on the device.

Commands below run from `desktop-tanaw`. Close the desktop application before running any clear command.

### Inspect Local Data

Inspect every local ledger:

```bash
npm run local-data -- inspect
```

Inspect one enterprise:

```bash
npm run local-data -- inspect --enterprise "archies_001@tanaw.sanpedro"
```

Show more recent events and reports:

```bash
npm run local-data -- inspect --enterprise "archies_001@tanaw.sanpedro" --limit 25
```

Produce JSON:

```bash
npm run local-data -- inspect --json
```

PowerShell uses the same commands.

Inspection output includes:

- Electron app-data and SQLite ledger paths;
- row counts for camera live state, events, rollups, immutable report revisions,
  outbox history, visitor identity tables, and occupancy corrections;
- real, generated, and hybrid provenance totals;
- current unsubmitted draft event count;
- first and last event timestamps;
- recent events and reports;
- Chromium local-storage size and location.

Sensitive embedding blobs and full event payloads are not printed.

### Clear One Enterprise Ledger

```bash
npm run local-data -- clear --enterprise "archies_001@tanaw.sanpedro" --yes
```

This deletes only that enterprise's target edge ledger (camera live state, count events,
rollups, immutable local report revisions, outbox history, coverage evidence, occupancy
correction audit, and visitor identity metadata) plus its active ML camera session.

It preserves other enterprise ledgers, saved camera definitions, device IDs, theme settings, authentication storage, and backend records.

### Clear Every Local Ledger

```bash
npm run local-data -- clear --all-ledgers --yes
```

This deletes all enterprise-scoped ledgers and the target unbound startup ledger. Chromium local storage and camera definitions remain.

### Full Device Reset

```bash
npm run local-data -- clear --full-device --yes
```

This deletes the complete Electron user-data directory, including local ledgers, saved CCTV/IP camera definitions, desktop device IDs, authentication and notification storage, theme and application preferences, Electron caches, and browser local storage.

The next desktop launch behaves like a new installation on that device.

### Custom App-Data Directory

```bash
npm run local-data -- --app-data-dir "/path/to/electron/user-data" inspect
```

PowerShell:

```powershell
npm run local-data -- --app-data-dir "C:\Path\To\Electron\User Data" inspect
```

Default Linux development path:

```text
~/.config/desktop-tanaw
```

## Using Mock Or Generated Local Data

There are two supported ways to use generated data in the desktop.

### Hidden Simulation Lab

Type `simulation` anywhere in the desktop application to reveal the temporary **Simulation Lab** navigation item. Open it to generate live entry and exit events without connecting a CCTV camera.

The simulator writes to the same enterprise-scoped SQLite ledger used by camera detections, so the dashboard, report draft, cloud telemetry, Admin map, and alert workflow exercise the normal desktop data path.

Available controls include scenario presets, venue capacity, starting occupancy, event rate, duration, alert threshold, pause/resume, manual entry/exit events, and per-run cleanup. Simulated rows remain internally tagged with their run identifier and can be removed without deleting real camera events.

To remove simulation data and any other local ledger rows:

1. Use the Simulation Lab reset/cleanup controls when the run is active.
2. Or clear every local ledger while preserving camera definitions and settings:

   ```bash
   npm run local-data -- clear --all-ledgers --yes
   ```

PowerShell uses the same command.

### Backend Prepared Counts

The backend mock-data tool can prepare counts for a target enterprise. When that enterprise logs into the desktop, the desktop retrieves pending prepared packages through the authenticated backend connection and writes the selected period into the local ledger. For Archie's Event Place, the default scenario loads the overdue previous-period package first, exposes unfinished periods in the **Reporting Month** selector, then loads the current-period package after the overdue report syncs.

Prepare from the project root:

```bash
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend \
  uv run mock-data reset \
  --range 6m \
  --target-enterprise "archies_001@tanaw.sanpedro"
```

PowerShell:

```powershell
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend `
  uv run mock-data reset `
  --range 6m `
  --target-enterprise "archies_001@tanaw.sanpedro"
```

Verify the prepared state in the signed-in desktop application's **Simulation
Lab** and report-period selector. The authenticated Electron bridge is the only
supported local service client; no direct ML-service status URL is exposed.

Remove generated backend and prepared desktop data:

```bash
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data off
```

PowerShell:

```powershell
docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend uv run mock-data off
```

Run backend cleanup before clearing local ledgers when a generated backend run is still active. Otherwise, signing the target enterprise back in can prepare that active run again in a newly created local ledger.

## Occupancy Corrections

Manual corrections are stored separately from count events. Current occupancy is:

```text
entries - exits + sum(correction_delta)
```

Corrections include old/new occupancy, delta, reason, optional actor metadata, source kind, mock run ID, and timestamp. Generated and hybrid corrections are removable with the mock reset tools.

## Tracking Evaluation

Use `ml-service/evaluation/` for representative clips and JSONL ground truth. Record walking, running, two-person crossings, short occlusions, temporary obstructions, re-entry, groups, and poor lighting.

Ground-truth frame example:

```json
{ "frame_index": 12, "people": [{ "id": "person-1", "bbox": [10, 20, 80, 180] }], "events": [{ "person_id": "person-1", "direction": "entry" }] }
```

Prediction frame example:

```json
{
  "frame_index": 12,
  "tracks": [{ "track_id": 4, "source_track_id": 19, "bbox": [11, 20, 81, 180] }],
  "events": [{ "track_id": 4, "direction": "entry" }],
  "processing_ms": 220.0,
  "frame_age_ms": 40.0,
  "cpu_percent": 78.0
}
```

Run replay and evaluation:

```bash
uv run --directory ml-service python scripts/replay_tracking.py \
  --video evaluation/crossing-01.mp4 \
  --config evaluation/camera-config.json \
  --profile balanced \
  --runtime auto \
  --tracker auto \
  --output evaluation/predictions.jsonl

uv run --directory ml-service python scripts/evaluate_tracking.py \
  --ground-truth evaluation/ground-truth.jsonl \
  --predictions evaluation/predictions.jsonl
```

PowerShell:

```powershell
uv run --directory ml-service python scripts/replay_tracking.py `
  --video evaluation/crossing-01.mp4 `
  --config evaluation/camera-config.json `
  --profile balanced `
  --runtime auto `
  --tracker auto `
  --output evaluation/predictions.jsonl

uv run --directory ml-service python scripts/evaluate_tracking.py `
  --ground-truth evaluation/ground-truth.jsonl `
  --predictions evaluation/predictions.jsonl
```

Useful profile checks:

```bash
uv run --directory ml-service python scripts/replay_tracking.py --video evaluation/crossing-01.mp4 --output evaluation/predictions-compatibility.jsonl --profile compatibility --tracker bytetrack
uv run --directory ml-service python scripts/replay_tracking.py --video evaluation/crossing-01.mp4 --output evaluation/predictions-balanced.jsonl --profile balanced --tracker botsort
uv run --directory ml-service python scripts/replay_tracking.py --video evaluation/crossing-01.mp4 --output evaluation/predictions-high-accuracy.jsonl --profile high_accuracy --tracker botsort
uv run --directory ml-service python scripts/replay_tracking.py --video evaluation/crossing-01.mp4 --output evaluation/predictions-emergency.jsonl --profile emergency --tracker bytetrack
```

## Quality Checks

Run these from `desktop-tanaw` for Electron/renderer changes:

```bash
npm run lint
npm run type
```

Run these from `desktop-tanaw/ml-service` for ML-service changes:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run ruff check .
UV_CACHE_DIR=/tmp/uv-cache uv run ruff format --check .
UV_CACHE_DIR=/tmp/uv-cache uv run mypy .
UV_CACHE_DIR=/tmp/uv-cache uv run pyright
UV_CACHE_DIR=/tmp/uv-cache uv run python -m unittest discover tests
```

PowerShell:

```powershell
$env:UV_CACHE_DIR = "$env:TEMP\uv-cache"
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pyright
uv run python -m unittest discover tests
Remove-Item Env:UV_CACHE_DIR
```

The normal desktop lint command also scans renderer files for Tailwind classes that should be written in canonical form:

```bash
npm run lint:tailwind
npm run lint:tailwind:fix
```

## Project Structure

```text
electron/                 # Electron main and preload processes
src/                      # React renderer application
ml-service/               # Local FastAPI ML service and SQLite ledger logic
ml-service/app/camera/    # Camera session manager and frame processing
ml-service/app/counting/  # Tripwire counting and geometry
ml-service/app/detection/ # YOLO detector and tracker configuration
ml-service/app/storage/   # Local ledger persistence
ml-service/scripts/       # Model setup, replay, and evaluation helpers
```

## Important Boundaries

Local data commands affect only the desktop computer. They do not delete backend accounts, backend reports, final LGU audit reports, or other cloud records.

Camera configuration, authentication state, desktop local ledgers, and backend records are intentionally separate. Use backend mock cleanup for generated backend runs and desktop local-data cleanup for local device state.
