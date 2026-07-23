$ErrorActionPreference = "Stop"

if ($args.Count -ne 0) {
    Write-Host "Usage: .\scripts\local-mockdata-off.ps1"
    Write-Host "Permanently removes all TANAW desktop data from this device."
    exit 2
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$ExitCode = 0

Push-Location (Join-Path $RepoRoot "desktop-tanaw")
try {
    & npm run local-data -- clear --full-device --yes
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

exit $ExitCode
