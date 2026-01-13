# Save as set_labelling_api_env.ps1 (run from repo root)
param(
  [string]$ApiBaseUrl,
  [string]$ProjectId,
  [string]$ImageId,
  [string]$ExportId,
  [string]$UserId,
  [string]$ClassId,
  [ValidateSet("anonymous","password","manual")] [string]$AuthMode = "anonymous",
  [string]$FirebaseApiKey,
  [switch]$RunChecks
)

function Read-EnvValue([string]$path, [string]$key) {
  if (-not (Test-Path $path)) { return $null }
  foreach ($line in Get-Content $path) {
    $trim = $line.Trim()
    if (-not $trim -or $trim.StartsWith('#')) { continue }
    if ($trim -match '^(?<k>[^=]+)=(?<v>.*)$') {
      if ($Matches.k.Trim() -eq $key) { return $Matches.v.Trim() }
    }
  }
  return $null
}

function Get-PlainText([SecureString]$secure) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$envFile = "src/labelling_app/.env"
if (-not $FirebaseApiKey) { $FirebaseApiKey = Read-EnvValue $envFile "VITE_FIREBASE_API_KEY" }

if (-not $ApiBaseUrl) { $ApiBaseUrl = Read-Host "API_BASE_URL (Cloud Run URL)" }
if (-not $ProjectId) { $ProjectId = Read-Host "PROJECT_ID" }

$token = $null

if ($AuthMode -eq "manual") {
  $token = Read-Host "Paste Firebase ID token"
} elseif ($AuthMode -eq "password") {
  if (-not $FirebaseApiKey) { throw "Missing Firebase API key." }
  $email = Read-Host "Firebase email"
  $password = Get-PlainText (Read-Host "Firebase password" -AsSecureString)
  $body = @{
    email = $email
    password = $password
    returnSecureToken = $true
  } | ConvertTo-Json
  $resp = Invoke-RestMethod -Method Post `
    -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$FirebaseApiKey" `
    -ContentType "application/json" -Body $body
  $token = $resp.idToken
} else {
  if (-not $FirebaseApiKey) { throw "Missing Firebase API key." }
  $resp = Invoke-RestMethod -Method Post `
    -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$FirebaseApiKey" `
    -ContentType "application/json" -Body "{}"
  $token = $resp.idToken
}

if (-not $token) { throw "Failed to obtain Firebase ID token." }

$env:API_BASE_URL = $ApiBaseUrl
$env:AUTH_TOKEN = $token
$env:PROJECT_ID = $ProjectId
$env:IMAGE_ID = $ImageId
$env:EXPORT_ID = $ExportId
$env:USER_ID = $UserId
$env:CLASS_ID = $ClassId

Write-Host "Env vars set for this session."
if ($RunChecks) {
  node src/labelling_app/test/labelling_api_contract_check.mjs
}
