param(
  [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "node not found in PATH. Install Node.js to run backend tests."
  exit 1
}

Push-Location $WorkspaceRoot
try {
  node test/labelling_api_contract_check.mjs
} finally {
  Pop-Location
}
