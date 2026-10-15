$ErrorActionPreference = "SilentlyContinue"

Write-Host "Uninstalling OpenCode Chrome Relay Native Messaging Host..." -ForegroundColor Cyan

$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.opencode.chrome_relay"
if (Test-Path $regPath) {
    Remove-Item -Path $regPath -Recurse -Force
    Write-Host "Removed registry key $regPath" -ForegroundColor Green
}

$installDir = Join-Path $env:LOCALAPPDATA "OpenCode\Relay"
if (Test-Path $installDir) {
    Remove-Item -Path $installDir -Recurse -Force
    Write-Host "Removed manifest directory $installDir" -ForegroundColor Green
}

Write-Host "Native Messaging Host uninstallation complete." -ForegroundColor Cyan
