# Runs the live Playwright suite for the FLATMATES lane: app on :5190, API on :8095,
# database draazy_e2e_fm2. The backend for this lane must already be running with
# -DbuildDirName=target-fm2 and --server.port=8095 under profiles dev,e2e.
#
# WHY A SCRIPT. The three settings below have to agree with the backend launcher, and a
# -g pattern contains '|' and quotes, both of which PowerShell 5.1 eats before npx ever
# sees them. Passing the arguments through an array avoids the escaping entirely.
#
# Usage:
#   .\run-live-flatmates.ps1 tests/consumer/flatmates/live-interest-doors.spec.js
#   .\run-live-flatmates.ps1 tests/consumer/flatmates/live-interest-doors.spec.js -Grep 'already full'
#
# Pure ASCII on purpose: PowerShell 5.1 parses a BOM-less UTF-8 .ps1 as cp1252.
param(
    [Parameter(Mandatory = $true)][string[]]$Spec,
    [string]$Grep,
    [int]$Workers = 1
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

$env:BASE_URL = 'http://localhost:5190'
$env:API_PORT = '8095'
$env:DRAAZY_DEV_MACHINE = '1'
# The one that is easy to forget and expensive to miss. global-setup.live.js defaults to
# 'draazy_e2e', so without this the run resets a database the backend on :8095 is not
# serving: this lane is left un-reset and drifting, and ANOTHER lane's data is wiped.
# Neither failure names itself - the suite reports assertion errors about rows.
$env:E2E_DB_NAME = 'draazy_e2e_fm2'

# Not $args: that is a PowerShell automatic variable, and assigning to it here makes the
# splat expand to nothing, so `npx` is called bare and opens an interactive shell instead
# of running anything.
$pwArgs = @('playwright', 'test', '--config=playwright.config.js') + $Spec +
          @('--reporter=list', "--workers=$Workers")
if ($Grep) { $pwArgs += @('-g', $Grep) }

Write-Host "live flatmates lane -> $($env:BASE_URL) / API $($env:API_PORT)"
& npx @pwArgs
exit $LASTEXITCODE
