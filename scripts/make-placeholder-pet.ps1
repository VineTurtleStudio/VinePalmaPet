# Generates the placeholder "Vine" pet pack atlases (PNG) used until real 2D art is ready.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\make-placeholder-pet.ps1
Add-Type -AssemblyName System.Drawing

$OutDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\public\pets\vine'))
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Size = 256

function Color([string]$hex) {
  return [System.Drawing.ColorTranslator]::FromHtml($hex)
}

function New-Pen([string]$hex, [float]$width) {
  $pen = New-Object System.Drawing.Pen((Color $hex), $width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  return $pen
}

function Draw-Leaves($g, [float]$sway) {
  $dark = New-Pen '#3E6B39' 12
  $light = New-Pen '#7CC469' 7
  $mid = New-Pen '#5FA84F' 9

  $fronds = @(
    @(128, 118, 104, 96, 78, 74, 54, 46),
    @(128, 118, 120, 84, 108, 60, 96, 26),
    @(128, 118, 130, 82, 140, 56, 142, 22),
    @(128, 118, 140, 92, 162, 72, 184, 52),
    @(128, 118, 148, 100, 174, 92, 200, 84)
  )

  for ($i = 0; $i -lt $fronds.Count; $i++) {
    $f = $fronds[$i]
    $dx = $sway * (1.0 + $i * 0.18)
    $g.DrawBezier($dark, $f[0], $f[1], ($f[2] + $dx), $f[3], ($f[4] + $dx * 1.6), $f[5], ($f[6] + $dx * 2.2), ($f[7] + [Math]::Abs($dx) * 0.4))
    $g.DrawBezier($light, $f[0], $f[1], ($f[2] + $dx), $f[3], ($f[4] + $dx * 1.6), $f[5], ($f[6] + $dx * 2.2), ($f[7] + [Math]::Abs($dx) * 0.4))
  }

  # stem
  $g.DrawBezier($dark, 128, 130, 126, 122, 127, 116, 128, 112)
  $g.DrawBezier($mid, 128, 130, 126, 122, 127, 116, 128, 112)

  $dark.Dispose(); $light.Dispose(); $mid.Dispose()
}

function Draw-Face($g, [string]$eyes, [string]$mouth, [bool]$blush) {
  $ink = New-Pen '#2E3B2A' 3.2
  $eyeBrush = New-Object System.Drawing.SolidBrush((Color '#2E3B2A'))
  $white = New-Object System.Drawing.SolidBrush((Color '#FFFFFF'))
  $cheek = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(110, 255, 138, 150))

  $eyeY = 172
  if ($eyes -eq 'open') {
    foreach ($cx in @(107, 149)) {
      $g.FillEllipse($eyeBrush, ($cx - 8), ($eyeY - 9), 16, 19)
      $g.FillEllipse($white, ($cx - 4), ($eyeY - 6), 5, 6)
    }
  } elseif ($eyes -eq 'closed') {
    foreach ($cx in @(107, 149)) {
      $g.DrawArc($ink, ($cx - 9), ($eyeY - 8), 18, 12, 20, 140)
    }
  } elseif ($eyes -eq 'happy') {
    foreach ($cx in @(107, 149)) {
      $g.DrawArc($ink, ($cx - 9), ($eyeY - 4), 18, 14, 200, 140)
    }
  } elseif ($eyes -eq 'focus') {
    foreach ($cx in @(107, 149)) {
      $g.FillEllipse($eyeBrush, ($cx - 8), ($eyeY - 3), 16, 8)
    }
  }

  if ($blush) {
    $g.FillEllipse($cheek, 82, 186, 22, 12)
    $g.FillEllipse($cheek, 152, 186, 22, 12)
  }

  if ($mouth -eq 'smile') {
    $g.DrawArc($ink, 119, 188, 18, 11, 15, 150)
  } elseif ($mouth -eq 'open') {
    $mouthBrush = New-Object System.Drawing.SolidBrush((Color '#7A3B3B'))
    $tongue = New-Object System.Drawing.SolidBrush((Color '#F08A96'))
    $g.FillEllipse($mouthBrush, 117, 190, 22, 16)
    $g.FillEllipse($tongue, 122, 199, 12, 6)
    $mouthBrush.Dispose(); $tongue.Dispose()
  } elseif ($mouth -eq 'flat') {
    $g.DrawLine($ink, 120, 194, 136, 194)
  } elseif ($mouth -eq 'talk') {
    $mouthBrush = New-Object System.Drawing.SolidBrush((Color '#7A3B3B'))
    $g.FillEllipse($mouthBrush, 122, 191, 13, 9)
    $mouthBrush.Dispose()
  }

  $ink.Dispose(); $eyeBrush.Dispose(); $white.Dispose(); $cheek.Dispose()
}

function Draw-Zzz($g, [float]$phase) {
  $font = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
  for ($i = 0; $i -lt 3; $i++) {
    $alpha = [int]([Math]::Max(0, 220 - (($phase + $i * 0.34) % 1.0) * 220))
    $y = 92 - $i * 26 - (($phase * 18) % 18)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, 70, 110, 90))
    $g.DrawString('Z', $font, $brush, (176 + $i * 12), $y)
    $brush.Dispose()
  }
  $font.Dispose()
}

function Draw-Sparkles($g, [float]$phase) {
  $pen = New-Pen '#FFD766' 3
  $spots = @(@(52, 92, 7), @(198, 120, 6), @(74, 54, 5), @(182, 62, 8))
  for ($i = 0; $i -lt $spots.Count; $i++) {
    $s = $spots[$i]
    $pulse = 0.6 + 0.4 * [Math]::Sin(($phase * 2 * [Math]::PI) + $i)
    $r = $s[2] * $pulse
    $g.DrawLine($pen, $s[0] - $r, $s[1], $s[0] + $r, $s[1])
    $g.DrawLine($pen, $s[0], $s[1] - $r, $s[0], $s[1] + $r)
  }
  $pen.Dispose()
}

function Draw-Character($g, $opts) {
  $squashX = [float]$opts.SquashX
  $squashY = [float]$opts.SquashY
  $offsetY = [float]$opts.OffsetY

  $state = $g.Save()
  $g.TranslateTransform(128, 238)
  $g.ScaleTransform($squashX, $squashY)
  $g.TranslateTransform(-128, -238)
  $g.TranslateTransform(0, $offsetY)

  # ground shadow
  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(36, 40, 70, 40))
  $g.FillEllipse($shadow, 72, 226, 112, 16)
  $shadow.Dispose()

  Draw-Leaves $g ([float]$opts.Sway)

  $outline = New-Pen '#3E6B39' 3.4
  $body = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(60, 110, 136, 128)),
    (Color '#D6F5C4'), (Color '#8FD07F'), 90.0)
  $belly = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 255, 255, 240))

  # arms
  $g.FillEllipse($body, 56, 176, 26, 20)
  $g.FillEllipse($body, 174, 176, 26, 20)
  $g.DrawEllipse($outline, 56, 176, 26, 20)
  $g.DrawEllipse($outline, 174, 176, 26, 20)

  # feet
  $g.FillEllipse($body, 88, 218, 34, 20)
  $g.FillEllipse($body, 134, 218, 34, 20)
  $g.DrawEllipse($outline, 88, 218, 34, 20)
  $g.DrawEllipse($outline, 134, 218, 34, 20)

  # body
  $g.FillEllipse($body, 66, 118, 124, 108)
  $g.DrawEllipse($outline, 66, 118, 124, 108)
  $g.FillEllipse($belly, 92, 150, 72, 58)

  Draw-Face $g $opts.Eyes $opts.Mouth ([bool]$opts.Blush)

  if ($opts.Zzz) { Draw-Zzz $g ([float]$opts.ZzzPhase) }
  if ($opts.Sparkle) { Draw-Sparkles $g ([float]$opts.SparklePhase) }

  $g.Restore($state)
  $outline.Dispose(); $body.Dispose(); $belly.Dispose()
}

function Render-Atlas([string]$name, $frames) {
  $count = $frames.Count
  $bmp = New-Object System.Drawing.Bitmap(($Size * $count), $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  for ($i = 0; $i -lt $count; $i++) {
    $state = $g.Save()
    $g.TranslateTransform($i * $Size, 0)
    Draw-Character $g $frames[$i]
    $g.Restore($state)
  }

  $path = Join-Path $OutDir "$name.png"
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host ("wrote {0} ({1}x{2})" -f $path, ($Size * $count), $Size)
}

# --- idle: gentle breathing ------------------------------------------------
$idle = @()
for ($i = 0; $i -lt 8; $i++) {
  $t = $i / 8.0
  $breathe = [Math]::Sin($t * 2 * [Math]::PI)
  $idle += @{
    SquashX = 1.0 - $breathe * 0.012
    SquashY = 1.0 + $breathe * 0.022
    OffsetY = -[Math]::Abs($breathe) * 1.4
    Sway = $breathe * 1.6
    Eyes = 'open'; Mouth = 'smile'; Blush = $true
  }
}
Render-Atlas 'idle' $idle

# --- blink -----------------------------------------------------------------
$blink = @(
  @{ SquashX = 1.0; SquashY = 1.0; OffsetY = 0; Sway = 0.4; Eyes = 'open';   Mouth = 'smile'; Blush = $true },
  @{ SquashX = 1.0; SquashY = 1.0; OffsetY = 0; Sway = 0.2; Eyes = 'closed'; Mouth = 'smile'; Blush = $true },
  @{ SquashX = 1.0; SquashY = 1.0; OffsetY = 0; Sway = 0.0; Eyes = 'closed'; Mouth = 'smile'; Blush = $true },
  @{ SquashX = 1.0; SquashY = 1.0; OffsetY = 0; Sway = 0.3; Eyes = 'open';   Mouth = 'smile'; Blush = $true }
)
Render-Atlas 'blink' $blink

# --- happy: hop + sparkles -------------------------------------------------
$happy = @()
for ($i = 0; $i -lt 12; $i++) {
  $t = $i / 12.0
  $hop = [Math]::Sin($t * 2 * [Math]::PI)
  $air = [Math]::Max(0, $hop)
  $happy += @{
    SquashX = 1.0 + $air * 0.05
    SquashY = 1.0 - $air * 0.07
    OffsetY = -$air * 16
    Sway = $hop * 5.0
    Eyes = 'happy'; Mouth = 'open'; Blush = $true
    Sparkle = $true; SparklePhase = $t
  }
}
Render-Atlas 'happy' $happy

# --- focus: determined eyes, still body ------------------------------------
$focus = @()
for ($i = 0; $i -lt 6; $i++) {
  $t = $i / 6.0
  $breathe = [Math]::Sin($t * 2 * [Math]::PI)
  $focus += @{
    SquashX = 1.0; SquashY = 1.0 + $breathe * 0.012; OffsetY = 0
    Sway = $breathe * 0.8
    Eyes = 'focus'; Mouth = 'flat'; Blush = $false
  }
}
Render-Atlas 'focus' $focus

# --- sleep -----------------------------------------------------------------
$sleep = @()
for ($i = 0; $i -lt 8; $i++) {
  $t = $i / 8.0
  $breathe = [Math]::Sin($t * 2 * [Math]::PI)
  $sleep += @{
    SquashX = 1.0 + $breathe * 0.02
    SquashY = 1.0 + $breathe * 0.03
    OffsetY = [Math]::Abs($breathe) * 2.0
    Sway = $breathe * 1.0
    Eyes = 'closed'; Mouth = 'smile'; Blush = $true
    Zzz = $true; ZzzPhase = $t
  }
}
Render-Atlas 'sleep' $sleep

# --- talk ------------------------------------------------------------------
$talk = @()
for ($i = 0; $i -lt 6; $i++) {
  $talk += @{
    SquashX = 1.0; SquashY = 1.0; OffsetY = 0; Sway = [Math]::Sin($i) * 1.2
    Eyes = 'open'
    Mouth = $(if ($i % 2 -eq 0) { 'open' } else { 'talk' })
    Blush = $true
  }
}
Render-Atlas 'talk' $talk

Write-Host 'placeholder pet pack generated.'
