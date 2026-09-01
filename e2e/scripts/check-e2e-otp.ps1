# Phase 3 verification: the fixed e2e OTP must not have weakened verification.
# Run with the backend up on :8081 under the `dev,e2e` profiles.
$ErrorActionPreference = 'Continue'

function TryLogin($body) {
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:8081/api/auth/login" -Method Post `
      -ContentType "application/json" -Body $body -ErrorAction Stop
    if ($r.otpSent) { return "200 otpSent" }
    return "200 authenticated as " + $r.user.name
  } catch {
    $s = $_.Exception.Response.StatusCode.value__
    $t = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
    return "$s $t"
  }
}

Write-Output ("1 replay the consumed code : " + (TryLogin '{"mobile":"9700000001","otp":"000000"}'))
Write-Output ("2 request a fresh code     : " + (TryLogin '{"mobile":"9700000001"}'))
Write-Output ("3 WRONG code against it    : " + (TryLogin '{"mobile":"9700000001","otp":"123456"}'))
Write-Output ("4 fixed code against it    : " + (TryLogin '{"mobile":"9700000001","otp":"000000"}'))
