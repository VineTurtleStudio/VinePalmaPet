param(
  [Parameter(Mandatory = $true)]
  [string]$Source,
  [string]$Output
)

# Packs a pet pack / plugin folder into a zip whose contents live at the root,
# which is what the importer expects. Works for both pet.json and plugin.json.

$ErrorActionPreference = 'Stop'

$src = (Resolve-Path -LiteralPath $Source).Path
if (-not (Test-Path -LiteralPath $src -PathType Container)) {
  throw "Not a folder: $src"
}

if (-not $Output) {
  $Output = Join-Path (Get-Location) ((Split-Path -Path $src -Leaf) + '.zip')
}
$out = [System.IO.Path]::GetFullPath($Output)

if (-not (Test-Path -LiteralPath (Split-Path -Path $out -Parent))) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Path $out -Parent) | Out-Null
}
if (Test-Path -LiteralPath $out) {
  Remove-Item -LiteralPath $out -Force
}

Compress-Archive -Path (Join-Path $src '*') -DestinationPath $out -CompressionLevel Optimal
Write-Host ("wrote {0} ({1:N0} bytes)" -f $out, (Get-Item -LiteralPath $out).Length)
