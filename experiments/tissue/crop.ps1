# Crop a screenshot around a box (CSS px = image px at dpr 1), with a margin, optionally enlarged; saves a PNG, or a JPEG
# (quality 88) when the output name ends in .jpg (much smaller: the dark rippled background makes PNGs large).
#   powershell -File experiments/tissue/crop.ps1 in.png out.png x0 y0 x1 y1 [margin=40] [scale=1] [min=240]
param([string]$In, [string]$Out, [double]$X0, [double]$Y0, [double]$X1, [double]$Y1,
      [double]$Margin = 40, [double]$Scale = 1, [double]$Min = 240)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile((Resolve-Path $In))
try {
  $cx = ($X0 + $X1) / 2; $cy = ($Y0 + $Y1) / 2
  $w = [Math]::Max($Min, $X1 - $X0 + 2 * $Margin); $h = [Math]::Max($Min, $Y1 - $Y0 + 2 * $Margin)
  $s = [Math]::Max($w, $h)   # square crops
  $w = [Math]::Min($s, $img.Width); $h = [Math]::Min($s, $img.Height)
  [int]$x = [Math]::Max(0, [Math]::Min($img.Width - $w, $cx - $w / 2))
  [int]$y = [Math]::Max(0, [Math]::Min($img.Height - $h, $cy - $h / 2))
  [int]$ow = $w * $Scale; [int]$oh = $h * $Scale; [int]$iw = $w; [int]$ih = $h
  $bmp = New-Object System.Drawing.Bitmap $ow, $oh, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $ow, $oh), (New-Object System.Drawing.Rectangle $x, $y, $iw, $ih), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  if ($Out -match '\.jpe?g$') {
    $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ps = New-Object System.Drawing.Imaging.EncoderParameters 1
    $ps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]88)
    $bmp.Save($Out, $enc, $ps)
  } else { $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose()
} finally { $img.Dispose() }
