param(
  [string]$ProjectId = "datalabelapp"
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $root
try {
  firebase use $ProjectId
  firebase emulators:start --only firestore,storage,auth
} finally {
  Pop-Location
}
