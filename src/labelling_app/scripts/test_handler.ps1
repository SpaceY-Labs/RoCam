param(
  [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Write-Error "python not found in PATH. Install Python to run handler tests."
  exit 1
}

Push-Location $WorkspaceRoot
try {
  python model_archiver/test_handler.py
} finally {
  Pop-Location
}
