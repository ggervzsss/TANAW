$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$ForwardedArgs = @($args)
$ExitCode = 0

Push-Location $RepoRoot
try {
    & docker compose exec -e TANAW_ALLOW_MOCK_DATA=true backend `
        uv run mockdata off `
        @ForwardedArgs
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

exit $ExitCode
