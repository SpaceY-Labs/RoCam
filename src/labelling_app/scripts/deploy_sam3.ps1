param(
  [string]$ServiceName = "sam3-service",
  [string]$Region = "us-east1",
  [string]$ProjectId = "datalabelapp",
  [string]$ImageTag = "sam3-service:latest",
  [string]$Sam3ApiKey = ""
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $root
try {
  docker build -t $ImageTag -f sam3-service/Dockerfile .
  $envVars = ""
  if ($Sam3ApiKey) {
    $envVars = "SAM3_API_KEY=$Sam3ApiKey"
  }

  $deployArgs = @(
    "run", "deploy", $ServiceName,
    "--region", $Region,
    "--project", $ProjectId,
    "--image", $ImageTag,
    "--allow-unauthenticated",
    "--cpu", "4",
    "--memory", "16Gi",
    "--concurrency", "1",
    "--min-instances", "0",
    "--max-instances", "1",
    "--gpu", "1",
    "--gpu-type", "nvidia-tesla-t4"
  )

  if ($envVars) {
    $deployArgs += @("--set-env-vars", $envVars)
  }

  gcloud @deployArgs
} finally {
  Pop-Location
}
