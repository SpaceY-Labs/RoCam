param(
  [string]$ServiceName = "labeler-backend",
  [string]$Region = "us-central1",
  [string]$ProjectId = "dice-459903",
  [string]$Image = "us-central1-docker.pkg.dev/dice-459903/rocam-backend/backend:latest",
  [string]$StorageBucket = "dice-459903.firebasestorage.app",
  [string]$DatabaseId = "datalabelor123",
  [int]$Sam2InternalPort = 9000,
  [string]$Sam2ModelName = "sam2",
  [int]$Sam2TimeoutMs = 180000,
  [int]$Sam2RetryCount = 60,
  [int]$Sam2RetryDelayMs = 2000,
  [int]$RequestTimeoutSec = 600
)

if (-not $Image) {
  Write-Error "Image is required (e.g. gcr.io/PROJECT/labeler-backend:latest or REGION-docker.pkg.dev/PROJECT/repo/image:tag)."
  exit 1
}

$envVars = "FIREBASE_PROJECT_ID=$ProjectId,FIREBASE_STORAGE_BUCKET=$StorageBucket,SAM2_MODEL_NAME=$Sam2ModelName,SAM2_INTERNAL_PORT=$Sam2InternalPort,SAM2_TIMEOUT_MS=$Sam2TimeoutMs,SAM2_RETRY_COUNT=$Sam2RetryCount,SAM2_RETRY_DELAY_MS=$Sam2RetryDelayMs"
if ($DatabaseId) {
  $envVars = "$envVars,FIREBASE_DATABASE_ID=$DatabaseId"
}

$deployArgs = @(
  "run", "deploy", $ServiceName,
  "--region", $Region,
  "--project", $ProjectId,
  "--image", $Image,
  "--allow-unauthenticated",
  "--cpu", "4",
  "--memory", "16Gi",
  "--concurrency", "1",
  "--min-instances", "0",
  "--max-instances", "2",
  "--timeout", $RequestTimeoutSec.ToString(),
  "--set-env-vars", $envVars
)

gcloud @deployArgs
