param (
    [string]$ExtensionId = "opencode-relay@example.com",
    [string]$TargetConfig = "debug"
)

$ErrorActionPreference = "Stop"

Write-Host "Installing OpenCode Firefox Relay Native Messaging Host..." -ForegroundColor Cyan

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

# Target directory for installed manifest (Firefox uses %APPDATA%\Mozilla\NativeMessagingHosts)
$installDir = Join-Path $env:APPDATA "Mozilla\NativeMessagingHosts"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

$manifestPath = Join-Path $installDir "com.opencode.chrome_relay.json"

# Write concrete manifest for Firefox
$manifestJson = @{
    name = "com.opencode.chrome_relay"
    description = "OpenCode Firefox Relay Native Messaging Host"
    path = $exePath
    type = "stdio"
    allowed_extensions = @("moz-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 5

Set-Content -Path $manifestPath -Value $manifestJson -Encoding UTF8
Write-Host "Firefox manifest generated at $manifestPath" -ForegroundColor Green

Write-Host "Firefox Native Messaging Host installation complete." -ForegroundColor Cyan