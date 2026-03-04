param (
    [string]$RemoteUser = "chens356",
    [string]$RemoteHost = "grace.cas.mcmaster.ca",
    [string]$RemoteDir = "~/capstone",
    # Where to save downloaded out/ and out_partXXX folders (use -StoragePath or -LocalDir)
    [Alias("StoragePath")]
    [string]$LocalDir = "./server_outputs",
    [int]$StartPart = 1,
    [int]$EndPart = 228
)

# Resolve storage path to absolute so relative paths work from any cwd
$StoragePath = (Resolve-Path -Path $LocalDir -ErrorAction SilentlyContinue).Path
if (-not $StoragePath) {
    $StoragePath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $LocalDir))
}

# Create local directory if it doesn't exist
if (-not (Test-Path $StoragePath)) {
    New-Item -ItemType Directory -Path $StoragePath -Force | Out-Null
}

# SSH control socket: one connection, one password prompt, all scp reuse it
$ControlPath = Join-Path $env:TEMP "ssh_grace_ctl_$($RemoteHost -replace '\.','_')"
$SshOpts = @('-o', "ControlPath=$ControlPath", '-o', 'ControlPersist=10m')

Write-Host "Starting downloads from $RemoteUser@${RemoteHost}:$RemoteDir to $StoragePath" -ForegroundColor Cyan
Write-Host "Opening SSH connection (enter password once)..." -ForegroundColor Yellow
# Start master connection – you'll be prompted for password only here
ssh -M -S $ControlPath -o ControlPersist=10m -f -N "$RemoteUser@$RemoteHost"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to open SSH connection." -ForegroundColor Red
    exit $LASTEXITCODE
}

try {
    # Download the main 'out' folder
    Write-Host "`nDownloading main 'out' directory..." -ForegroundColor Yellow
    scp @SshOpts -r "$RemoteUser`@$RemoteHost`:$RemoteDir/out" $StoragePath
    if ($LASTEXITCODE -ne 0) { throw "scp failed for out" }

    # Download out_partXXX folders sequentially (reuse same connection – no more password prompts)
    for ($i = $StartPart; $i -le $EndPart; $i++) {
        $partStr = "{0:D3}" -f $i
        $folderName = "out_part$partStr"

        Write-Host "`nDownloading $folderName..." -ForegroundColor Yellow
        scp @SshOpts -r "$RemoteUser`@$RemoteHost`:$RemoteDir/$folderName" $StoragePath

        if ($LASTEXITCODE -ne 0) {
            Write-Host "Error downloading $folderName. You can resume with -StartPart $i" -ForegroundColor Red
            exit $LASTEXITCODE
        }
    }

    Write-Host "`nAll downloads completed successfully!" -ForegroundColor Green
} finally {
    # Close the master connection
    ssh -S $ControlPath -O exit "$RemoteUser@$RemoteHost" 2>$null
}
