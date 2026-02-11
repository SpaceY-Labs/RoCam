<#
.SYNOPSIS
  Deletes untagged Docker images from Google Artifact Registry.

.DESCRIPTION
  Lists all images in the specified Artifact Registry path, identifies versions
  that have no tags, and deletes them. Tagged images (e.g. latest, dev) are kept.

.PARAMETER ProjectId
  GCP project ID.

.PARAMETER Region
  Artifact Registry location (e.g. us-central1).

.PARAMETER Repository
  Artifact Registry repository name.

.PARAMETER ImageName
  Optional. Specific image to clean (e.g. backend, sam-backend). If empty,
  cleans all images in the repository.

.PARAMETER DryRun
  If set, only lists untagged images without deleting them.

.EXAMPLE
  .\cloud-image-cleanup.ps1 -DryRun
  Lists untagged images that would be deleted.

.EXAMPLE
  .\cloud-image-cleanup.ps1
  Deletes all untagged images in rocam-backend.

.EXAMPLE
  .\cloud-image-cleanup.ps1 -ImageName backend
  Deletes only untagged backend image versions.
#>
param(
  [string]$ProjectId = "dice-459903",
  [string]$Region = "us-central1",
  [string]$Repository = "rocam-backend",
  [string]$ImageName = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Use UTF-8 for console and child processes (e.g. gcloud)
$prevOutputEncoding = [Console]::OutputEncoding
$prevPythonEncoding = $env:PYTHONIOENCODING
$prevPythonUtf8 = $env:PYTHONUTF8
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  $env:PYTHONIOENCODING = "utf-8"
  $env:PYTHONUTF8 = "1"
} catch {
  # Ignore if console encoding cannot be changed
}

try {
  # Build list path (repo or specific image)
  $basePath = "$Region-docker.pkg.dev/$ProjectId/$Repository"
  $listPath = if ($ImageName) { "$basePath/$ImageName" } else { $basePath }

  Write-Host ""
  Write-Host "=== Artifact Registry image cleanup ===" -ForegroundColor Cyan
  Write-Host "  Path     : $listPath"
  Write-Host "  Dry run  : $DryRun"
  Write-Host ""

  if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Error "gcloud CLI not found. Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
    exit 1
  }

  Write-Host "Listing images (with tags)..." -ForegroundColor Gray
  $prevErrAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $rawOutput = gcloud artifacts docker images list $listPath --include-tags --format="json" --project=$ProjectId 2>&1
  } finally {
    $ErrorActionPreference = $prevErrAction
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to list images: $rawOutput"
    exit 1
  }

  # gcloud may prepend "Listing items..." before JSON; extract the JSON array
  $rawStr = if ($rawOutput -is [array]) { $rawOutput -join "`n" } else { [string]$rawOutput }
  $jsonStart = $rawStr.IndexOf('[')
  $json = if ($jsonStart -ge 0) { $rawStr.Substring($jsonStart) } else { $rawStr }

  $images = $json | ConvertFrom-Json
  if (-not $images) {
    Write-Host "No images found." -ForegroundColor Gray
    exit 0
  }

  # Handle single-object response (ConvertFrom-Json returns PSCustomObject, not array)
  if ($images -isnot [array]) {
    $images = @($images)
  }

  $untagged = $images | Where-Object {
    $_.tags -eq $null -or ($_.tags -is [array] -and $_.tags.Count -eq 0)
  }

  $count = $untagged.Count
  if ($count -eq 0) {
    Write-Host "No untagged images to delete." -ForegroundColor Green
    exit 0
  }

  Write-Host "Found $count untagged image(s):" -ForegroundColor Yellow
  foreach ($img in $untagged) {
    $fullRef = "$($img.package)@$($img.version)"
    $size = if ($img.metadata.imageSizeBytes) {
      [math]::Round([long]$img.metadata.imageSizeBytes / 1MB, 2).ToString() + " MB"
    } else { "N/A" }
    Write-Host "  - $fullRef ($size)"
  }
  Write-Host ""

  if ($DryRun) {
    Write-Host "Dry run: no images deleted. Run without -DryRun to delete." -ForegroundColor Cyan
    exit 0
  }

  $deleted = 0
  $failed = 0
  $ErrorActionPreference = "Continue"
  foreach ($img in $untagged) {
    $fullRef = "$($img.package)@$($img.version)"
    Write-Host "Deleting $fullRef ..." -ForegroundColor Gray
    gcloud artifacts docker images delete $fullRef --quiet --project=$ProjectId 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $deleted += 1
      Write-Host "  Deleted." -ForegroundColor Green
    } else {
      $failed += 1
      Write-Host "  Failed." -ForegroundColor Red
    }
  }

  Write-Host ""
  Write-Host "Done. Deleted: $deleted, Failed: $failed" -ForegroundColor Cyan
  if ($failed -gt 0) {
    exit 1
  }
} finally {
  [Console]::OutputEncoding = $prevOutputEncoding
  if ($null -ne $prevPythonEncoding) {
    $env:PYTHONIOENCODING = $prevPythonEncoding
  } else {
    Remove-Item Env:PYTHONIOENCODING -ErrorAction SilentlyContinue
  }
  if ($null -ne $prevPythonUtf8) {
    $env:PYTHONUTF8 = $prevPythonUtf8
  } else {
    Remove-Item Env:PYTHONUTF8 -ErrorAction SilentlyContinue
  }
}
