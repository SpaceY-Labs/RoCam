param(
  [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
  [ValidateSet("contract", "smoke")]
  [string]$Mode = "contract",
  [string]$ServiceUrl = ""
)

function Get-EnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path $Path)) {
    return $null
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed -match "^(?<k>[^=]+)=(?<v>.*)$") {
      $name = $Matches.k.Trim()
      if ($name -eq $Key) {
        return $Matches.v.Trim()
      }
    }
  }

  return $null
}

if (-not $ServiceUrl) {
  $envFiles = @(
    (Join-Path $WorkspaceRoot ".env"),
    (Join-Path $WorkspaceRoot "backend/.env")
  )

  foreach ($envFile in $envFiles) {
    $ServiceUrl = Get-EnvValue $envFile "BACKEND_SERVICE_URL"
    if (-not $ServiceUrl) {
      $ServiceUrl = Get-EnvValue $envFile "BACKNED_SERVICE_URL"
    }
    if ($ServiceUrl) {
      break
    }
  }
}

if (-not $ServiceUrl) {
  Write-Error "Missing BACKEND_SERVICE_URL (or BACKNED_SERVICE_URL). Set it in src/labelling_app/.env or pass -ServiceUrl."
  exit 1
}

$ServiceUrl = $ServiceUrl.Trim().TrimEnd("/")
if ($ServiceUrl.EndsWith("/api")) {
  $ServiceUrl = $ServiceUrl.Substring(0, $ServiceUrl.Length - 4)
}

if ($Mode -eq "smoke") {
  $healthUrl = "$ServiceUrl/health"
  try {
    $response = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 15
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
  Write-Error "node not found in PATH. Install Node.js to run backend contract tests."
  exit 1
}

$env:API_BASE_URL = $ServiceUrl
node (Join-Path $WorkspaceRoot "test/labelling_api_contract_check.mjs")
