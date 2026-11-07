# PowerShell script to read the relay auth token
# Used by native host and other components on Windows

$ConfigDir = if ($env:APPDATA) { 
    Join-Path $env:APPDATA "opencode-relay" 
} else { 
    Join-Path $env:USERPROFILE ".config\opencode-relay" 
}

$TokenFile = Join-Path $ConfigDir "auth-token"

if (Test-Path $TokenFile) {
    Get-Content $TokenFile -Raw | ForEach-Object { $_.Trim() }
} else {
    Write-Error "Auth token not found at $TokenFile"
    Write-Error "Please run the relay broker at least once to generate a token."
    exit 1
}
