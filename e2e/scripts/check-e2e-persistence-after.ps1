# Phase 3 verification, part 2 of 2: the same account must survive a backend restart.
#
# Run after restarting the backend. A pass means two things at once: the row is in Postgres rather
# than in a JVM's memory, and the identity is *stable* - the id below must equal the one
# check-e2e-persistence-before.ps1 printed. A fresh id would mean login silently re-registered the
# number, which looks like a pass from the browser and is not one.
$ErrorActionPreference = 'Stop'
$api = "http://localhost:8081/api/auth/login"
$mobile = "9700009911"

Invoke-RestMethod -Uri $api -Method Post -ContentType "application/json" `
  -Body ('{"mobile":"' + $mobile + '"}') | Out-Null

$r = Invoke-RestMethod -Uri $api -Method Post -ContentType "application/json" `
  -Body ('{"mobile":"' + $mobile + '","otp":"000000"}')
Write-Output ("after restart: id=" + $r.user.id + " mobile=" + $r.user.mobile)
Write-Output ("PASS if this id matches the one printed before the restart.")
