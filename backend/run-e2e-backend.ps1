# Starts the backend on :8081 under the dev,e2e profiles - the thing every live
# Playwright run needs, and which e2e/playwright.live.config.js currently asks a
# human to assemble by hand from a docblock.
#
# WHY THIS EXISTS. A live suite run against a stale JVM does not fail loudly; it
# fails as a scatter of assertion errors that read exactly like code defects. It
# has cost this branch two sessions - most recently one where the whole
# consumer/property wave was reported as broken, when the tree was correct and
# the process on :8081 had simply booted two hours before the last edit. One
# command to restart is the cheapest guard against reading that as a bug.
#
# Sibling of run-local.ps1, which covers the dev profile on :8080.
#
# Pure ASCII on purpose: PowerShell 5.1 parses a BOM-less UTF-8 .ps1 as cp1252,
# and an em-dash in a double-quoted string terminates it early.
$ErrorActionPreference = 'Stop'
# $MyInvocation rather than a relative path: the caller's location is not ours,
# and .env.local below must resolve against the backend directory.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$env:JAVA_HOME = 'C:\Program Files\Zulu\zulu-25'
# DevProfileGuard refuses to start without this. Its absence surfaces 30 seconds
# into the first spec as a login timeout, which names nothing.
$env:PUNENEST_DEV_MACHINE = '1'

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

$log = Join-Path $env:TEMP 'be8081.log'
if (Test-Path $log) { Remove-Item $log -Force }
# Profile order matters: dev binds the mock OTP sender, e2e points the datasource
# at punenest_e2e and fixes the OTP. Listing e2e last is what makes its
# datasource win. buildDirName keeps this off whatever lane a concurrent build
# is using.
cmd /c ".\mvnw.cmd -o -DbuildDirName=target-verify spring-boot:run -Dspring-boot.run.profiles=dev,e2e ""-Dspring-boot.run.arguments=--server.port=8081"" > ""$log"" 2>&1"
