# Compila LanAtlas.exe (llançador de Windows) a l'arrel del projecte amb el compilador de C# que porta Windows
# (.NET Framework 4). No cal instal·lar res. Ús:  powershell -ExecutionPolicy Bypass -File scripts\build-launcher.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'No es troba csc.exe (.NET Framework 4).' }

# Icona: quadrat verd blavós amb tres nodes connectats (com el favicon).
Add-Type -AssemblyName System.Drawing
$icon = Join-Path $env:TEMP 'lanatlas.ico'
$sizes = 16, 32, 48, 256
$images = foreach ($size in $sizes) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $size / 32.0
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 8 * $k
  $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90); $path.AddArc($size - 2 * $r - 1, 0, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($size - 2 * $r - 1, $size - 2 * $r - 1, 2 * $r, 2 * $r, 0, 90); $path.AddArc(0, $size - 2 * $r - 1, 2 * $r, 2 * $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(14, 124, 134))), $path)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([Math]::Max(1, 2 * $k))
  $g.DrawLine($pen, 16 * $k, 12 * $k, 16 * $k, 17 * $k); $g.DrawLine($pen, 16 * $k, 17 * $k, 9 * $k, 21 * $k); $g.DrawLine($pen, 16 * $k, 17 * $k, 23 * $k, 21 * $k)
  foreach ($p in @(@(16, 9), @(8, 23), @(24, 23))) { $g.FillEllipse([System.Drawing.Brushes]::White, ($p[0] - 3) * $k, ($p[1] - 3) * $k, 6 * $k, 6 * $k) }
  $g.Dispose()
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  , $stream.ToArray()
}
# Fitxer .ico amb les imatges PNG.
$out = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $out
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $writer.Write([byte]$s); $writer.Write([byte]$s); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([UInt16]1); $writer.Write([UInt16]32); $writer.Write([UInt32]$images[$i].Length); $writer.Write([UInt32]$offset)
  $offset += $images[$i].Length
}
foreach ($bytes in $images) { $writer.Write($bytes) }
[IO.File]::WriteAllBytes($icon, $out.ToArray())

& $csc /nologo /target:winexe /optimize+ "/win32icon:$icon" /reference:System.Windows.Forms.dll "/out:$(Join-Path $root 'LanAtlas.exe')" (Join-Path $PSScriptRoot 'launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'No s''ha pogut compilar LanAtlas.exe' }
Remove-Item $icon -ErrorAction SilentlyContinue
Write-Host "Fet: $(Join-Path $root 'LanAtlas.exe')"
