param(
  [string]$ImageTag = "backend:cloud",
  [string]$Dockerfile = "backend/Dockerfile",
  [string]$ProjectId = "dice-459903",
  [string]$Region = "us-central1",
  [string]$Repository = "rocam-backend",
  [string]$ImageName = "backend",
  [string]$ImageVersion = "latest",
  [bool]$RunDockerTest = $true,
  [ValidateSet("smoke", "contract")]
  [string]$TestMode = "smoke",
  [int]$TestPort = 18080,
  [string]$TestContainerName = "backend-test",
  [string]$FirebaseProjectId = "",
  [string]$StorageBucket = "",
  [string]$DatabaseId = "",
  [int]$HealthCheckTimeoutSec = 5,
  [int]$SmokeTestTimeoutSec = 10
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

# Use UTF-8 for console and child processes (e.g. gcloud/Python) to avoid OSError 22 on Windows cp1252
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

$remoteImage = if ($ImageTag -match "gcr.io|docker.pkg.dev") {
  $ImageTag
} else {
  "$Region-docker.pkg.dev/$ProjectId/$Repository/${ImageName}:$ImageVersion"
}

function Get-EnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }
    $eqIndex = $trimmed.IndexOf("=")
    if ($eqIndex -lt 1) {
      continue
    }
    $name = $trimmed.Substring(0, $eqIndex).Trim()
    if ($name -ne $Key) {
      continue
    }
    return $trimmed.Substring($eqIndex + 1).Trim()
  }
  return $null
}

Push-Location $root
try {
  docker build -t $ImageTag -f $Dockerfile .

  if ($RunDockerTest) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
      throw "docker not found in PATH. Install Docker to run container tests."
    }

    $backendEnvPath = Join-Path $root "backend\.env"
    $resolvedProjectId = if ($FirebaseProjectId) {
      $FirebaseProjectId
    } else {
      Get-EnvValue -Path $backendEnvPath -Key "FIREBASE_PROJECT_ID"
    }
    if (-not $resolvedProjectId) {
      $resolvedProjectId = $ProjectId
    }

    $resolvedBucket = if ($StorageBucket) {
      $StorageBucket
    } else {
      Get-EnvValue -Path $backendEnvPath -Key "FIREBASE_STORAGE_BUCKET"
    }
    if (-not $resolvedBucket) {
      $resolvedBucket = "$resolvedProjectId.firebasestorage.app"
    }

    $resolvedDatabaseId = if ($DatabaseId) {
      $DatabaseId
    } else {
      Get-EnvValue -Path $backendEnvPath -Key "FIREBASE_DATABASE_ID"
    }

    docker rm -f $TestContainerName 2>$null | Out-Null

    $runArgs = @(
      "run", "-d",
      "--name", $TestContainerName,
      "-p", "${TestPort}:8080",
      "-e", "FIREBASE_PROJECT_ID=$resolvedProjectId",
      "-e", "FIREBASE_STORAGE_BUCKET=$resolvedBucket",
      "-e", "FIREBASE_DATABASE_ID=$resolvedDatabaseId",
      "-e", "REQUIRE_AUTH=false",
      $ImageTag
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

    & (Join-Path $PSScriptRoot "test_backend.ps1") -WorkspaceRoot $root -Mode $TestMode -ApiBaseUrl "http://localhost:$TestPort" -SmokeTestTimeoutSec $SmokeTestTimeoutSec
    if ($LASTEXITCODE -ne 0) {
      throw "Backend tests failed."
    }

    docker stop $TestContainerName | Out-Null
  }

  if ($ImageTag -ne $remoteImage) {
    docker tag $ImageTag $remoteImage
  }
  gcloud auth configure-docker "$Region-docker.pkg.dev" --quiet
  docker push $remoteImage
} finally {
  if ($RunDockerTest) {
    docker rm -f $TestContainerName 2>$null | Out-Null
  }
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
