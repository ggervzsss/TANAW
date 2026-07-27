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

`local-mockdata-off` permanently deletes the complete TANAW Electron user-data
directory: every desktop database, saved RTSP camera and encrypted credential
file, authentication state, Chromium storage, preferences, and caches. It is
idempotent and can be run before or after `mockdata-off`, which independently
clears the backend sample dataset. Quit TANAW from its tray menu and stop
`npm run dev` with `Ctrl+C` first. The script refuses to clear data while the
desktop is still open and safely terminates a leftover TANAW ML listener from
this workspace before removing files.
