# Runs the live Playwright suite for the SEARCH lane: app on :5192, API on :8097,
# database draazy_e2e_sr2. The backend for this lane must already be running via
# backend/run-lane-search.ps1 (-DbuildDirName=target-sr2, --server.port=8097,
# profiles local,e2e).
#
# WHY A SCRIPT. The three settings below have to agree with the backend launcher, and a
# -g pattern contains '|' and quotes, both of which PowerShell 5.1 eats before npx ever
# sees them. Passing the arguments through an array avoids the escaping entirely.
#
# Usage:
#   .\run-live-search.ps1 tests/consumer/search/rent-range-parity.spec.js
#   .\run-live-search.ps1 tests/consumer/search -Grep 'deposit'
#
# Pure ASCII on purpose: PowerShell 5.1 parses a BOM-less UTF-8 .ps1 as cp1252.
param(
    [Parameter(Mandatory = $true)][string[]]$Spec,
    [string]$Grep,
    [int]$Workers = 1
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

$env:BASE_URL = 'http://localhost:5192'
$env:API_PORT = '8097'
$env:DRAAZY_DEV_MACHINE = '1'
# The one that is easy to forget and expensive to miss. global-setup.live.js defaults to
# 'draazy_e2e', so without this the run resets a database the backend on :8097 is not
# serving: this lane is left un-reset and drifting, and ANOTHER lane's data is wiped.
# Neither failure names itself - the suite reports assertion errors about rows.
$env:E2E_DB_NAME = 'draazy_e2e_sr2'

# Not $args: that is a PowerShell automatic variable, and assigning to it here makes the
# splat expand to nothing, so `npx` is called bare and opens an interactive shell instead
# of running anything.
$pwArgs = @('playwright', 'test', '--config=playwright.config.js') + $Spec +
          @('--reporter=list', "--workers=$Workers")
if ($Grep) { $pwArgs += @('-g', $Grep) }

Write-Host "live search lane -> $($env:BASE_URL) / API $($env:API_PORT)"
& npx @pwArgs
exit $LASTEXITCODE
