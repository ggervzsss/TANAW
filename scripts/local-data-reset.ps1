$ErrorActionPreference = "Stop"

if ($args.Count -ne 0) {
    Write-Host "Usage: .\scripts\local-data-reset.ps1"
    Write-Host "Removes all local desktop ledger data while preserving camera settings."
    exit 2
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$ExitCode = 0

Push-Location (Join-Path $RepoRoot "desktop-tanaw")
try {
    & npm run local-data -- clear --all-ledgers --yes
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

exit $ExitCode
