$ErrorActionPreference = "Stop"

if ($args.Count -ne 0) {
    Write-Host "Usage: .\scripts\local-mockdata-off.ps1"
    Write-Host "Permanently removes all TANAW desktop data from this device."
    exit 2
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$DesktopRoot = Resolve-Path (Join-Path $RepoRoot "desktop-tanaw")
$ExitCode = 0

$normalizedDesktopRoot = $DesktopRoot.Path.ToLowerInvariant()
$runningDesktop = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -and
        $_.CommandLine.Replace("/", "\").ToLowerInvariant().Contains($normalizedDesktopRoot)
    } |
    Select-Object -First 1
if ($runningDesktop) {
    Write-Error "TANAW is still running (PID $($runningDesktop.ProcessId)). Use the tray menu to Quit TANAW and stop npm run dev with Ctrl+C before resetting local data."
}

$listener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue |
    Where-Object {
        $_.LocalAddress -in @("127.0.0.1", "0.0.0.0", "::1")
    } |
    Select-Object -First 1
if ($listener) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $normalizedServiceRoot = (Join-Path $DesktopRoot "ml-service").ToLowerInvariant()
    $normalizedCommandLine = if ($listenerProcess.CommandLine) {
        $listenerProcess.CommandLine.Replace("/", "\").ToLowerInvariant()
    } else {
        ""
    }
    if (-not $normalizedCommandLine.Contains($normalizedServiceRoot)) {
        Write-Error "Port 8765 is used by a process outside this TANAW workspace. Stop PID $($listener.OwningProcess) manually before resetting local data."
    }

    Write-Host "Stopping leftover TANAW ML service process $($listener.OwningProcess)..."
    & taskkill.exe /PID $listener.OwningProcess /T /F | Out-Host

    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $remainingListener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if (-not $remainingListener) {
            break
        }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $deadline)

    if ($remainingListener) {
        Write-Error "The TANAW ML service did not release port 8765. Local data was not removed."
    }
}

Push-Location $DesktopRoot
try {
    & npm run local-data -- clear --full-device --yes
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

exit $ExitCode
