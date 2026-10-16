# Setup Material 3 Icons, 1-Click Access, and Windows Native Host Registration
Add-Type -AssemblyName System.Drawing

$iconsDir = Join-Path $PSScriptRoot "apps\chrome-extension\icons"
if (!(Test-Path $iconsDir)) {
    New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null
}

function Generate-RelayIcon([int]$size, [string]$filePath) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Background rounded rect (Near black #0d1117 with subtle border)
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 13, 17, 23))
    $rect = New-Object System.Drawing.Rectangle(1, 1, ($size - 2), ($size - 2))
    
    # Fill rounded rect
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $radius = [Math]::Max(2, [int]($size * 0.22))
    $dia = $radius * 2
    $path.AddArc($rect.X, $rect.Y, $dia, $dia, 180, 90)
    $path.AddArc($rect.Right - $dia, $rect.Y, $dia, $dia, 270, 90)
    $path.AddArc($rect.Right - $dia, $rect.Bottom - $dia, $dia, $dia, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $dia, $dia, $dia, 90, 90)
    $path.CloseFigure()
    
    $g.FillPath($bgBrush, $path)

    # Cyan Accent Border (#00d4ff)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0, 212, 255), [Math]::Max(1.0, $size * 0.05))
    $g.DrawPath($borderPen, $path)

    # Cyan Lightning Bolt Glyph (#00d4ff)
    $cyanBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 212, 255))
    
    # Scale points to size
    $pts = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new([float]($size * 0.52), [float]($size * 0.16)),
        [System.Drawing.PointF]::new([float]($size * 0.26), [float]($size * 0.54)),
        [System.Drawing.PointF]::new([float]($size * 0.48), [float]($size * 0.54)),
        [System.Drawing.PointF]::new([float]($size * 0.44), [float]($size * 0.84)),
        [System.Drawing.PointF]::new([float]($size * 0.74), [float]($size * 0.46)),
        [System.Drawing.PointF]::new([float]($size * 0.54), [float]($size * 0.46))
    )
    $g.FillPolygon($cyanBrush, $pts)

    $bmp.Save($filePath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated icon ($size x $size): $filePath" -ForegroundColor Green
}

# Generate 16, 32, 48, 128
Generate-RelayIcon 16 (Join-Path $iconsDir "icon16.png")
Generate-RelayIcon 32 (Join-Path $iconsDir "icon32.png")
Generate-RelayIcon 48 (Join-Path $iconsDir "icon48.png")
Generate-RelayIcon 128 (Join-Path $iconsDir "icon128.png")

# Native Messaging Manifest
$manifestDir = Join-Path $PSScriptRoot "manifests"
if (!(Test-Path $manifestDir)) {
    New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
}
$manifestPath = Join-Path $manifestDir "com.opencode.chrome_relay.json"
$nativeHostExe = Join-Path $PSScriptRoot "target\debug\relay-native-host.exe"

$manifestContent = @{
    name = "com.opencode.chrome_relay"
    description = "OpenCode Chrome Relay Native Messaging Host"
    path = $nativeHostExe
    type = "stdio"
    allowed_origins = @(
        "chrome-extension://*/"
    )
} | ConvertTo-Json -Depth 5

Set-Content -Path $manifestPath -Value $manifestContent -Encoding UTF8
Write-Host "Wrote Native Host Manifest to: $manifestPath" -ForegroundColor Green

# Register in Windows Registry (HKCU)
$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.opencode.chrome_relay"
if (!(Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name "(Default)" -Value $manifestPath -Force
Write-Host "Registered in Windows Registry: $regPath -> $manifestPath" -ForegroundColor Green

# Configure Chrome Preferences to pin extension if possible
$chromePrefs = "C:\Users\chrom\AppData\Local\Google\Chrome\User Data\Default\Preferences"
if (Test-Path $chromePrefs) {
    try {
        $raw = Get-Content $chromePrefs -Raw -Encoding UTF8
        $json = $raw | ConvertFrom-Json
        if ($json.extensions -and $json.extensions.pinned_extensions) {
            Write-Host "Current pinned extensions in Chrome: $($json.extensions.pinned_extensions.Count)" -ForegroundColor Cyan
        }
    } catch {
        Write-Host "Could not inspect Chrome preferences: $_" -ForegroundColor Yellow
    }
}
