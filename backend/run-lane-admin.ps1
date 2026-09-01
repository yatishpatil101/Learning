# Starts the backend for the ADMIN e2e lane: port 8084, database punenest_e2e_adm2,
# build directory target-admin2. Sibling of run-e2e-backend.ps1, which owns the
# shared :8081 / punenest_e2e lane; this one exists so an admin run cannot collide
# with a concurrent session on another lane (flatmates hold :8095 / punenest_e2e_fm2).
#
# WHY A SEPARATE SCRIPT. The lane settings are three environment variables and a
# Maven flag that have to agree with each other and with e2e/playwright.live.config.js.
# Assembling them by hand on the command line is how a run ends up pointed at another
# session's database, and a stale JVM does not fail loudly - it fails as a scatter of
# assertion errors that read exactly like code defects.
#
# Pure ASCII on purpose: PowerShell 5.1 parses a BOM-less UTF-8 .ps1 as cp1252, and an
# em-dash inside a double-quoted string terminates it early.
$ErrorActionPreference = 'Stop'

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$env:JAVA_HOME = 'C:\Program Files\Zulu\zulu-25'
# DevProfileGuard refuses to start without this. Its absence surfaces 30 seconds into
# the first spec as a login timeout, which names nothing.
$env:PUNENEST_DEV_MACHINE = '1'
$env:E2E_DB_URL = 'jdbc:postgresql://localhost:5432/punenest_e2e_adm2'
# The app's own address, as the app must state it to an outsider. Templates that hand an
# owner a link - the availability chasers, the claim mail - build it from
# punenest.app.base-url, which application-e2e.properties defaults to :5173. That default
# is right only for the shared lane, which happens to serve on :5173; this lane serves on
# :5182, so without this the server composed messages pointing at a port with nothing
# behind it. The failure is quiet in the worst way: the message renders, the link looks
# entirely plausible, and only the owner who taps it finds out. Must equal BASE_URL in
# e2e/run-live-admin.ps1 - that spec asserts the two agree rather than asserting a literal.
$env:E2E_APP_BASE_URL = 'http://localhost:5182'

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

$log = Join-Path $env:TEMP 'be8084.log'
if (Test-Path $log) { Remove-Item $log -Force }
Write-Host "admin lane -> :8084, punenest_e2e_adm2, target-admin2; log $log"

# Profile order matters: dev binds the mock OTP sender, e2e points the datasource at
# E2E_DB_URL and fixes the OTP. Listing e2e last is what makes its datasource win.
cmd /c ".\mvnw.cmd -o -DbuildDirName=target-admin2 spring-boot:run -Dspring-boot.run.profiles=dev,e2e ""-Dspring-boot.run.arguments=--server.port=8084"" > ""$log"" 2>&1"
