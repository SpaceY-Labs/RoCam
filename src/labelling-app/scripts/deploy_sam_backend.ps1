param(
  [string]$ServiceName = "sam-backend",
  [string]$Region = "us-central1",
  [string]$ProjectId = "dice-459903",
  [string]$Repository = "rocam-backend",
  [string]$ImageName = "sam-backend",
  [string]$ImageVersion = "latest",
  [int]$RequestTimeoutSec = 300,
  [int]$MaxInstances = 3,
  [int]$Concurrency = 80,
  [string]$Cpu = "4",
  [string]$Memory = "16Gi",
  [string]$Gpu = "1",
  [string]$GpuType = "nvidia-l4",
  [switch]$SkipBuild
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$samBackendDir = Join-Path $root "sam-backend"
$dockerfile = Join-Path $samBackendDir "Dockerfile"

$registryImage = "$Region-docker.pkg.dev/$ProjectId/$Repository/${ImageName}:${ImageVersion}"

# ---------- Build ----------

if (-not $SkipBuild) {
  Write-Host ""
  Write-Host "=== Building Docker image: ${ImageName}:${ImageVersion} ===" -ForegroundColor Cyan
  Write-Host ""

  docker build -t "${ImageName}:${ImageVersion}" -f $dockerfile $samBackendDir

  if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build failed"
    exit 1
  }

  # Tag and push
  Write-Host ""
  Write-Host "=== Pushing image to $registryImage ===" -ForegroundColor Cyan
  Write-Host ""

  gcloud auth configure-docker "$Region-docker.pkg.dev" --quiet
  docker tag "${ImageName}:${ImageVersion}" $registryImage
  docker push $registryImage

  if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker push failed"
    exit 1
  }
}

# ---------- Deploy ----------

Write-Host ""
Write-Host "=== Deploying $ServiceName to Cloud Run ===" -ForegroundColor Cyan
Write-Host "  Region      : $Region"
Write-Host "  Project     : $ProjectId"
Write-Host "  Image       : $registryImage"
Write-Host "  CPU         : $Cpu"
Write-Host "  Memory      : $Memory"
Write-Host "  GPU         : $Gpu x $GpuType"
Write-Host "  Concurrency : $Concurrency"
Write-Host "  Max instances: $MaxInstances"
Write-Host "  Timeout     : ${RequestTimeoutSec}s"
Write-Host ""

gcloud run deploy $ServiceName `
  --project $ProjectId `
  --region $Region `
  --image $registryImage `
  --cpu $Cpu `
  --memory $Memory `
  --gpu $Gpu `
  --gpu-type $GpuType `
  --concurrency $Concurrency `
  --max-instances $MaxInstances `
  --timeout "${RequestTimeoutSec}s" `
  --no-cpu-throttling `
  --port 8080 `
  --allow-unauthenticated `
  --set-env-vars "SAM_MODEL_NAME=sam2.1_b.pt,SAM_DEVICE=cuda,SAM_IMGSZ=1024"

if ($LASTEXITCODE -ne 0) {
  Write-Error "Cloud Run deploy failed"
  exit 1
}

Write-Host ""
Write-Host "=== Deploy complete ===" -ForegroundColor Green

$serviceUrl = gcloud run services describe $ServiceName --project $ProjectId --region $Region --format "value(status.url)" 2>$null
if ($serviceUrl) {
  Write-Host "Service URL: $serviceUrl" -ForegroundColor Green
}
