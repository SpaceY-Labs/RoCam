param(
  [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
  [ValidateSet("contract", "smoke")]
  [string]$Mode = "contract",
  [string]$ApiBaseUrl = "",
  [switch]$RunSegment,
  [string]$SegmentImageUrl = ""
)

if ($Mode -eq "smoke") {
  if (-not $ApiBaseUrl) {
    $ApiBaseUrl = "http://localhost:8080"
  }

  $healthUrl = ($ApiBaseUrl.TrimEnd("/")) + "/health"
  try {
    $response = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 10
  } catch {
    Write-Error "Backend smoke test failed at $healthUrl. $_"
    exit 1
  }

  if ($response -is [string]) {
    Write-Host "Backend smoke test OK: $response"
  } else {
    Write-Host "Backend smoke test OK."
  }
  exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "node not found in PATH. Install Node.js to run backend tests."
  exit 1
}

Push-Location $WorkspaceRoot
try {
  $previousApiBaseUrl = $env:API_BASE_URL
  $prevRunSegment = $env:RUN_SEGMENT
  $prevSegmentImageUrl = $env:SEGMENT_IMAGE_URL
  if ($ApiBaseUrl) {
    $env:API_BASE_URL = $ApiBaseUrl
  }
  if ($RunSegment) {
    $env:RUN_SEGMENT = "1"
  }
  if ($SegmentImageUrl) {
    $env:SEGMENT_IMAGE_URL = $SegmentImageUrl
  }
  node test/labelling_api_contract_check.mjs
} finally {
  if ($ApiBaseUrl) {
    if ($previousApiBaseUrl) {
      $env:API_BASE_URL = $previousApiBaseUrl
    } else {
      Remove-Item Env:API_BASE_URL -ErrorAction SilentlyContinue
    }
  }
  if ($RunSegment) {
    if ($prevRunSegment) {
      $env:RUN_SEGMENT = $prevRunSegment
    } else {
      Remove-Item Env:RUN_SEGMENT -ErrorAction SilentlyContinue
    }
  }
  if ($SegmentImageUrl) {
    if ($prevSegmentImageUrl) {
      $env:SEGMENT_IMAGE_URL = $prevSegmentImageUrl
    } else {
      Remove-Item Env:SEGMENT_IMAGE_URL -ErrorAction SilentlyContinue
    }
  }
  Pop-Location
}
