# PowerShell Script to create model.mar
param(
  [string]$ModelName = "sam3",
  [string]$Version = "1.0",
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..\\..")).Path,
  [string]$SerializedFile = (Join-Path $RepoRoot "src\\labelling_app\\model_archiver\\weight\\sam3.pt"),
  [string]$HandlerFile = (Join-Path $RepoRoot "src\\labelling_app\\model_archiver\\handler.py"),
  [string]$RequirementsFile = (Join-Path $RepoRoot "src\\labelling_app\\model_archiver\\requirements.txt"),
  [string]$ExportPath = (Join-Path $RepoRoot "src\\labelling_app\\model_archiver\\model_artifacts"),
  [string[]]$ExtraFiles = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Command torch-model-archiver -ErrorAction SilentlyContinue)) {
  throw "torch-model-archiver not found in PATH. Install TorchServe tools before running this script."
}

$pathsToCheck = @($SerializedFile, $HandlerFile, $RequirementsFile)
foreach ($path in $pathsToCheck) {
  if (-not (Test-Path $path)) {
    throw "Required file not found: $path"
  }
}

if (-not (Test-Path $ExportPath)) {
  New-Item -ItemType Directory -Path $ExportPath -Force | Out-Null
}

$argsList = @(
  "--model-name", $ModelName,
  "--version", $Version,
  "--serialized-file", $SerializedFile,
  "--handler", $HandlerFile,
  "--requirements-file", $RequirementsFile,
  "--export-path", $ExportPath
)

if ($ExtraFiles.Count -gt 0) {
  $argsList += @("--extra-files", ($ExtraFiles -join ","))
}

& torch-model-archiver @argsList

Write-Host "Success: model.mar has been created in $ExportPath" -ForegroundColor Green
