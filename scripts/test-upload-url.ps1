param(
  [string]$BackendUrl = "http://localhost:8080",
  [string]$Filename = "test-video.mp4",
  [string]$ContentType = "video/mp4"
)

$body = @{ filename = $Filename; contentType = $ContentType } | ConvertTo-Json
Write-Host "POST $BackendUrl/api/upload-url -> body: $body"
try {
  $resp = Invoke-RestMethod -Uri "$BackendUrl/api/upload-url" -Method Post -Body $body -ContentType 'application/json' -ErrorAction Stop
  Write-Host "Response JSON:`n" ($resp | ConvertTo-Json -Depth 5)
  if ($resp.signedUrl -and $resp.signedUrl -ne '') {
    Write-Host "signedUrl found"
  } else {
    Write-Host "ERROR: signedUrl missing in response"
    exit 2
  }
  # Attempt a PUT upload to the signed URL using a small test file
  $tmpPath = Join-Path $PSScriptRoot 'tmp-upload.bin'
  [System.IO.File]::WriteAllBytes($tmpPath, [System.Text.Encoding]::UTF8.GetBytes('hello'))
  Write-Host "Uploading test file to signedUrl..."
  try {
    $putResp = Invoke-RestMethod -Uri $resp.signedUrl -Method Put -InFile $tmpPath -ContentType $ContentType -ErrorAction Stop
    Write-Host "Upload succeeded"
  } catch {
    Write-Host "Upload failed:" $_.Exception.Message
    try { $text = $_.Exception.Response.GetResponseStream() | ForEach-Object { new-object System.IO.StreamReader($_) } | ForEach-Object { $_.ReadToEnd() } ; Write-Host "Upload response:`n" $text } catch {}
    exit 3
  }
} catch {
  Write-Host "Request failed:`n" $_.Exception.Response.StatusCode.Value__ " " $_.Exception.Message
  try { $text = $_.Exception.Response.GetResponseStream() | %{ new-object System.IO.StreamReader($_) } | %{ $_.ReadToEnd() } ; Write-Host "Response text:`n" $text } catch {}
  exit 1
}
