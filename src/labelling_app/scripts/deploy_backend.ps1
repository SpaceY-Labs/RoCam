param(
  [string]$ServiceName = "labeler-backend",
  [string]$Region = "us-east1",
  [string]$ProjectId = "datalabelapp",
  [string]$StorageBucket = "datalabelapp.appspot.com",
  [string]$Sam3Endpoint = "",
  [string]$Sam3ModelName = "sam3",
  [string]$Sam3ApiKey = ""
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $Sam3Endpoint) {
  Write-Error "Sam3Endpoint is required"
  exit 1
}

$envVars = "FIREBASE_PROJECT_ID=$ProjectId,FIREBASE_STORAGE_BUCKET=$StorageBucket,SAM3_ENDPOINT=$Sam3Endpoint,SAM3_MODEL_NAME=$Sam3ModelName"
if ($Sam3ApiKey) {
  $envVars = "$envVars,SAM3_API_KEY=$Sam3ApiKey"
}

gcloud run deploy $ServiceName `
  --region $Region `
  --project $ProjectId `
  --source $root `
  --allow-unauthenticated `
  --set-env-vars $envVars
