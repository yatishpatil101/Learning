#!/usr/bin/env pwsh
# Graphify wrapper for this repo. Uses the interpreter graphify pinned in
# graphify-out/.graphify_python, and defaults to --code-only (no API key needed).
#
#   .\scripts\graphify.ps1 update                 # incremental refresh after code changes
#   .\scripts\graphify.ps1 rebuild                # full re-extraction (use after big refactors)
#   .\scripts\graphify.ps1 report                 # regenerate GRAPH_REPORT.md + communities
#   .\scripts\graphify.ps1 query "how does auth work?" --budget 1500
#   .\scripts\graphify.ps1 explain "ContactVisibility"
#   .\scripts\graphify.ps1 path "PropertyController" "PropertyRepository"
param(
    [Parameter(Position = 0)][string]$Command = 'update',
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest
)

$root = Split-Path -Parent $PSScriptRoot
$pin = Join-Path $root 'graphify-out/.graphify_python'
$py = if (Test-Path $pin) { (Get-Content $pin -Raw).Trim() } else { 'python' }

Push-Location $root
try {
    switch ($Command) {
        'update' { & $py -m graphify . --update --code-only --no-viz @Rest }
        'rebuild' { & $py -m graphify . --code-only --no-viz --force @Rest }
        'report' { & $py -m graphify cluster-only . --no-viz @Rest }
        default { & $py -m graphify $Command @Rest }
    }
}
finally { Pop-Location }
