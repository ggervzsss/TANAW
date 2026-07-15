# TANAW utility scripts

Run these TANAW utilities from the repository root.

Linux, macOS, WSL, and Git Bash:

```shell
./scripts/simulation-on
./scripts/simulation-reset
./scripts/simulation-status
./scripts/simulation-off
./scripts/local-data-reset
```

Windows PowerShell:

```powershell
.\scripts\simulation-on.ps1
.\scripts\simulation-reset.ps1
.\scripts\simulation-status.ps1
.\scripts\simulation-off.ps1
.\scripts\local-data-reset.ps1
```

`simulation-on` and `simulation-reset` default to the full workflow scenario
for `archies_001@tanaw.sanpedro`. Override the defaults only for the individual
command process:

```shell
TANAW_SIMULATION_TARGET_ENTERPRISE="enterprise_id" ./scripts/simulation-reset
TANAW_SIMULATION_RANGE=12m TANAW_SIMULATION_SCENARIO=peak-traffic ./scripts/simulation-on
```

```powershell
$env:TANAW_SIMULATION_TARGET_ENTERPRISE = "enterprise_id"
.\scripts\simulation-reset.ps1

$env:TANAW_SIMULATION_RANGE = "12m"
$env:TANAW_SIMULATION_SCENARIO = "peak-traffic"
.\scripts\simulation-on.ps1
```

Simulation is explicit, disabled by default, and server-classified. Never set
`TANAW_ALLOW_SIMULATION_DATA=true` for a production service.

`local-data-reset` removes every desktop local ledger, including rows created
from official CCTV detections and simulation runs, reports, current-state
projections, and occupancy corrections. It preserves saved camera settings,
Electron preferences, authentication storage, and other device state. It does
not remove central PostgreSQL data.

Local-ledger schema 8 is initialized automatically. Use `local-data-reset` when
you intentionally want to clear disposable device data, then start the desktop
application to initialize the ledger again. See
[`docs/architecture/LOCAL_EDGE_LEDGER.md`](../docs/architecture/LOCAL_EDGE_LEDGER.md).

`verify_release.py` produces the deterministic release inventory.
Run it with `--require-builds` only after both production applications have
been built:

```shell
python3 scripts/verify_release.py
```

Add `--require-builds` only when validating final production build directories.
