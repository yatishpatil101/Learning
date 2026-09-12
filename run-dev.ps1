<#
.SYNOPSIS
    Starts the Draazy backend and frontend together for local development.

.DESCRIPTION
    Each app gets its own window, so its log is readable and Ctrl+C stops one without the other.
    Ports, the proxy target and the deploy-variable purge: docs/LOCAL_DEV.md sections 2-3.

.PARAMETER BackendPort
    Spring Boot port. Default 9090.

.PARAMETER FrontendPort
    Vite dev server port. Default 3322.

.PARAMETER NoBrowser
    Skip opening the browser once the backend reports healthy.

.EXAMPLE
    .\run-dev.ps1
    .\run-dev.ps1 -BackendPort 8080 -FrontendPort 5173
#>
[CmdletBinding()]
param(
    [int]$BackendPort = 9090,
    [int]$FrontendPort = 3322,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$backendScript = Join-Path $backendDir 'run-local.ps1'

# --- 1. Developer-machine attestation ---------------------------------------
if ([string]::IsNullOrWhiteSpace($env:DRAAZY_DEV_MACHINE)) {
    throw @"
DRAAZY_DEV_MACHINE is not set, and the backend refuses to start under the 'local' profile
without it. Set it once for your Windows user account:

    [Environment]::SetEnvironmentVariable('DRAAZY_DEV_MACHINE', '1', 'User')

then open a NEW terminal (and restart VS Code, so its tasks inherit it) and run this again.
Nothing in the repository sets this for you on purpose - see docs/LOCAL_DEV.md.
"@
}

# --- 2. Refuse to inherit a deployment's database ---------------------------
# Env overrides outrank application.properties, so a stale DB_URL would point local Spring at Supabase.
$deployVars ='DB_URL', 'DB_USER', 'DB_PASSWORD', 'FLYWAY_DB_URL', 'SPRING_PROFILES_ACTIVE'
$leaked = $deployVars | Where-Object { Test-Path "Env:$_" }
if ($leaked) {
    Write-Warning "Clearing deploy variables so the local run cannot reach a remote database: $($leaked -join ', ')"
    foreach ($name in $leaked) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
}

# --- 3. Frontend dependencies -----------------------------------------------
if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
    Write-Host 'Installing frontend dependencies (first run only)...' -ForegroundColor Cyan
    Push-Location $frontendDir
    try { npm install } finally { Pop-Location }
}

# --- 4. Launch --------------------------------------------------------------
$proxyTarget = "http://localhost:$BackendPort"

Write-Host "Backend  -> $proxyTarget/api" -ForegroundColor Green
Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoExit', '-ExecutionPolicy', 'Bypass',
    '-Command', "& '$backendScript' -Port $BackendPort"
)

Write-Host "Frontend -> http://localhost:$FrontendPort" -ForegroundColor Green
$frontendCmd = "Set-Location '$frontendDir'; " `
    + "`$env:VITE_PROXY_TARGET='$proxyTarget'; " `
    + "`$env:VITE_API_BASE='/api'; " `
    + "npm run dev -- --port $FrontendPort --strictPort"
Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $frontendCmd
)

# --- 5. Wait for the backend, then open the browser -------------------------
# A cold JVM plus Flyway takes most of a minute; the seed on a fresh database takes longer.
$healthUrl = "$proxyTarget/api/actuator/health"
Write-Host "Waiting for $healthUrl ..." -ForegroundColor Cyan

$deadline = (Get-Date).AddMinutes(3)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) { $healthy = $true; break }
    } catch {
        # Not up yet. The backend window carries the real log if it never comes up.
    }
}

if ($healthy) {
    Write-Host 'Backend is healthy.' -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process "http://localhost:$FrontendPort" }
} else {
    Write-Warning @"
Backend did not report healthy within 3 minutes. Read the backend window - the cause is in its log.
Common ones:
  - port $BackendPort already in use (Get-NetTCPConnection -LocalPort $BackendPort)
  - local Postgres is not running, or the 'draazy' database does not exist
  - Flyway checksum mismatch, which needs docs/LOCAL_DEV.md section 1, not a retry
The frontend is still running; it will serve the app but every /api call will fail until the
backend is up.
"@
}
