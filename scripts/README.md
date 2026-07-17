# TANAW utility scripts

Run these TANAW utilities from the repository root.

Linux, macOS, WSL, and Git Bash:

```shell
./scripts/mockdata-on
./scripts/mockdata-reset
./scripts/mockdata-status
./scripts/mockdata-off
./scripts/local-data-reset
```

Windows PowerShell:

```powershell
.\scripts\mockdata-on.ps1
.\scripts\mockdata-reset.ps1
.\scripts\mockdata-status.ps1
.\scripts\mockdata-off.ps1
.\scripts\local-data-reset.ps1
```

`mockdata-on` and `mockdata-reset` default to the full workflow scenario
for `archies_001@tanaw.sanpedro`. Override the defaults only for the individual
command process:

```shell
TANAW_MOCK_TARGET_ENTERPRISE_ID="enterprise_id" ./scripts/mockdata-reset
TANAW_MOCK_RANGE=12m TANAW_MOCK_SCENARIO=peak-traffic ./scripts/mockdata-on
```

```powershell
$env:TANAW_MOCK_TARGET_ENTERPRISE_ID = "enterprise_id"
.\scripts\mockdata-reset.ps1

$env:TANAW_MOCK_RANGE = "12m"
$env:TANAW_MOCK_SCENARIO = "peak-traffic"
.\scripts\mockdata-on.ps1
```

Mock data loading is explicit and disabled by default. It creates official-shaped
development fixtures so the normal Staff and desktop pages can be tested. Never
set `TANAW_ALLOW_MOCK_DATA=true` for a production service.

The target is resolved exclusively through its canonical Enterprise ID, not its
login email. Changing the account email does not change where prepared mock
counts are delivered. Copy the exact ID from the IT portal or desktop Profile;
the canonical format contains `@`, for example `archies_001@tanaw.sanpedro`.

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
