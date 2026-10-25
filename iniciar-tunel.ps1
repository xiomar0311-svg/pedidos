$ErrorActionPreference = "Continue"
$dir1 = "C:\Users\albal\Desktop\XIO\proyectos\pedidos"
$dir2 = "C:\Users\albal\Desktop\XIO\UNI\pedidos-paellas"
$cf = "$dir1\cloudflared.exe"

function Update-TunnelUrl($newUrl) {
  Write-Host ""
  Write-Host "==========================================================" -ForegroundColor Green
  Write-Host "  ENLACE MOVIL ACTIVO: $newUrl/repartidor.html" -ForegroundColor Green
  Write-Host "  (El codigo QR de Cocina ya se ha actualizado solo)" -ForegroundColor Cyan
  Write-Host "==========================================================" -ForegroundColor Green
  Write-Host ""
  $jsContent = "window.SOCARRATT_TUNNEL_URL = '$newUrl';"
  [System.IO.File]::WriteAllText("$dir1\tunnel.js", $jsContent, [System.Text.Encoding]::UTF8)
  if (Test-Path $dir2) {
    [System.IO.File]::WriteAllText("$dir2\tunnel.js", $jsContent, [System.Text.Encoding]::UTF8)
  }
}

while ($true) {
  & $cf tunnel --url http://127.0.0.1:8080 --no-autoupdate 2>&1 | ForEach-Object {
    $line = $_.ToString()
    Write-Host $line
    if ($line -match "(https://[a-z0-9-]+\.trycloudflare\.com)") {
      Update-TunnelUrl $Matches[1]
    }
  }
  Write-Host "Reconectando tunel Cloudflare en 2 segundos..." -ForegroundColor Yellow
  Start-Sleep -Seconds 2
}
