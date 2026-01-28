$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $root ".env"

function Read-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (!(Test-Path $Path)) {
    throw "Missing .env file at $Path"
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
        throw "Empty value for $Key in $Path"
      }

      return $value
    }
  }

  return $null
}

$projectId = Read-DotEnvValue -Path $envPath -Key "VITE_FIREBASE_PROJECT_ID"
if (-not $projectId) {
  $projectId = Read-DotEnvValue -Path $envPath -Key "FIREBASE_PROJECT_ID"
}
if (-not $projectId) {
  $projectId = Read-DotEnvValue -Path $envPath -Key "PROJECT_ID"
}

if (-not $projectId) {
  throw "Missing Firebase project ID in $envPath (VITE_FIREBASE_PROJECT_ID, FIREBASE_PROJECT_ID, or PROJECT_ID)."
}

Push-Location $root
try {
  npx firebase use $projectId
  npx firebase deploy --project $projectId --only firestore:rules,firestore:indexes,storage,hosting
} finally {
  Pop-Location
}
