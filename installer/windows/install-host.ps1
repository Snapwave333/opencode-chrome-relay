param (
    [string]$ExtensionId = "opencodechromerelayextensionid",
    [string]$TargetConfig = "debug"
)

$ErrorActionPreference = "Stop"

Write-Host "Installing OpenCode Chrome Relay Native Messaging Host..." -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$rootDir = (Get-Item "$scriptDir\..\..").FullName

# Locate relay-native-host.exe
$exePath = Join-Path $rootDir "target\$TargetConfig\relay-native-host.exe"
if (-not (Test-Path $exePath)) {
    Write-Host "Building relay-native-host binary ($TargetConfig)..." -ForegroundColor Yellow
    if ($TargetConfig -eq "release") {
        cargo build --release -p relay-native-host
    } else {
        cargo build -p relay-native-host
    }
}

if (-not (Test-Path $exePath)) {
    throw "Executable not found at $exePath"
}

# Target directory for installed manifest
$installDir = Join-Path $env:LOCALAPPDATA "OpenCode\Relay"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

$manifestPath = Join-Path $installDir "com.opencode.chrome_relay.json"

# Write concrete manifest
$manifestJson = @{
    name = "com.opencode.chrome_relay"
    description = "OpenCode Chrome Relay Native Messaging Host"
    path = $exePath
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 5

Set-Content -Path $manifestPath -Value $manifestJson -Encoding UTF8
Write-Host "Manifest generated at $manifestPath" -ForegroundColor Green

# Register in HKCU registry
$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.opencode.chrome_relay"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}

Set-ItemProperty -Path $regPath -Name "(Default)" -Value $manifestPath
Write-Host "Registry registered at $regPath pointing to $manifestPath" -ForegroundColor Green
Write-Host "Native Messaging Host installation complete." -ForegroundColor Cyan
