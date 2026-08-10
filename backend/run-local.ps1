<#
.SYNOPSIS
    Launches the PuneNest backend with the correct JDK and local environment.

.DESCRIPTION
    One entry point for running the backend on this machine. It:
      1. Pins JAVA_HOME to Zulu 25 (the machine default is Zulu 17, but the build
         targets release 25 - without this, mvnw fails "release version 25 not supported").
      2. Loads backend/.env.local (git-ignored) into the process environment, so
         Cashfree keys and other secrets reach Spring via ${CASHFREE_*} without ever
         being committed or passed to the frontend.
      3. Asserts PUNENEST_DEV_MACHINE is set. This is the one variable that is NOT in
         .env.local and never will be: DevProfileGuard requires it alongside the `dev`
         profile as positive proof that this is a developer's machine, and the proof is
         only worth anything if it cannot be copied. Set it once, in your Windows user
         environment (see docs/LOCAL_DEV.md); this script refuses to guess it for you,
         because a script that sets it is a file that carries it.
      4. Starts `mvnw spring-boot:run` under the `dev` profile, optionally on a chosen port.
         The profile is not cosmetic: the mock OTP sender, the local-disk file store and the
         self-service Aadhaar badge endpoint are @DevOnly, i.e. @Profile("dev"), so a run that
         does not name it gets the production stubs and OTP login will not work.

    Secrets live ONLY in .env.local. This script contains none and is safe to commit.

.PARAMETER Port
    Optional server port (e.g. 8099). Omit to use the configured default (8080).

.PARAMETER EnvFile
    Path to the env file. Defaults to backend/.env.local next to this script.

.EXAMPLE
    .\run-local.ps1
    .\run-local.ps1 -Port 8099
#>
[CmdletBinding()]
param(
    [int]$Port,
    [string]$EnvFile
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- 1. JDK -----------------------------------------------------------------
$zulu25 = 'C:\Program Files\Zulu\zulu-25'
if (-not (Test-Path $zulu25)) {
    throw "Zulu 25 not found at '$zulu25'. The build targets release 25; install it or edit this path."
}
$env:JAVA_HOME = $zulu25
Write-Host "JAVA_HOME = $env:JAVA_HOME" -ForegroundColor Cyan

# --- 2. Local environment ---------------------------------------------------
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
        # One key is refused from this file, git-ignored or not. PUNENEST_DEV_MACHINE is the proof
        # that this machine is a developer's, and .env files are the single most copied artefact in
        # a deployment - accepting it here would let the attestation travel with everything else it
        # is supposed to be independent of.
        if ($key -eq 'PUNENEST_DEV_MACHINE') {
            Write-Warning "Ignoring PUNENEST_DEV_MACHINE from $EnvFile - it must come from your user environment, not a file. Remove it from the env file; see docs/LOCAL_DEV.md."
            continue
        }
        Set-Item -LiteralPath "Env:$key" -Value $val
    }
    $flag = if ($env:CASHFREE_ENABLED -eq 'true') { 'ENABLED (real Cashfree)' } else { 'disabled (mock providers)' }
    Write-Host "Cashfree: $flag" -ForegroundColor Cyan
} else {
    Write-Warning "No env file at $EnvFile - running with defaults (Cashfree disabled). Copy .env.example to .env.local to enable."
}

# --- 3. Developer-machine attestation ---------------------------------------
# DevProfileGuard refuses to finish booting under `dev` unless PUNENEST_DEV_MACHINE is present in
# the process environment. Checked here, before Maven spends a minute compiling, so the failure
# arrives in one second instead of at the end of a boot log.
#
# This script deliberately does NOT set it. The variable is the only signal that distinguishes a
# developer's machine from a container that was handed SPRING_PROFILES_ACTIVE=dev in a copied
# environment file, and it can only do that while it lives outside the repository. A line here that
# set it would make the repository itself the thing that grants dev privileges - which is the hole
# being closed, moved one file to the left.
if ([string]::IsNullOrWhiteSpace($env:PUNENEST_DEV_MACHINE)) {
    throw @"
PUNENEST_DEV_MACHINE is not set, and the backend will refuse to start under the 'dev' profile
without it. Set it once for your Windows user account:

    [Environment]::SetEnvironmentVariable('PUNENEST_DEV_MACHINE', '1', 'User')

then open a NEW terminal (and restart VS Code, so its tasks inherit it) and run this again.
Nothing in the repository sets this for you on purpose - see docs/LOCAL_DEV.md.
"@
}
Write-Host "Dev machine attested (PUNENEST_DEV_MACHINE is set)" -ForegroundColor Cyan

# --- 4. Run -----------------------------------------------------------------
Push-Location $scriptDir
try {
    $mvnArgs = @('spring-boot:run', '-Dspring-boot.run.profiles=dev')
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
