param(
  [string]$ServiceName = "labeler-backend",
  [string]$Region = "us-central1",
  [string]$ProjectId = "dice-459903",
  [string]$StorageBucket = "dice-459903.firebasestorage.app",
  [string]$DatabaseId = "datalabelor123",
  [string]$Sam3Endpoint = "",
  [int]$Sam3InternalPort = 9000,
  [string]$Sam3ModelName = "sam3",
  [int]$Sam3TimeoutMs = 180000,
  [int]$Sam3RetryCount = 60,
  [int]$Sam3RetryDelayMs = 2000
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

$envVars = "FIREBASE_PROJECT_ID=$ProjectId,FIREBASE_STORAGE_BUCKET=$StorageBucket,SAM3_MODEL_NAME=$Sam3ModelName,SAM3_INTERNAL_PORT=$Sam3InternalPort,SAM3_TIMEOUT_MS=$Sam3TimeoutMs,SAM3_RETRY_COUNT=$Sam3RetryCount,SAM3_RETRY_DELAY_MS=$Sam3RetryDelayMs"
if ($DatabaseId) {
  $envVars = "$envVars,FIREBASE_DATABASE_ID=$DatabaseId"
}
if ($Sam3Endpoint) {
  $envVars = "$envVars,SAM3_ENDPOINT=$Sam3Endpoint"
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
  --gpu 1 `
  --gpu-type nvidia-tesla-t4 `
  --set-env-vars $envVars
