# LanAtlas: engegada ràpida a Windows (LanAtlas.cmd o LanAtlas.exe l'executen).
#  1. Comprova Node.js (>= 20.12).
#  2. El primer cop (o després d'actualitzar) instal·la i compila.
#  3. Si ja està en marxa, només obre el navegador; si no, l'engega en una finestra minimitzada i l'obre.
# Aturar-lo: tancar la finestra «LanAtlas - servidor».
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Configuració: .env de l'arrel (HOST, PORT, DATA_DIR…); per defecte 127.0.0.1:8080 i dades a .\data
$port = 8080
$hostName = '127.0.0.1'
if (Test-Path "$root\.env") {
  foreach ($line in Get-Content "$root\.env") {
    if ($line -match '^\s*PORT\s*=\s*(\d+)') { $port = [int]$Matches[1] }
    if ($line -match '^\s*HOST\s*=\s*(\S+)') { $hostName = $Matches[1] }
  }
}
if (-not $env:DATA_DIR) { $env:DATA_DIR = Join-Path $root 'data' }
$browseHost = if ($hostName -eq '0.0.0.0') { '127.0.0.1' } else { $hostName }
$url = "http://${browseHost}:$port/"

function Show-Error($message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, 'LanAtlas', 'OK', 'Error') | Out-Null
  exit 1
}

function Test-Running {
  try {
    $response = Invoke-WebRequest "${url}api/equipment/state" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch { return $false }
}

if (Test-Running) {
  if (-not $NoBrowser) { Start-Process $url }
  exit 0
}

# Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Show-Error "Cal Node.js 20.12 o més nou.`n`nDescarrega'l de https://nodejs.org (versió LTS), instal·la'l i torna a obrir LanAtlas." }
$version = (& node -v).TrimStart('v').Split('.')
if ([int]$version[0] -lt 20 -or ([int]$version[0] -eq 20 -and [int]$version[1] -lt 12)) {
  Show-Error "Tens Node.js $((& node -v)). Cal la 20.12 o més nova: https://nodejs.org"
}

# Instal·lar i compilar si cal (el segell guarda la versió compilada).
$stamp = Join-Path $root 'node_modules\.lanatlas-build'
$revision = ''
if (Test-Path "$root\.git") { try { $revision = (& git -C $root rev-parse HEAD 2>$null) } catch { } }
if (-not $revision) { $revision = (Get-Item "$root\package-lock.json").LastWriteTimeUtc.Ticks.ToString() }
$built = (Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $revision) -and (Test-Path "$root\server\dist\main.js") -and (Test-Path "$root\web\dist\index.html")

if (-not $built) {
  Write-Host 'LanAtlas: preparant-ho (el primer cop triga uns minuts)...' -ForegroundColor Cyan
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Show-Error 'No s''ha pogut instal·lar (npm install). Mira la finestra per veure l''error.' }
  & npm run build
  if ($LASTEXITCODE -ne 0) { Show-Error 'No s''ha pogut compilar (npm run build). Mira la finestra per veure l''error.' }
  Set-Content -Path $stamp -Value $revision
}

# Servidor en una finestra minimitzada (tancar-la l'atura).
$command = "`$Host.UI.RawUI.WindowTitle = 'LanAtlas - servidor (tanca per aturar)'; `$env:DATA_DIR = '$($env:DATA_DIR)'; Set-Location '$root\server'; node dist/main.js"
Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', $command -WindowStyle Minimized

for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Running) {
    if (-not $NoBrowser) { Start-Process $url }
    exit 0
  }
}
Show-Error "LanAtlas no ha arrencat en 30 segons. Obre la finestra «LanAtlas - servidor» (a la barra de tasques) per veure l'error."
