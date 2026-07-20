# TANAW utility scripts

Run these from the repository root.

Linux, macOS, WSL, and Git Bash:

```shell
./scripts/mockdata-on
./scripts/mockdata-reset
./scripts/mockdata-status
./scripts/mockdata-off
./scripts/local-mockdata-off
```

Windows PowerShell:

```powershell
.\scripts\mockdata-on.ps1
.\scripts\mockdata-reset.ps1
.\scripts\mockdata-status.ps1
.\scripts\mockdata-off.ps1
.\scripts\local-mockdata-off.ps1
```

`mockdata-on` and `mockdata-reset` default to the full workflow scenario for
`archies_001@tanaw.sanpedro`. Override the defaults with environment variables:

```shell
TANAW_MOCK_TARGET_ENTERPRISE="enterprise_id" ./scripts/mockdata-reset
TANAW_MOCK_RANGE=12m TANAW_MOCK_SCENARIO=peak-traffic ./scripts/mockdata-on
```

```powershell
$env:TANAW_MOCK_TARGET_ENTERPRISE = "enterprise_id"
.\scripts\mockdata-reset.ps1

$env:TANAW_MOCK_RANGE = "12m"
$env:TANAW_MOCK_SCENARIO = "peak-traffic"
.\scripts\mockdata-on.ps1
```

`local-mockdata-off` removes operational rows from every desktop database, including rows created
from real CCTV detections, prepared sample counts, reports, snapshots, and
occupancy corrections. It preserves SQLite camera profiles, Electron preferences,
auth storage, and other desktop device state. It also deletes retired
`tanaw_metrics.sqlite3` and `active_session.json` files.
