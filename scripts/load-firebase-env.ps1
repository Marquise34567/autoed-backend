param(
  [string]$Path
)

if (-not $Path) {
  Write-Host "Usage: .\load-firebase-env.ps1 -Path <service-account.json>"
  Write-Host "Example: .\load-firebase-env.ps1 -Path 'C:\Users\You\Downloads\service-account.json'"
  exit 1
}

if (-not (Test-Path $Path)) {
  Write-Error "File not found: $Path"
  exit 1
}

# Read and parse the JSON service account
$svc = Get-Content $Path -Raw | ConvertFrom-Json
if (-not $svc) {
  Write-Error "Failed to parse JSON from $Path"
  exit 1
}

# Set environment variables in the current PowerShell session.
# The app expects FIREBASE_PRIVATE_KEY to contain literal "\\n" sequences
# (Railway/CI style). Handle both cases:
# - If the parsed JSON already contains literal "\\n" sequences, use as-is.
# - If it contains real newlines, convert them to the escaped sequence.
$env:FIREBASE_PROJECT_ID = $svc.project_id
$env:FIREBASE_CLIENT_EMAIL = $svc.client_email

# Determine if private_key already contains escaped backslash-n sequences
if ($svc.private_key -match '\\n') {
  $env:FIREBASE_PRIVATE_KEY = $svc.private_key
} else {
  # Use single-quoted replacement to avoid PowerShell double-escaping
  $env:FIREBASE_PRIVATE_KEY = $svc.private_key -replace "(`r`n|`n|`r)", '\\n'
}

# Collapse any accidental double-escaped sequences (\\n -> \n)
while ($env:FIREBASE_PRIVATE_KEY -match '\\\\n') {
  $env:FIREBASE_PRIVATE_KEY = $env:FIREBASE_PRIVATE_KEY -replace '\\\\n','\\n'
}

Write-Host "Environment variables set in this session: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
Write-Host "Run your app in the same session, e.g.:"
Write-Host "node .\autoed-backend-ready\index.js"
