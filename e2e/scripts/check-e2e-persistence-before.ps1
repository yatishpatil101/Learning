# Phase 3 verification, part 1 of 2: create a user through the real API.
#
# The owner requirement for `punenest_e2e` is that a user created by a spec survives a backend
# restart. This half creates one; check-e2e-persistence-after.ps1 is run after the restart and
# proves the same account still logs in. Splitting them is the point - a single script could not
# tell a durable row apart from one that merely lived in the same JVM.
$ErrorActionPreference = 'Stop'
$api = "http://localhost:8081/api/auth/login"
$mobile = "9700009911"

$r1 = Invoke-RestMethod -Uri $api -Method Post -ContentType "application/json" `
  -Body ('{"mobile":"' + $mobile + '"}')
Write-Output ("send  : otpSent=" + $r1.otpSent)

$r2 = Invoke-RestMethod -Uri $api -Method Post -ContentType "application/json" `
  -Body ('{"mobile":"' + $mobile + '","otp":"000000"}')
Write-Output ("verify: id=" + $r2.user.id + " mobile=" + $r2.user.mobile + " role=" + $r2.user.role)
Write-Output ("NOTE  : restart the backend, then run check-e2e-persistence-after.ps1")
