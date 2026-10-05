# Pins Zulu 25 and refuses copied DRAAZY_DEV_MACHINE attestations.
# The local profile exposes @LocalOnly providers, so machine proof must live outside repo files.
[CmdletBinding()]
param(
    [int]$Port,
    [string]$EnvFile
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$zulu25 = 'C:\Program Files\Zulu\zulu-25'
if (-not (Test-Path $zulu25)) {
    throw "Zulu 25 not found at '$zulu25'. The build targets release 25; install it or edit this path."
}
$env:JAVA_HOME = $zulu25
Write-Host "JAVA_HOME = $env:JAVA_HOME" -ForegroundColor Cyan

if (-not $EnvFile) { $EnvFile = Join-Path $scriptDir '.env.local' }
if (Test-Path $EnvFile) {
    Write-Host "Loading env from $EnvFile" -ForegroundColor Cyan
    foreach ($raw in Get-Content -LiteralPath $EnvFile) {
        $line = $raw.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { continue }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim()
        if (($val.StartsWith('"') -and $val.EndsWith('"')) -or
            ($val.StartsWith("'") -and $val.EndsWith("'"))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        # DRAAZY_DEV_MACHINE must not travel with copied env files; LocalProfileGuard treats it as
        # proof this is a developer machine, not a container handed the local profile.
        if ($key -eq 'DRAAZY_DEV_MACHINE') {
            Write-Warning "Ignoring DRAAZY_DEV_MACHINE from $EnvFile - it must come from your user environment, not a file. Remove it from the env file; see docs/LOCAL_DEV.md."
            continue
        }
        Set-Item -LiteralPath "Env:$key" -Value $val
    }
    $flag = if ($env:CASHFREE_ENABLED -eq 'true') { 'ENABLED (real Cashfree)' } else { 'disabled (mock providers)' }
    Write-Host "Cashfree: $flag" -ForegroundColor Cyan
} else {
    Write-Warning "No env file at $EnvFile - running with defaults (Cashfree disabled). Copy .env.example to .env.local to enable."
}

# Checked before Maven compiles because LocalProfileGuard would reject the same missing proof at boot.
if ([string]::IsNullOrWhiteSpace($env:DRAAZY_DEV_MACHINE)) {
    throw @"
DRAAZY_DEV_MACHINE is not set, and the backend will refuse to start under the 'local' profile
without it. Set it once for your Windows user account:

    [Environment]::SetEnvironmentVariable('DRAAZY_DEV_MACHINE', '1', 'User')

then open a NEW terminal (and restart VS Code, so its tasks inherit it) and run this again.
Nothing in the repository sets this for you on purpose - see docs/LOCAL_DEV.md.
"@
}
Write-Host "Dev machine attested (DRAAZY_DEV_MACHINE is set)" -ForegroundColor Cyan

Push-Location $scriptDir
try {
    # Its own output directory: a JVM running from `target-cli` breaks the moment any CLI build or
    # test run recompiles that directory underneath it (classes loaded after the rewrite mismatch).
    $mvnArgs = @('-DbuildDirName=target-local', 'spring-boot:run', '-Dspring-boot.run.profiles=local')
    if ($PSBoundParameters.ContainsKey('Port')) {
        $mvnArgs += "-Dspring-boot.run.arguments=--server.port=$Port"
        Write-Host "Starting backend on port $Port ..." -ForegroundColor Green
    } else {
        Write-Host "Starting backend on the default port ..." -ForegroundColor Green
    }
    & (Join-Path $scriptDir 'mvnw.cmd') @mvnArgs
} finally {
    Pop-Location
}
