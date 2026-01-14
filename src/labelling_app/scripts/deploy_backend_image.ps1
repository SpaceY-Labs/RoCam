param(
  [string]$ServiceName = "labeler-backend",
  [string]$Region = "us-central1",
  [string]$ProjectId = "dice-459903",
  [string]$Image = "us-central1-docker.pkg.dev/dice-459903/rocam-backend/backend:latest",
  [string]$StorageBucket = "dice-459903.firebasestorage.app",
  [string]$DatabaseId = "datalabelor123",
  [int]$Sam3InternalPort = 9000,
  [string]$Sam3ModelName = "sam3",
  [int]$Sam3TimeoutMs = 180000,
  [int]$Sam3RetryCount = 60,
  [int]$Sam3RetryDelayMs = 2000
)

if (-not $Image) {
  Write-Error "Image is required (e.g. gcr.io/PROJECT/labeler-backend:latest or REGION-docker.pkg.dev/PROJECT/repo/image:tag)."
  exit 1
}

$envVars = "FIREBASE_PROJECT_ID=$ProjectId,FIREBASE_STORAGE_BUCKET=$StorageBucket,SAM3_MODEL_NAME=$Sam3ModelName,SAM3_INTERNAL_PORT=$Sam3InternalPort,SAM3_TIMEOUT_MS=$Sam3TimeoutMs,SAM3_RETRY_COUNT=$Sam3RetryCount,SAM3_RETRY_DELAY_MS=$Sam3RetryDelayMs"
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
  "--max-instances", "1",
  "--gpu", "1",
  "--gpu-type", "nvidia-l4",
  "--set-env-vars", $envVars
)

gcloud @deployArgs
