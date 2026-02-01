param(
  [string]$ServiceName = "labeler-backend",
  [string]$Region = "us-central1",
  [string]$ProjectId = "",
  [string]$StorageBucket = "",
  [string]$DatabaseId = "",
  [string]$Sam2Endpoint = "",
  [int]$Sam2InternalPort = 9000,
  [string]$Sam2ModelName = "sam2",
  [int]$Sam2TimeoutMs = 180000,
  [int]$Sam2RetryCount = 60,
  [int]$Sam2RetryDelayMs = 2000,
  [int]$RequestTimeoutSec = 600
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPaths = @(
  (Join-Path $root ".env"),
  (Join-Path $root "backend/.env")
)

function Read-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (!(Test-Path $Path)) {
    return $null
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed -match "^\s*([^=]+?)\s*=\s*(.*)\s*$") {
      $currentKey = $Matches[1].Trim()
      if ($currentKey -ne $Key) {
        continue
      }

      $value = $Matches[2].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      } else {
        $hashIndex = $value.IndexOf("#")
        if ($hashIndex -ge 0) {
          $value = $value.Substring(0, $hashIndex).Trim()
        }
      }

      if ($value.Length -eq 0) {
        return $null
      }

      return $value
    }
  }

  return $null
}

function Resolve-EnvValue {
  param(
    [string]$Key
  )

  foreach ($path in $envPaths) {
    $value = Read-DotEnvValue -Path $path -Key $Key
    if ($value) {
      return $value
    }
  }

  return $null
}

if (-not $ProjectId) {
  $ProjectId = Resolve-EnvValue -Key "FIREBASE_PROJECT_ID"
  if (-not $ProjectId) {
    $ProjectId = Resolve-EnvValue -Key "VITE_FIREBASE_PROJECT_ID"
  }
}

if (-not $StorageBucket) {
  $StorageBucket = Resolve-EnvValue -Key "FIREBASE_STORAGE_BUCKET"
  if (-not $StorageBucket) {
    $StorageBucket = Resolve-EnvValue -Key "VITE_FIREBASE_STORAGE_BUCKET"
  }
}

if (-not $DatabaseId) {
  $DatabaseId = Resolve-EnvValue -Key "FIREBASE_DATABASE_ID"
}

if (-not $ProjectId) {
  throw "Missing FIREBASE_PROJECT_ID (or VITE_FIREBASE_PROJECT_ID) in .env."
}

if (-not $StorageBucket) {
  throw "Missing FIREBASE_STORAGE_BUCKET (or VITE_FIREBASE_STORAGE_BUCKET) in .env."
}

$envVars = "FIREBASE_PROJECT_ID=$ProjectId,FIREBASE_STORAGE_BUCKET=$StorageBucket,SAM2_MODEL_NAME=$Sam2ModelName,SAM2_INTERNAL_PORT=$Sam2InternalPort,SAM2_TIMEOUT_MS=$Sam2TimeoutMs,SAM2_RETRY_COUNT=$Sam2RetryCount,SAM2_RETRY_DELAY_MS=$Sam2RetryDelayMs"
if ($DatabaseId) {
  $envVars = "$envVars,FIREBASE_DATABASE_ID=$DatabaseId"
}
if ($Sam2Endpoint) {
  $envVars = "$envVars,SAM2_ENDPOINT=$Sam2Endpoint"
}

gcloud run deploy $ServiceName `
  --region $Region `
  --project $ProjectId `
  --source $root `
  --allow-unauthenticated `
  --cpu 4 `
  --memory 16Gi `
  --concurrency 1 `
  --min-instances 0 `
  --max-instances 1 `
  --timeout $RequestTimeoutSec `
  --gpu 1 `
  --gpu-type nvidia-tesla-t4 `
  --set-env-vars $envVars
