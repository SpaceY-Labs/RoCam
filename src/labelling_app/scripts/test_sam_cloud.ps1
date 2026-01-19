param(
  [string]$ServiceUrl = "",
  [string]$GcsObject = "",
  [string]$ServiceAccountKey = "",
  [int]$SignedUrlHours = 1
)

function Get-EnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path $Path)) {
    return $null
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed -match "^(?<k>[^=]+)=(?<v>.*)$") {
      $name = $Matches.k.Trim()
      if ($name -eq $Key) {
        return $Matches.v.Trim()
      }
    }
  }

  return $null
}

function Resolve-EnvValue([string[]]$Paths, [string]$Key) {
  foreach ($path in $Paths) {
    $value = Get-EnvValue $path $Key
    if ($value) {
      return $value
    }
  }
  return $null
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Error "gcloud not found in PATH. Install Google Cloud SDK to sign URLs."
  exit 1
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPaths = @(
  (Join-Path $root ".env"),
  (Join-Path $root "backend/.env")
)

if (-not $ServiceUrl) {
  $ServiceUrl = Resolve-EnvValue $envPaths "BACKEND_SERVICE_URL"
  if (-not $ServiceUrl) {
    $ServiceUrl = Resolve-EnvValue $envPaths "BACKNED_SERVICE_URL"
  }
}

if (-not $ServiceUrl) {
  Write-Error "Missing BACKEND_SERVICE_URL. Set it in src/labelling_app/.env or pass -ServiceUrl."
  exit 1
}

$ServiceUrl = $ServiceUrl.Trim().TrimEnd("/")
if ($ServiceUrl.EndsWith("/api")) {
  $ServiceUrl = $ServiceUrl.Substring(0, $ServiceUrl.Length - 4)
}

if (-not $GcsObject) {
  $bucket = Resolve-EnvValue $envPaths "FIREBASE_STORAGE_BUCKET"
  if (-not $bucket) {
    $projectId = Resolve-EnvValue $envPaths "FIREBASE_PROJECT_ID"
    if ($projectId) {
      $bucket = "$projectId.firebasestorage.app"
    }
  }

  if (-not $bucket) {
    Write-Error "Missing FIREBASE_STORAGE_BUCKET; pass -GcsObject to set the test asset."
    exit 1
  }

  $GcsObject = "gs://$bucket/sam-test/capstone.mp4"
}

if (-not $ServiceAccountKey) {
  if ($env:GOOGLE_APPLICATION_CREDENTIALS) {
    $ServiceAccountKey = $env:GOOGLE_APPLICATION_CREDENTIALS
  } else {
    $defaultKey = Join-Path $env:APPDATA "gcloud\\labelling-app-local.json"
    if (Test-Path $defaultKey) {
      $ServiceAccountKey = $defaultKey
    }
  }
}

if (-not $ServiceAccountKey -or -not (Test-Path $ServiceAccountKey)) {
  Write-Error "Service account key not found. Pass -ServiceAccountKey or set GOOGLE_APPLICATION_CREDENTIALS."
  exit 1
}

$signedUrlLines = & gcloud storage sign-url --duration "${SignedUrlHours}h" --private-key-file $ServiceAccountKey $GcsObject 2>&1
$signedUrl = $null
foreach ($line in $signedUrlLines) {
  if ($line -match "^signed_url:\s*(.+)$") {
    $signedUrl = $Matches[1].Trim()
    break
  }
}

if (-not $signedUrl) {
  Write-Error "Failed to parse signed URL from gcloud output.`n$signedUrlLines"
  exit 1
}

& (Join-Path $PSScriptRoot "test_backend_cloud.ps1") `
  -Mode contract `
  -ServiceUrl $ServiceUrl `
  -RunSegment `
  -SegmentImageUrl $signedUrl

exit $LASTEXITCODE
