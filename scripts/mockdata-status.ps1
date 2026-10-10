$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$ForwardedArgs = @($args)
$ExitCode = 0

Push-Location $RepoRoot
try {
    & docker compose exec backend uv run sample-data status @ForwardedArgs
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($ExitCode -eq 0 -and $ForwardedArgs -notcontains "--help" -and $ForwardedArgs -notcontains "-h") {
    Write-Host "[SUCCESS] mockdata-status: Backend mock data status checked."
}

exit $ExitCode
