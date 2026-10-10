$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$Range = if ($env:TANAW_MOCK_RANGE) { $env:TANAW_MOCK_RANGE } else { "6m" }
$Scenario = if ($env:TANAW_MOCK_SCENARIO) { $env:TANAW_MOCK_SCENARIO } else { "full-workflow" }
$TargetEnterprise = $env:TANAW_MOCK_TARGET_ENTERPRISE
$ForwardedArgs = @($args)
$ExitCode = 0

Push-Location $RepoRoot
try {
    & docker compose exec --env "TANAW_MOCK_TARGET_ENTERPRISE=$TargetEnterprise" backend `
        uv run sample-data on `
        --range $Range `
        --scenario $Scenario `
        @ForwardedArgs
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($ExitCode -eq 0 -and $ForwardedArgs -notcontains "--help" -and $ForwardedArgs -notcontains "-h") {
    Write-Host "[SUCCESS] mockdata-on: Backend mock data generated."
}

exit $ExitCode
