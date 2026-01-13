param(
  [string]$Tag = "sam3-local",
  [string]$ApiKey = "",
  [switch]$UseGpu
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $root
try {
  docker build -t $Tag -f sam3-service/Dockerfile .
  $envArgs = @()
  if ($ApiKey) {
    $envArgs += @("-e", "SAM3_API_KEY=$ApiKey")
  }

  $gpuArgs = @()
  if ($UseGpu) {
    $gpuArgs = @("--gpus", "all")
  }

  docker run --rm `
    -p 1456:8080 `
    @gpuArgs `
    @envArgs `
    $Tag
} finally {
  Pop-Location
}
