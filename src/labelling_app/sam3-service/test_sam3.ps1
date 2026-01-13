param(
  [string]$Endpoint = "http://localhost:1456",
  [string]$ModelName = "sam3",
  [string]$ApiKey = ""
)

$payload = @{
  image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/WSH2ZcAAAAASUVORK5CYII="
  mode = "click"
  points = @(
    @{ x = 0.5; y = 0.5; label = 1 }
  )
}

$body = $payload | ConvertTo-Json -Depth 6
$uri = "$Endpoint/predictions/$ModelName"

Write-Host "POST $uri"
$headers = @{}
if ($ApiKey) {
  $headers["x-api-key"] = $ApiKey
}

$response = Invoke-RestMethod -Method Post -Uri $uri -Body $body -ContentType "application/json" -Headers $headers
$response | ConvertTo-Json -Depth 6
