# PowerShell 5.1 eats quoted -g patterns; array args preserve them while keeping the lane's
# app/API/database settings aligned with the backend launcher.
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
# global-setup.live.js defaults to another database; missing this resets that lane and leaves
# this one drifting, which surfaces later as row assertion failures.
$env:E2E_DB_NAME = 'draazy_e2e_fm2'

# Not $args: assigning PowerShell's automatic variable makes the splat empty and opens `npx`
# interactively instead of running the suite.
$pwArgs = @('playwright', 'test', '--config=playwright.config.js') + $Spec +
          @('--reporter=list', "--workers=$Workers")
if ($Grep) { $pwArgs += @('-g', $Grep) }

Write-Host "live flatmates lane -> $($env:BASE_URL) / API $($env:API_PORT)"
& npx @pwArgs
exit $LASTEXITCODE
