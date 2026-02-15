$url = 'https://www.autoeditor.app/editor'
$deadline = (Get-Date).AddMinutes(5)
Write-Host "Starting deeper health check for $url"
$deeperResult = @{}
try {
    $start = Get-Date
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
    $elapsed = (Get-Date) - $start
    $deeperResult.status = $r.StatusCode
    $deeperResult.time_s = [math]::Round($elapsed.TotalSeconds, 3)
    $deeperResult.size = $r.RawContentLength
    $deeperResult.snippet = ($r.Content.Substring(0, [math]::Min(500, $r.Content.Length)) -replace "`r`n", " ")
    Write-Host ("Deeper check: status={0} time={1}s size={2} chars" -f $deeperResult.status, $deeperResult.time_s, $deeperResult.size)
} catch {
    Write-Host "Deeper check error: $($_.Exception.Message)"
    $deeperResult.error = $_.Exception.Message
    if ($_.Exception.Response) {
        try { $deeperResult.httpStatus = $_.Exception.Response.StatusCode.Value__ } catch {}
    }
}

$pollResult = 'timeout'
$logs = @()
while ((Get-Date) -lt $deadline) {
    try {
        $p = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
        $code = $p.StatusCode
        $entry = "$(Get-Date -Format o) STATUS $code"
        $logs += $entry
        Write-Host $entry
        if ($code -eq 200) {
            Write-Host '200 OK - endpoint healthy'
            $pollResult = '200'
            break
        }
    } catch {
        if ($_.Exception.Response) {
            try {
                $sc = $_.Exception.Response.StatusCode.Value__
                $logs += "$(Get-Date -Format o) HTTP $sc"
                Write-Host "HTTP $sc"
            } catch {
                $logs += "$(Get-Date -Format o) Error $($_.Exception.Message)"
                Write-Host "Error: $($_.Exception.Message)"
            }
        } else {
            $logs += "$(Get-Date -Format o) Error $($_.Exception.Message)"
            Write-Host "Error: $($_.Exception.Message)"
        }
    }
    Start-Sleep -Seconds 30
}
if ((Get-Date) -ge $deadline -and $pollResult -ne '200') {
    Write-Host 'Timeout reached without 200'
    $pollResult = 'timeout'
}

$ts = (Get-Date).ToString('yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Force -Path incidents | Out-Null
$path = "incidents/incident-$ts.md"
$jsonDeeper = [System.Text.Json.JsonSerializer]::Serialize($deeperResult)
$pollingText = [string]::Join("`n", $logs)
$md = @"
# Incident report: health check for $url

- Timestamp: $(Get-Date -Format o)
- URL: $url

## Deeper check

$jsonDeeper

## Polling results (30s interval until $($deadline.ToString('o')))

$pollingText

- Final poll status: $pollResult

"@
$md | Out-File -FilePath $path -Encoding utf8 -Force
Write-Host "Wrote incident file: $path"

git add $path
try { git commit -m "chore(incident): health check for $url at $ts" } catch { Write-Host "No changes to commit or commit failed" }
try { git push } catch { Write-Host "Push failed or no remote configured" }
Write-Host "Done."
