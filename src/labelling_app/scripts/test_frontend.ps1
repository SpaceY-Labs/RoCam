param(
  [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error "pnpm not found in PATH. Install pnpm to run frontend build."
  exit 1
}

Push-Location $WorkspaceRoot
try {
  pnpm --filter frontend build
} finally {
  Pop-Location
}
