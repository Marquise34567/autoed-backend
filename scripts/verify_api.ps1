$base = $Env:NEXT_PUBLIC_API_BASE_URL
if (-not $base) {
  $base = 'https://remarkable-comfort-production-4a9a.up.railway.app'
  Write-Warning "NEXT_PUBLIC_API_BASE_URL not set — defaulting to $base"
}

Write-Host "GET $base/api/health"
Invoke-RestMethod -Uri "$base/api/health" -Method Get | ConvertTo-Json -Depth 5

Write-Host "GET $base/api/jobs"
Invoke-RestMethod -Uri "$base/api/jobs" -Method Get | ConvertTo-Json -Depth 5

Write-Host "POST $base/api/jobs (sample)"
$body = @{ path = 'uploads/test.mp4'; filename = 'test.mp4'; contentType = 'video/mp4' } | ConvertTo-Json
Invoke-RestMethod -Uri "$base/api/jobs" -Method Post -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 5
