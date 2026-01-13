param(
  [string]$ProjectId = "datalabelapp"
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $root
try {
  firebase use $ProjectId
  firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
} finally {
  Pop-Location
}
