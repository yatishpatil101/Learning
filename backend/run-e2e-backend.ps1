# Starts the backend on :8081 (or -Port) under the local,e2e profiles - what every
# live Playwright run needs.
#
# WHY THIS EXISTS. A live suite run against a stale JVM does not fail loudly; it
# fails as a scatter of assertion errors that read exactly like code defects. One
# command to restart is the cheapest guard against reading that as a bug.
#
# Sibling of run-local.ps1, which covers the local profile on :8080.
#
# Pure ASCII on purpose: PowerShell 5.1 parses a BOM-less UTF-8 .ps1 as cp1252,
# and an em-dash in a double-quoted string terminates it early.
#
# -Port must match API_PORT on the Playwright side (e2e/playwright.config.js and
# helpers/liveAuth.js both default to 8081); moving one without the other points
# the suite at whatever else happens to be listening.
param([int]$Port = 8081)
$ErrorActionPreference = 'Stop'
# $MyInvocation rather than a relative path: the caller's location is not ours,
# and .env.local below must resolve against the backend directory.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$env:JAVA_HOME = 'C:\Program Files\Zulu\zulu-25'
# LocalProfileGuard refuses to start without this. Its absence surfaces 30 seconds
# into the first spec as a login timeout, which names nothing.
$env:DRAAZY_DEV_MACHINE = '1'

$envFile = Join-Path $dir '.env.local'
if (Test-Path $envFile) {
    foreach ($raw in Get-Content -LiteralPath $envFile) {
        $line = $raw.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { continue }
        $k = $line.Substring(0, $eq).Trim()
        $v = $line.Substring($eq + 1).Trim().Trim('"')
        [Environment]::SetEnvironmentVariable($k, $v, 'Process')
    }
}

$log = Join-Path $env:TEMP "be$Port.log"
if (Test-Path $log) { Remove-Item $log -Force }
# Profile order matters: local binds the mock OTP sender, e2e points the datasource
# at draazy_e2e and fixes the OTP. Listing e2e last is what makes its
# datasource win. buildDirName keeps this off whatever lane a concurrent build
# is using.
cmd /c ".\mvnw.cmd -o -DbuildDirName=target-verify spring-boot:run -Dspring-boot.run.profiles=local,e2e ""-Dspring-boot.run.arguments=--server.port=$Port"" > ""$log"" 2>&1"
