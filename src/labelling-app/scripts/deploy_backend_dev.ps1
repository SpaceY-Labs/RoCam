param(
  [string]$ServiceName = "label-backend-dev",
  [string]$Region = "us-central1",
  [string]$ProjectId = "",
  [string]$Repository = "rocam-backend",
  [string]$ImageName = "backend",
  [string]$ImageVersion = "dev",
  [string]$StorageBucket = "",
  [string]$DatabaseId = "",
  [string]$Sam2Endpoint = "",
  [int]$Sam2InternalPort = 9000,
  [string]$Sam2ModelName = "sam2",
  [int]$Sam2TimeoutMs = 180000,
  [int]$Sam2RetryCount = 60,
  [int]$Sam2RetryDelayMs = 2000,
  [int]$RequestTimeoutSec = 300,
  [int]$MaxInstances = 3,
  [int]$Concurrency = 80,
  [string]$Cpu = "1",
  [string]$Memory = "512Mi",
  [int]$TestPort = 18080,
  [string]$TestContainerName = "backend-dev-test",
  [int]$HealthCheckTimeoutSec = 5,
  [int]$SmokeTestTimeoutSec = 10,
  [switch]$SkipTests
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPaths = @(
  (Join-Path $root ".env"),
  (Join-Path $root "backend/.env")
)

# Use UTF-8 for console and child processes
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

function Read-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (!(Test-Path $Path)) {
    return $null
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed -match "^\s*([^=]+?)\s*=\s*(.*)\s*$") {
      $currentKey = $Matches[1].Trim()
      if ($currentKey -ne $Key) {
        continue
      }

      $value = $Matches[2].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      } else {
        $hashIndex = $value.IndexOf("#")
        if ($hashIndex -ge 0) {
          $value = $value.Substring(0, $hashIndex).Trim()
        }
      }

      if ($value.Length -eq 0) {
        return $null
      }

      return $value
    }
  }

  return $null
}

function Resolve-EnvValue {
  param(
    [string]$Key
  )

  foreach ($path in $envPaths) {
    $value = Read-DotEnvValue -Path $path -Key $Key
    if ($value) {
      return $value
    }
  }

  return $null
}

# ---------- Resolve project / bucket / database from .env if not supplied ----------

if (-not $ProjectId) {
  $ProjectId = Resolve-EnvValue -Key "FIREBASE_PROJECT_ID"
  if (-not $ProjectId) {
    $ProjectId = Resolve-EnvValue -Key "VITE_FIREBASE_PROJECT_ID"
  }
}

if (-not $StorageBucket) {
  $StorageBucket = Resolve-EnvValue -Key "FIREBASE_STORAGE_BUCKET"
  if (-not $StorageBucket) {
    $StorageBucket = Resolve-EnvValue -Key "VITE_FIREBASE_STORAGE_BUCKET"
  }
}

if (-not $DatabaseId) {
  $DatabaseId = Resolve-EnvValue -Key "FIREBASE_DATABASE_ID"
}

if (-not $ProjectId) {
  throw "Missing FIREBASE_PROJECT_ID (or VITE_FIREBASE_PROJECT_ID) in .env or -ProjectId argument."
}

if (-not $StorageBucket) {
  $StorageBucket = "$ProjectId.firebasestorage.app"
  Write-Host "StorageBucket not set; defaulting to $StorageBucket"
}

# ---------- Image paths ----------

$localImageTag = "${ImageName}:${ImageVersion}"
$remoteImage = "$Region-docker.pkg.dev/$ProjectId/$Repository/${ImageName}:$ImageVersion"

Push-Location $root
try {
  # ========== BUILD ==========
  Write-Host ""
  Write-Host "=== Building Docker image: $localImageTag ==="
  Write-Host ""

  docker build -t $localImageTag -f backend/Dockerfile .
  if ($LASTEXITCODE -ne 0) {
    throw "Docker build failed with exit code $LASTEXITCODE"
  }

  # ========== SMOKE TESTS ==========
  if (-not $SkipTests) {
    Write-Host ""
    Write-Host "=== Running smoke tests ==="
    Write-Host ""

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
      throw "docker not found in PATH. Install Docker to run container tests."
    }

    docker rm -f $TestContainerName 2>$null | Out-Null

    $runArgs = @(
      "run", "-d",
      "--name", $TestContainerName,
      "-p", "${TestPort}:8080",
      "-e", "FIREBASE_PROJECT_ID=$ProjectId",
      "-e", "FIREBASE_STORAGE_BUCKET=$StorageBucket",
      "-e", "FIREBASE_DATABASE_ID=$DatabaseId",
      "-e", "REQUIRE_AUTH=false",
      $localImageTag
    )

    $containerId = docker @runArgs
    if ($LASTEXITCODE -ne 0 -or -not $containerId) {
      throw "Failed to start backend test container."
    }
    $containerId = $containerId.Trim()

    $healthUrl = "http://localhost:$TestPort/health"
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
      $runningState = docker inspect -f "{{.State.Running}}" $TestContainerName 2>$null
      if ($runningState -eq "false" -or -not $runningState) {
        break
      }

      try {
        Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec $HealthCheckTimeoutSec | Out-Null
        $ready = $true
        break
      } catch {
        Start-Sleep -Seconds 2
      }
    }

    if (-not $ready) {
      $runningState = docker inspect -f "{{.State.Running}}" $TestContainerName 2>$null
      $exitCode = docker inspect -f "{{.State.ExitCode}}" $TestContainerName 2>$null
      Write-Host "Backend container logs:"
      docker logs $TestContainerName 2>&1 | Write-Host
      throw "Backend container did not become healthy at $healthUrl (running=$runningState, exit=$exitCode)."
    }

    & (Join-Path $PSScriptRoot "test_backend.ps1") -WorkspaceRoot $root -Mode "smoke" -ApiBaseUrl "http://localhost:$TestPort" -SmokeTestTimeoutSec $SmokeTestTimeoutSec
    if ($LASTEXITCODE -ne 0) {
      throw "Smoke tests failed."
    }

    docker stop $TestContainerName | Out-Null
    docker rm -f $TestContainerName 2>$null | Out-Null

    Write-Host ""
    Write-Host "=== Smoke tests passed ==="
    Write-Host ""
  } else {
    Write-Host ""
    Write-Host "=== Skipping tests (--SkipTests) ==="
    Write-Host ""
  }

  # ========== PUSH IMAGE ==========
  Write-Host ""
  Write-Host "=== Pushing image to $remoteImage ==="
  Write-Host ""

  docker tag $localImageTag $remoteImage
  gcloud auth configure-docker "$Region-docker.pkg.dev" --quiet
  docker push $remoteImage
  if ($LASTEXITCODE -ne 0) {
    throw "Docker push failed with exit code $LASTEXITCODE"
  }

  # ========== DEPLOY ==========
  Write-Host ""
  Write-Host "=== Deploying $ServiceName to Cloud Run (dev) ==="
  Write-Host "  Region      : $Region"
  Write-Host "  Project     : $ProjectId"
  Write-Host "  Image       : $remoteImage"
  Write-Host "  CPU         : $Cpu"
  Write-Host "  Memory      : $Memory"
  Write-Host "  Concurrency : $Concurrency"
  Write-Host "  Max instances: $MaxInstances"
  Write-Host "  Timeout     : ${RequestTimeoutSec}s"
  Write-Host ""

  $envVars = "FIREBASE_PROJECT_ID=$ProjectId,FIREBASE_STORAGE_BUCKET=$StorageBucket,SAM2_MODEL_NAME=$Sam2ModelName,SAM2_INTERNAL_PORT=$Sam2InternalPort,SAM2_TIMEOUT_MS=$Sam2TimeoutMs,SAM2_RETRY_COUNT=$Sam2RetryCount,SAM2_RETRY_DELAY_MS=$Sam2RetryDelayMs"
  if ($DatabaseId) {
    $envVars = "$envVars,FIREBASE_DATABASE_ID=$DatabaseId"
  }
  if ($Sam2Endpoint) {
    $envVars = "$envVars,SAM2_ENDPOINT=$Sam2Endpoint"
  }

  $deployArgs = @(
    "run", "deploy", $ServiceName,
    "--region", $Region,
    "--project", $ProjectId,
    "--image", $remoteImage,
    "--allow-unauthenticated",
    "--cpu", $Cpu,
    "--memory", $Memory,
    "--concurrency", $Concurrency.ToString(),
    "--min-instances", "0",
    "--max-instances", $MaxInstances.ToString(),
    "--timeout", $RequestTimeoutSec.ToString(),
    "--port", "8080",
    "--set-env-vars", $envVars
  )

  gcloud @deployArgs

  if ($LASTEXITCODE -ne 0) {
    throw "gcloud run deploy failed with exit code $LASTEXITCODE"
  }

  Write-Host ""
  Write-Host "=== Deploy complete ==="
  Write-Host "Service URL: https://label-backend-dev-ptat4y7djq-uc.a.run.app"
  Write-Host ""

} finally {
  docker rm -f $TestContainerName 2>$null | Out-Null
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
  Pop-Location
}
