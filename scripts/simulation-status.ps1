$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$ForwardedArgs = @($args)
$ExitCode = 0

Push-Location $RepoRoot
try {
    & docker compose exec backend uv run simulation-data status @ForwardedArgs
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

exit $ExitCode
