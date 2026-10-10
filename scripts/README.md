# TANAW utility scripts

Run these from the repository root.

Each script prints a final `[SUCCESS]` message when its command completes
successfully, after the detailed output. Failed commands retain their nonzero
exit code and do not print a success message. Help requests display help only.
For `mockdata-status`, success means the status check completed; the `active`
field in its output tells you whether a mock dataset is loaded.

Linux, macOS, WSL, and Git Bash:

```shell
./scripts/mockdata-on lolouweng
./scripts/mockdata-reset lolouweng
./scripts/mockdata-status
./scripts/mockdata-off
./scripts/local-mockdata-off
```

Windows PowerShell:

```powershell
.\scripts\mockdata-on.ps1 lolouweng
.\scripts\mockdata-reset.ps1 lolouweng
.\scripts\mockdata-status.ps1
.\scripts\mockdata-off.ps1
.\scripts\local-mockdata-off.ps1
```

`mockdata-on` and `mockdata-reset` require a target account; there is no default
enterprise. Create and activate your enterprise account first. `lolouweng` is
only an example account ID seed: replace it with your own. You can use:

```shell
./scripts/mockdata-on lolouweng
./scripts/mockdata-on lolouweng_001
./scripts/mockdata-on lolouweng_001@tanaw.sanpedro
./scripts/mockdata-on --target-enterprise lolouweng_001@tanaw.sanpedro
```

An account seed must match exactly one active, activated enterprise. If several
accounts share that seed, the command lists matching IDs and stops; use the
numbered or full ID shown in the account details. Exact account email, account
ID, and enterprise name also work. The generated sample accounts cannot be
used as the persistent target. The command output identifies the resolved target.

The defaults remain `6m` and `full-workflow`. You can set a target, range, or
scenario with environment variables; an explicit target overrides the environment:

```shell
TANAW_MOCK_TARGET_ENTERPRISE="lolouweng" ./scripts/mockdata-reset
TANAW_MOCK_RANGE=12m TANAW_MOCK_SCENARIO=peak-traffic ./scripts/mockdata-on lolouweng
```

```powershell
$env:TANAW_MOCK_TARGET_ENTERPRISE = "lolouweng"
.\scripts\mockdata-reset.ps1

$env:TANAW_MOCK_RANGE = "12m"
$env:TANAW_MOCK_SCENARIO = "peak-traffic"
.\scripts\mockdata-on.ps1
```

`--seed` controls repeatable random sample values, not account selection.
Only one central sample dataset is supported at a time: `mockdata-on` refuses
to add a second dataset. `mockdata-reset <target>` replaces the central dataset
and validates the chosen account before cleanup. The target account itself is
never generated or deleted. Sign in to the desktop as that account to import its
prepared local counts; reset does not clear existing desktop data.

`local-mockdata-off` permanently deletes the complete TANAW Electron user-data
directory: every desktop database, saved RTSP camera and encrypted credential
file, authentication state, Chromium storage, preferences, and caches. It is
idempotent and can be run before or after `mockdata-off`, which independently
clears the backend sample dataset. Quit TANAW from its tray menu and stop
`npm run dev` with `Ctrl+C` first. The script refuses to clear data while the
desktop is still open and safely terminates a leftover TANAW ML listener from
this workspace before removing files.
