$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$Range = if ($env:TANAW_MOCK_RANGE) { $env:TANAW_MOCK_RANGE } else { "6m" }
$Scenario = if ($env:TANAW_MOCK_SCENARIO) { $env:TANAW_MOCK_SCENARIO } else { "full-workflow" }
$TargetEnterprise = if ($env:TANAW_MOCK_TARGET_ENTERPRISE) {
    $env:TANAW_MOCK_TARGET_ENTERPRISE
} else {
    "archies_001@tanaw.sanpedro"
}
$ForwardedArgs = @($args)
$ExitCode = 0

Push-Location $RepoRoot
try {
    & docker compose exec backend `
        uv run sample-data on `
        --range $Range `
        --scenario $Scenario `
        --target-enterprise $TargetEnterprise `
        @ForwardedArgs
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

exit $ExitCode
