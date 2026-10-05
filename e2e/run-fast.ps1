# Shards use their own API ports, app ports and databases because another session may own the lane.
# Pure ASCII: PowerShell 5.1 parses a BOM-less UTF-8 .ps1 as cp1252.
param(
    [switch]$Full,
    [switch]$Failed,
    [string[]]$Spec,
    [string[]]$Files,
    [string]$Base = 'HEAD',
    [int]$Shards = 4,
    [string]$Grep,
    [switch]$DryRun,
    [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$E2E = Split-Path -Parent $MyInvocation.MyCommand.Path
$REPO = Split-Path -Parent $E2E
$BACKEND = Join-Path $REPO 'backend'
$STATE = Join-Path $E2E '.shards'
$CLI = Join-Path $E2E 'node_modules\@playwright\test\cli.js'
$PSQL = if ($env:PSQL) { $env:PSQL } else { 'C:\Program Files\PostgreSQL\13\bin\psql.exe' }
$JAVA_HOME = 'C:\Program Files\Zulu\zulu-25'
$BUILD_DIR = 'target-shard'
$JAR = Join-Path $BACKEND "$BUILD_DIR\draazy-api-0.0.1-SNAPSHOT.jar"
$MAX_SHARDS = 8
Set-Location $E2E
New-Item -ItemType Directory -Force -Path $STATE | Out-Null

function ApiPort($i) { 8110 + $i }
function AppPort($i) { 5210 + $i }
function DbName($i) { "draazy_e2e_sh$i" }
function JvmFile($i) { Join-Path $STATE "jvm-$i.json" }
function JvmLog($i) { Join-Path $env:TEMP "draazy-shard-$i.log" }

function Stop-ShardJvm($i) {
    $f = JvmFile $i
    if (-not (Test-Path $f)) { return }
    $info = Get-Content $f -Raw | ConvertFrom-Json
    if (Test-OurJvm $info) {
        $p = Get-Process -Id $info.pid -ErrorAction SilentlyContinue
        Stop-Process -Id $info.pid -Force -ErrorAction SilentlyContinue
        if ($p) { $p.WaitForExit(15000) | Out-Null }
    }
    Remove-Item $f -Force
}

# A recycled PID may now be any process; start time pins the shard JVM to the one this runner launched.
function Test-OurJvm($info) {
    $p = Get-Process -Id $info.pid -ErrorAction SilentlyContinue
    if (-not $p -or $p.ProcessName -ne 'java') { return $false }
    if ($null -eq $info.started) { return $true }
    "$($p.StartTime.ToFileTimeUtc())" -eq "$($info.started)"
}

# Dry runs and -Stop take the same lock because they rewrite list files or kill JVMs an active run uses.
$lock = Join-Path $STATE 'lock'
try { $lockHandle = [IO.File]::Open($lock, 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw "run-fast.ps1 is already running (.shards\lock is held). Two runs would reset each other's shard databases." }
try {

if ($Stop) {
    for ($i = 1; $i -le $MAX_SHARDS; $i++) { Stop-ShardJvm $i }
    Write-Host 'Shard JVMs stopped.'
    exit 0
}

function Quote([string]$a) {
    if ($a -notmatch '[\s"]') { return $a }
    '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function SpecRegex([string]$path) {
    $p = ($path -replace '\\', '/') -replace '^\./', '' -replace '^e2e/', ''
    ($p.Split('/') | ForEach-Object { [regex]::Escape($_) }) -join '[\\/]'
}

function Invoke-Node([string[]]$argv, [hashtable]$vars = @{}, [switch]$Quiet) {
    $saved = @{}
    foreach ($k in $vars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $vars[$k]) }
    try {
        if (-not $Quiet) { & node @argv | Out-Host; return $LASTEXITCODE }
        $ErrorActionPreference = 'Continue'
        $out = @(& node @argv 2>&1)
        $rc = $LASTEXITCODE
        if ($rc -ne 0) { $out | Select-Object -Last 30 | ForEach-Object { Write-Host "  $_" } }
        return $rc
    } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }
}

$mode = 'changed'
$live = @()
$nobackend = @()
$asked = @()
if ($Full) { $mode = 'full' }
elseif ($Failed) {
    $lf = Join-Path $STATE 'last-failed.txt'
    if (-not (Test-Path $lf)) { throw 'No previous run recorded (.shards\last-failed.txt missing).' }
    $asked = @(Get-Content $lf | Where-Object { $_.Trim() })
    if ($asked -contains '!rerun-full') { throw 'The last run failed outside any test (setup, teardown or a web server). Run -Full.' }
    if (-not $asked.Count) { Write-Host 'The last run had no failures.'; exit 0 }
    $mode = 'failed'
}
elseif ($Spec) { $asked = @($Spec); $mode = 'spec' }

$lineFilters = @{}
$asked = @($asked | ForEach-Object {
    $p = ((($_ -split "`t")[0] -replace '\\', '/') -replace '^\./', '') -replace '^e2e/', ''
    if ($p -match '^(.+\.spec\.js):(\d+)$') { $p = $Matches[1]; $lineFilters[$p] = @($lineFilters[$p]) + $Matches[2] | Where-Object { $_ } }
    $p
} | Select-Object -Unique)

function Filters([string]$file) {
    $re = (SpecRegex $file) + '$'
    if ($lineFilters.ContainsKey($file)) { return @($lineFilters[$file] | ForEach-Object { "${re}:$_" }) }
    $re
}

if ($mode -ne 'full') {
    $named = @($asked | ForEach-Object { "e2e/$_" })
    $selArgs = @('scripts/related-specs.mjs', '--json', '--base', $Base)
    if ($named.Count) { $selArgs += $named }
    elseif ($Files) { $selArgs += @($Files | ForEach-Object { ($_ -replace '\\', '/') -replace '^\./', '' }) }
    $sel = (& node @selArgs) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'related-specs.mjs failed.' }
    $keep = { param($s) (-not $named.Count) -or ($named -contains $s) }
    if (-not $named.Count) { Write-Host "$($sel.changed.Count) changed file(s)." }
    if ($sel.full) {
        Write-Host 'Whole suite required:'
        $sel.reasons | ForEach-Object { Write-Host "  - $_" }
        $mode = 'full'
    } else {
        $live = @($sel.live | Where-Object { & $keep $_ } | ForEach-Object { $_ -replace '^e2e/', '' })
        $nobackend = @($sel.nobackend | Where-Object { & $keep $_ } | ForEach-Object { $_ -replace '^e2e/', '' })
        $lost = @($asked | Where-Object { ($live + $nobackend) -notcontains $_ })
        if ($lost.Count) { throw "No such spec (renamed or deleted?): $($lost -join ', ')" }
        if (-not ($live.Count + $nobackend.Count)) { Write-Host 'Nothing to run: no change reaches a spec.'; exit 0 }
    }
}

$filters = @($live | ForEach-Object { Filters $_ })
$nbFilters = @($nobackend | ForEach-Object { Filters $_ })
$listArgs = @($CLI, 'test', '--config=playwright.config.js', '--list', '--reporter=json') + $filters
if ($Grep) { $listArgs += @('-g', $Grep) }
if (($listArgs -join ' ').Length -gt 28000 -and $lineFilters.Count) {
    Write-Host 'Too many failed tests for one command line; rerunning their whole files.'
    $lineFilters = @{}
    $filters = @($live | ForEach-Object { Filters $_ })
    $nbFilters = @($nobackend | ForEach-Object { Filters $_ })
    $listArgs = @($CLI, 'test', '--config=playwright.config.js', '--list', '--reporter=json') + $filters
    if ($Grep) { $listArgs += @('-g', $Grep) }
}
if (($listArgs -join ' ').Length -gt 28000) {
    Write-Host 'Selection too large for one command line; running the whole suite.'
    $mode = 'full'; $filters = @(); $nbFilters = @()
    $listArgs = @($CLI, 'test', '--config=playwright.config.js', '--list', '--reporter=json')
    if ($Grep) { $listArgs += @('-g', $Grep) }
}
$runNoBackend = ($mode -eq 'full') -or ($nbFilters.Count -gt 0)
$runLive = ($mode -eq 'full') -or ($filters.Count -gt 0)

$listFile = Join-Path $STATE 'list.json'
$nbListFile = Join-Path $STATE 'list-nobackend.json'
function List-Tests {
    $out = @()
    if ($runLive) {
        $la = @($CLI, 'test', '--config=playwright.config.js', '--list', '--reporter=json') + $filters
        if ($Grep) { $la += @('-g', $Grep) }
        if ((Invoke-Node $la @{ PLAYWRIGHT_JSON_OUTPUT_FILE = $listFile } -Quiet) -ne 0) { throw 'Listing the live tests failed; see the error above.' }
        $out += $listFile
    }
    if ($runNoBackend) {
        $la = @($CLI, 'test', '--config=playwright.nobackend.config.js', '--list', '--reporter=json') + $nbFilters
        if ($Grep) { $la += @('-g', $Grep) }
        if ((Invoke-Node $la @{ PLAYWRIGHT_JSON_OUTPUT_FILE = $nbListFile } -Quiet) -ne 0) { throw 'Listing the no-backend tests failed.' }
        $out += $nbListFile
    }
    , $out
}
$listFiles = List-Tests
if ($lineFilters.Count) {
    $stale = @(& node scripts/shards.mjs stale (Join-Path $STATE 'last-failed.txt') @listFiles | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { throw 'Checking the recorded failures against the specs failed.' }
    if ($stale.Count) {
        Write-Host "Edited since they failed, so rerun whole: $($stale -join ', ')"
        foreach ($s in $stale) { $lineFilters.Remove($s) }
        $filters = @($live | ForEach-Object { Filters $_ })
        $nbFilters = @($nobackend | ForEach-Object { Filters $_ })
        $listFiles = List-Tests
    }
}
$expected = [int](& node scripts/shards.mjs count @listFiles)
if ($LASTEXITCODE -ne 0) { throw 'Counting the listed tests failed.' }
$liveCount = 0
if ($runLive) {
    $liveCount = [int](& node scripts/shards.mjs count $listFile)
    if ($LASTEXITCODE -ne 0) { throw 'Counting the listed live tests failed.' }
}
if ($mode -eq 'full' -and -not $expected -and -not $Grep) { throw 'Listing found no tests at all; the suite cannot be empty.' }
$durations = Join-Path $STATE 'durations.json'
$plan = @()
if ($runLive -and $liveCount) {
    $planFile = Join-Path $STATE 'plan.json'
    & node scripts/shards.mjs plan $listFile $durations ([Math]::Min($Shards, $MAX_SHARDS)) $planFile
    if ($LASTEXITCODE -ne 0) { throw 'Planning the shards failed.' }
    $plan = @((Get-Content $planFile -Raw | ConvertFrom-Json) | ForEach-Object { $_ })
}
$n = $plan.Count

Write-Host ("Mode {0}: {1} test(s) ({2} live across {3} shard(s), {4} no-backend)." -f $mode, $expected, $liveCount, $n, ($expected - $liveCount))
if ($mode -ne 'full' -and $live.Count -le 40) { $live + $nobackend | ForEach-Object { Write-Host "  $_" } }
for ($i = 1; $i -le $n; $i++) { Write-Host ("  shard {0}: {1} file(s), ~{2:n0} min of recorded test time{3}" -f $i, $plan[$i - 1].files.Count, ($plan[$i - 1].seconds / 60), $(if ($lineFilters.Count) { ' (whole files; a partial rerun is shorter)' } else { '' })) }
if ($DryRun) { exit 0 }
if (-not $expected) { Write-Host 'No test matches.'; exit 0 }

Set-Content -Path (Join-Path $STATE 'last-failed.txt') -Value '!rerun-full'

$env:JAVA_HOME = $JAVA_HOME
$env:DRAAZY_DEV_MACHINE = '1'
$env:PGPASSWORD = if ($env:PGPASSWORD) { $env:PGPASSWORD } else { 'postgres' }

if ($n -gt 0) {
    $envFile = Join-Path $BACKEND '.env.local'
    if (Test-Path $envFile) {
        foreach ($raw in Get-Content -LiteralPath $envFile) {
            $line = $raw.Trim()
            if ($line -eq '' -or $line.StartsWith('#')) { continue }
            $eq = $line.IndexOf('=')
            if ($eq -lt 1) { continue }
            [Environment]::SetEnvironmentVariable($line.Substring(0, $eq).Trim(), $line.Substring($eq + 1).Trim().Trim('"'), 'Process')
        }
    }

    $src = @(Get-ChildItem (Join-Path $BACKEND 'src\main') -Recurse -File) + @(Get-Item (Join-Path $BACKEND 'pom.xml'))
    $manifest = ($src | Sort-Object FullName | ForEach-Object { '{0}|{1}|{2}' -f $_.FullName.Substring($BACKEND.Length), $_.Length, $_.LastWriteTimeUtc.Ticks }) -join "`n"
    $sha = [Security.Cryptography.SHA256]::Create()
    $signature = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($manifest)) | ForEach-Object { $_.ToString('x2') })
    $sigFile = Join-Path $STATE 'jar-signature'
    $built = if (Test-Path $sigFile) { (Get-Content $sigFile -Raw).Trim() } else { '' }
    if ($built -ne $signature -or -not (Test-Path $JAR)) {
        for ($i = 1; $i -le $MAX_SHARDS; $i++) { Stop-ShardJvm $i }
        Write-Host "Building the backend jar ($BUILD_DIR)..."
        $classes = Join-Path $BACKEND "$BUILD_DIR\classes"
        if (Test-Path $classes) { Remove-Item $classes -Recurse -Force }
        Push-Location $BACKEND
        try { & cmd /c ".\mvnw.cmd -o -q -DbuildDirName=$BUILD_DIR -Dmaven.test.skip=true package 2>&1" | Out-Host } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
        Set-Content -Path $sigFile -Value $signature -NoNewline
    }

    $starting = @()
    for ($i = 1; $i -le $n; $i++) {
        $f = JvmFile $i
        if (Test-Path $f) {
            $info = Get-Content $f -Raw | ConvertFrom-Json
            if ((Test-OurJvm $info) -and $info.signature -eq $signature) { continue }
            Stop-ShardJvm $i
        }
        if (Get-NetTCPConnection -LocalPort (ApiPort $i) -State Listen -ErrorAction SilentlyContinue) {
            throw "Port $(ApiPort $i) is taken by a process run-fast.ps1 did not start."
        }
        $db = DbName $i
        $exists = & $PSQL -h localhost -w -U postgres -d postgres -tAc "select 1 from pg_database where datname = '$db'"
        if ($LASTEXITCODE -ne 0) { throw 'Cannot reach Postgres on localhost:5432.' }
        if ("$exists".Trim() -ne '1') {
            & $PSQL -h localhost -w -U postgres -d postgres -qc "create database $db" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Could not create database $db." }
        }
        $env:E2E_DB_URL = "jdbc:postgresql://localhost:5432/$db"
        $env:E2E_APP_BASE_URL = "http://localhost:$(AppPort $i)"
        $env:STORAGE_DIR = Join-Path $env:TEMP "draazy-storage-sh$i"
        $log = JvmLog $i
        $javaArgs = @('-jar', (Quote $JAR), '--spring.profiles.active=local,e2e', "--server.port=$(ApiPort $i)")
        $p = Start-Process -FilePath (Join-Path $JAVA_HOME 'bin\java.exe') -ArgumentList $javaArgs -WorkingDirectory $BACKEND `
            -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru
        @{ pid = $p.Id; started = "$($p.StartTime.ToFileTimeUtc())"; signature = $signature } | ConvertTo-Json | Set-Content (JvmFile $i)
        $starting += $i
    }

    if ($starting.Count) { Write-Host "Booting backend shard(s) $($starting -join ', ')..." }
    $deadline = (Get-Date).AddSeconds(300)
    for ($i = 1; $i -le $n; $i++) {
        $info = Get-Content (JvmFile $i) -Raw | ConvertFrom-Json
        while ($true) {
            try {
                $h = Invoke-RestMethod -Uri "http://localhost:$(ApiPort $i)/api/actuator/health" -TimeoutSec 3
                if ($h.status -eq 'UP') { break }
            } catch { }
            if (-not (Get-Process -Id $info.pid -ErrorAction SilentlyContinue) -or (Get-Date) -gt $deadline) {
                Write-Host "Backend shard $i did not come up. Log tail ($(JvmLog $i)):"
                Get-Content (JvmLog $i) -Tail 40 | ForEach-Object { Write-Host "  $_" }
                throw "Backend shard $i failed to start."
            }
            Start-Sleep -Seconds 3
        }
    }
    Write-Host "Backend shard(s) 1..$n healthy."
}

$blobRoot = Join-Path $STATE 'blob'
if (Test-Path $blobRoot) { Remove-Item $blobRoot -Recurse -Force }
$runs = @()

function Start-Run($name, [string[]]$argv, [hashtable]$vars) {
    $log = Join-Path $STATE "$name.log"
    $vars['PLAYWRIGHT_BLOB_OUTPUT_DIR'] = Join-Path $blobRoot $name
    $vars['FORCE_COLOR'] = '0'
    $saved = @{}
    foreach ($k in $vars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $vars[$k]) }
    try {
        $p = Start-Process -FilePath 'node' -ArgumentList (@($argv | ForEach-Object { Quote $_ })) -WorkingDirectory $E2E `
            -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru
    } finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }
    $null = $p.Handle
    [pscustomobject]@{ name = $name; proc = $p; log = $log; total = $null }
}

$started = Get-Date
if ($runNoBackend) {
    $a = @($CLI, 'test', '--config=playwright.nobackend.config.js', '--reporter=blob,list', "--output=$(Join-Path $STATE 'results\nobackend')") + $nbFilters
    if ($Grep) { $a += @('-g', $Grep) }
    $runs += Start-Run 'nobackend' $a @{ NB_PORT = "$(AppPort 0)"; BASE_URL = "http://localhost:$(AppPort 0)" }
}
for ($i = 1; $i -le $n; $i++) {
    $a = @($CLI, 'test', '--config=playwright.config.js', '--workers=1', '--pass-with-no-tests',
        '--reporter=blob,list', "--output=$(Join-Path $STATE "results\shard-$i")") +
        @($plan[$i - 1].files | ForEach-Object { Filters $_ })
    if ($Grep) { $a += @('-g', $Grep) }
    $runs += Start-Run "shard-$i" $a @{
        BASE_URL = "http://localhost:$(AppPort $i)"; API_PORT = "$(ApiPort $i)"; E2E_DB_NAME = (DbName $i)
        E2E_TIMEOUT_SCALE = $(if ($n -gt 1) { '2' } else { '1' })
    }
    if ($i -lt $n) { Start-Sleep -Seconds 4 }
}

$fail = [string][char]0x2718
while ($true) {
    $parts = foreach ($r in $runs) {
        $logLines = if (Test-Path $r.log) { @(Get-Content $r.log -ErrorAction SilentlyContinue) } else { @() }
        if (-not $r.total) {
            $m = $logLines | Select-String -Pattern 'Running (\d+) tests?' | Select-Object -First 1
            if ($m) { $r.total = $m.Matches[0].Groups[1].Value }
        }
        $done = @($logLines | Where-Object { $_ -match '^\s+\S{1,2}\s+\d+\s+\[' -and $_ -notmatch '\(retry #\d+\)' })
        $bad = @($done | Where-Object { $_ -match "^\s+(x|$fail)\s" }).Count
        $progress = if ($r.proc.HasExited) { 'done' } else { "$($done.Count)/$(if ($r.total) { $r.total } else { '?' })" }
        "$($r.name) $progress" + $(if ($bad) { " ($bad failed)" } else { '' })
    }
    $elapsed = [int]((Get-Date) - $started).TotalMinutes
    Write-Host ("[{0,3}m] {1}" -f $elapsed, ($parts -join ' | '))
    if (-not @($runs | Where-Object { -not $_.proc.HasExited }).Count) { break }
    Start-Sleep -Seconds 30
}

$crashed = @($runs | Where-Object { $_.proc.ExitCode -ne 0 -and -not (Get-ChildItem (Join-Path $blobRoot $_.name) -Filter *.zip -ErrorAction SilentlyContinue) })
foreach ($r in $crashed) {
    Write-Host "$($r.name) exited $($r.proc.ExitCode) without a report. Tail of $($r.log):"
    (Get-Content $r.log -Tail 20) + (Get-Content "$($r.log).err" -Tail 20 -ErrorAction SilentlyContinue) | ForEach-Object { Write-Host "  $_" }
}

$merge = Join-Path $STATE 'blob-all'
if (Test-Path $merge) { Remove-Item $merge -Recurse -Force }
New-Item -ItemType Directory -Path $merge | Out-Null
foreach ($r in $runs) {
    Get-ChildItem (Join-Path $blobRoot $r.name) -Filter *.zip -ErrorAction SilentlyContinue |
        ForEach-Object { Copy-Item $_.FullName (Join-Path $merge "$($r.name)-$($_.Name)") }
}
$report = Join-Path $STATE 'report.json'
if (Test-Path $report) { Remove-Item $report -Force }
$mergeExit = Invoke-Node @($CLI, 'merge-reports', $merge, '--reporter=json,html') @{
    PLAYWRIGHT_JSON_OUTPUT_FILE = $report; PLAYWRIGHT_HTML_OUTPUT_DIR = (Join-Path $STATE 'html'); PLAYWRIGHT_HTML_OPEN = 'never'
}
if ($mergeExit -ne 0 -or -not (Test-Path $report)) { throw 'Merging the shard reports failed.' }

$keepDurations = if ($Grep -or $lineFilters.Count) { '-' } else { $durations }
& node scripts/shards.mjs report $report (Join-Path $STATE 'last-failed.txt') $keepDurations @listFiles
$code = $LASTEXITCODE
if ($crashed.Count) { $code = 1 }
$nonzero = @($runs | Where-Object { $_.proc.ExitCode -ne 0 })
if ($nonzero.Count -and $code -eq 0) {
    Write-Host "Exited non-zero with every test green: $(($nonzero | ForEach-Object { "$($_.name)=$($_.proc.ExitCode)" }) -join ', '). See .shards\<name>.log."
    Set-Content -Path (Join-Path $STATE 'last-failed.txt') -Value '!rerun-full'
    $code = 1
}
Write-Host ("Finished in {0:n1} min. HTML report: npx playwright show-report .shards\html" -f ((Get-Date) - $started).TotalMinutes)
if ($code -ne 0) { Write-Host 'Rerun only the failures with: .\run-fast.ps1 -Failed' }
exit $code
} finally {
    foreach ($r in @($runs)) { if ($r -and -not $r.proc.HasExited) { & taskkill /T /F /PID $r.proc.Id 2>&1 | Out-Null } }
    $lockHandle.Dispose()
}
