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
  if ($resp.uploadUrl -and $resp.uploadUrl -ne '') {
    Write-Host "uploadUrl found"
  } else {
    Write-Host "ERROR: uploadUrl missing in response"
    exit 2
  }
  # Attempt a PUT upload to the uploadUrl using a small test file (do NOT set Content-Type)
  $tmpPath = Join-Path $PSScriptRoot 'tmp-upload.bin'
  [System.IO.File]::WriteAllBytes($tmpPath, [System.Text.Encoding]::UTF8.GetBytes('hello'))
  Write-Host "Uploading test file to signedUrl..."
  try {
    $putReq = [System.Net.WebRequest]::Create($resp.uploadUrl)
    $putReq.Method = 'PUT'
    $data = [System.IO.File]::ReadAllBytes($tmpPath)
    $putReq.ContentLength = $data.Length
    $stream = $putReq.GetRequestStream()
    $stream.Write($data, 0, $data.Length)
    $stream.Close()
    $putResp = $putReq.GetResponse()
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
