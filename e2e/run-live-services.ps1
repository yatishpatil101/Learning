# Runs the live Playwright suite for the SERVICES lane: app on :5191, API on :8096,
# database punenest_e2e_sv2. The backend for this lane must already be running via
# backend/run-lane-services.ps1 (-DbuildDirName=target-sv2, --server.port=8096,
# profiles dev,e2e).
#
# WHY A SCRIPT. The three settings below have to agree with the backend launcher, and a
# -g pattern contains '|' and quotes, both of which PowerShell 5.1 eats before npx ever
# sees them. Passing the arguments through an array avoids the escaping entirely.
#
# Usage:
#   .\run-live-services.ps1 tests/consumer/services/live-referral-rewards.spec.js
#   .\run-live-services.ps1 tests/consumer/services -Grep 'quota'
#
# Pure ASCII on purpose: PowerShell 5.1 parses a BOM-less UTF-8 .ps1 as cp1252.
param(
    [Parameter(Mandatory = $true)][string[]]$Spec,
    [string]$Grep,
    [int]$Workers = 1
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

$env:BASE_URL = 'http://localhost:5191'
$env:API_PORT = '8096'
$env:PUNENEST_DEV_MACHINE = '1'
# The one that is easy to forget and expensive to miss. global-setup.live.js defaults to
# 'punenest_e2e', so without this the run resets a database the backend on :8096 is not
# serving: this lane is left un-reset and drifting, and ANOTHER lane's data is wiped.
# Neither failure names itself - the suite reports assertion errors about rows.
$env:E2E_DB_NAME = 'punenest_e2e_sv2'

# Not $args: that is a PowerShell automatic variable, and assigning to it here makes the
# splat expand to nothing, so `npx` is called bare and opens an interactive shell instead
# of running anything.
$pwArgs = @('playwright', 'test', '--config=playwright.config.js') + $Spec +
          @('--reporter=list', "--workers=$Workers")
if ($Grep) { $pwArgs += @('-g', $Grep) }

Write-Host "live services lane -> $($env:BASE_URL) / API $($env:API_PORT)"
& npx @pwArgs
exit $LASTEXITCODE
