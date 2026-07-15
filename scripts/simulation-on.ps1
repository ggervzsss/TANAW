$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$Range = if ($env:TANAW_SIMULATION_RANGE) { $env:TANAW_SIMULATION_RANGE } else { "6m" }
$Scenario = if ($env:TANAW_SIMULATION_SCENARIO) { $env:TANAW_SIMULATION_SCENARIO } else { "full-workflow" }
$TargetEnterprise = if ($env:TANAW_SIMULATION_TARGET_ENTERPRISE) {
    $env:TANAW_SIMULATION_TARGET_ENTERPRISE
} else {
    "archies_001@tanaw.sanpedro"
}
$ForwardedArgs = @($args)
$ExitCode = 0

Push-Location $RepoRoot
try {
    & docker compose exec -e TANAW_ALLOW_SIMULATION_DATA=true backend `
        uv run simulation-data on `
        --range $Range `
        --scenario $Scenario `
        --target-enterprise $TargetEnterprise `
        @ForwardedArgs
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

exit $ExitCode
