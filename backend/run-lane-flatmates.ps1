# Starts the backend for the FLATMATES e2e lane: port 8095, database punenest_e2e_fm2,
# build directory target-fm2. Sibling of run-e2e-backend.ps1, which owns the shared
# :8081 / punenest_e2e lane, and of run-lane-admin.ps1, which owns :8084 /
# punenest_e2e_adm2. This one exists so a flatmates run cannot collide with a concurrent
# session on either of those.
#
# WHY A SEPARATE SCRIPT. e2e/run-live-flatmates.ps1 already pins the runner half of this
# lane, and its header states the backend half as prose - "must already be running with
# -DbuildDirName=target-fm2 and --server.port=8095 under profiles dev,e2e". Prose is not
# a launcher: it was retyped by hand every time, which is how a lane ends up pointed at
# another session's database, and how a JVM ends up outliving the sources it was built
# from. Neither failure announces itself. A stale JVM in particular fails as a scatter of
# assertion errors that read exactly like code defects, and a whole session can be spent
# debugging specs that were already correct.
#
# Pure ASCII on purpose: PowerShell 5.1 parses a BOM-less UTF-8 .ps1 as cp1252, and an
# em-dash inside a double-quoted string terminates it early.
$ErrorActionPreference = 'Stop'

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

# The machine default is Zulu 17 and the build targets release 25, so without this the
# compile fails on "release version 25 not supported" before anything else is attempted.
$env:JAVA_HOME = 'C:\Program Files\Zulu\zulu-25'
# DevProfileGuard refuses to start without this. Its absence surfaces 30 seconds into
# the first spec as a login timeout, which names nothing.
$env:PUNENEST_DEV_MACHINE = '1'
$env:E2E_DB_URL = 'jdbc:postgresql://localhost:5432/punenest_e2e_fm2'
# The app's own address, as the app must state it to an outsider. Templates that hand an
# owner a link build it from punenest.app.base-url, which application-e2e.properties
# defaults to :5173 - right only for the shared lane. This lane serves on :5190, so
# without this the server composes messages pointing at a port with nothing behind it.
# Must equal BASE_URL in e2e/run-live-flatmates.ps1.
$env:E2E_APP_BASE_URL = 'http://localhost:5190'

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

$log = Join-Path $env:TEMP 'be8095.log'
if (Test-Path $log) { Remove-Item $log -Force }
Write-Host "flatmates lane -> :8095, punenest_e2e_fm2, target-fm2; log $log"

# Profile order matters: dev binds the mock OTP sender, e2e points the datasource at
# E2E_DB_URL and fixes the OTP. Listing e2e last is what makes its datasource win.
cmd /c ".\mvnw.cmd -o -DbuildDirName=target-fm2 spring-boot:run -Dspring-boot.run.profiles=dev,e2e ""-Dspring-boot.run.arguments=--server.port=8095"" > ""$log"" 2>&1"
