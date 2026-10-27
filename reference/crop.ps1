param(
  [string]$In,
  [string]$Out,
  [int]$X=0,
  [int]$Y=0,
  [int]$W=0,
  [int]$H=0,
  [double]$Scale=1.0
)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($In)
if($W -le 0){ $W = $src.Width - $X }
if($H -le 0){ $H = $src.Height - $Y }
$crop = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($crop)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0,0,$W,$H)), (New-Object System.Drawing.Rectangle($X,$Y,$W,$H)), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
if($Scale -ne 1.0){
  $sw=[int]($W*$Scale); $sh=[int]($H*$Scale)
  $scaled = New-Object System.Drawing.Bitmap($sw,$sh)
  $g2=[System.Drawing.Graphics]::FromImage($scaled)
  $g2.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g2.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g2.DrawImage($crop,0,0,$sw,$sh)
  $g2.Dispose(); $crop.Dispose(); $crop=$scaled
}
$crop.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose(); $src.Dispose()
Write-Output "Saved $Out"
