# Captures the primary screen to a PNG. Used to verify the desktop pet window during development.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\capture-screen.ps1 [outputPath]
param(
  [string]$OutPath = "$env:TEMP\vinepalmapet-screen.png"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Without this, CopyFromScreen captures logical pixels and crops the image on high-DPI screens.
Add-Type @'
using System.Runtime.InteropServices;
public static class DpiNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[DpiNative]::SetProcessDPIAware() | Out-Null

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

try {
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output $OutPath
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
