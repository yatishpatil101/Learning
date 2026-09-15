<#
.SYNOPSIS
    Read-only connectivity probe for the Cashfree sandbox, using backend/.env.local.

.DESCRIPTION
    Answers the one question you cannot answer from the code: do these keys work, and
    which payment methods has Cashfree actually activated on the account? Never prints
    the secret, never creates an order, never moves money.

    Run before flipping CASHFREE_ENABLED=true - a 401 here is an hour of "why does the
    pay button 500" later.
#>
[CmdletBinding()]
param([string]$EnvFile)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is not bound inside a param() default under Windows PowerShell -File.
if (-not $EnvFile) {
    $EnvFile = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) '.env.local'
}
if (-not (Test-Path $EnvFile)) { throw "No env file at $EnvFile - copy .env.example first." }

$cfg = @{}
foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -notmatch '^\s*[A-Za-z_]+=') { continue }
    $k, $v = $line -split '=', 2
    $cfg[$k.Trim()] = $v.Trim().Trim('"', "'")
}

$base = $cfg['CASHFREE_BASE_URL']
$appId = $cfg['CASHFREE_APP_ID']
$secret = $cfg['CASHFREE_SECRET_KEY']

if ([string]::IsNullOrWhiteSpace($appId) -or $appId -eq 'replace_me' -or
    [string]::IsNullOrWhiteSpace($secret) -or $secret -eq 'replace_me') {
    throw "CASHFREE_APP_ID / CASHFREE_SECRET_KEY are not filled in $EnvFile."
}

# This request carries the secret key, so the destination is checked before it leaves: a typo'd host
# or an http:// scheme in the env file would hand a live API credential to whoever answers.
if ($base -notmatch '^https://[a-z0-9.-]*cashfree\.com/?$') {
    throw "CASHFREE_BASE_URL must be an https cashfree.com origin; got '$base'."
}

# The host and the key prefix must agree or every call 401s for a reason the error does not name.
$sandboxKey = $appId.StartsWith('TEST')
$sandboxHost = $base -like '*sandbox.cashfree.com*'
if ($sandboxKey -ne $sandboxHost) {
    Write-Warning "CASHFREE_BASE_URL ($base) and the App ID prefix disagree - one is test, the other live."
}

# Enough to tell two credentials apart, never enough to be one. -Min guards a truncated paste:
# Substring(0,6) on a shorter value throws, reporting a bad .env.local as a crash in the probe.
$appIdHint = $appId.Substring(0, [Math]::Min(6, $appId.Length))
Write-Host "POST $base/pg/eligibility/payment_methods  (app id $appIdHint...)" -ForegroundColor Cyan

$headers = @{
    'x-api-version'   = '2025-01-01'
    'x-client-id'     = $appId
    'x-client-secret' = $secret
}

try {
    # No redirects: .NET strips Authorization on a cross-host hop but re-sends custom headers, so a
    # 302 would carry x-client-secret onward. Cashfree does not redirect this endpoint.
    $response = Invoke-RestMethod -Method Post -Uri "$base/pg/eligibility/payment_methods" `
        -Headers $headers -ContentType 'application/json' -Body '{"queries":{"amount":100}}' `
        -MaximumRedirection 0
} catch {
    Write-Host "AUTH FAILED - $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
    exit 1
}

Write-Host "AUTH OK. Methods activated on this account:" -ForegroundColor Green
# The reply is a top-level array, not a { data: [...] } wrapper. The method is named by
# entity_value; entity_details nests a per-method object whose keys vary, so it is only shown raw.
foreach ($entry in $response) {
    $name = $entry.entity_value
    if (-not $name) { $name = ($entry.entity_details.payment_method_details | ConvertTo-Json -Compress -Depth 4) }
    $mark = if ($entry.eligibility) { 'yes' } else { 'NO ' }
    Write-Host ("  [{0}] {1}" -f $mark, $name)
}
