$port = 8080
$root = $PSScriptRoot
if (-not $root) { $root = "C:\Users\albal\Desktop\XIO\proyectos\pedidos" }

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
$listener.Start()
Write-Output "Servidor Socarratt v3 (Non-Blocking) escuchando en http://127.0.0.1:$port y Wi-Fi http://192.168.1.41:$port"

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
}

$sharedStateFile = Join-Path $root "live_state.json"
$seq = 200
$pendingClients = New-Object System.Collections.ArrayList

while ($true) {
  try {
    # 1. Aceptar todas las conexiones entrantes sin bloquear
    while ($listener.Pending()) {
      $newClient = $listener.AcceptTcpClient()
      $newClient.ReceiveTimeout = 1200
      $newClient.SendTimeout = 2000
      [void]$pendingClients.Add([PSCustomObject]@{
        Client = $newClient
        AcceptedAt = [DateTime]::UtcNow
      })
    }

    if ($pendingClients.Count -eq 0) {
      Start-Sleep -Milliseconds 15
      continue
    }

    $processedAny = $false
    for ($i = $pendingClients.Count - 1; $i -ge 0; $i--) {
      $entry = $pendingClients[$i]
      $client = $entry.Client

      if (-not $client.Connected) {
        try { $client.Close() } catch {}
        $pendingClients.RemoveAt($i)
        continue
      }

      $stream = $client.GetStream()
      if (-not $stream.DataAvailable) {
        # Si es un socket especulativo vacío de Chrome con más de 3 segundos sin enviar datos, cerrarlo
        if (([DateTime]::UtcNow - $entry.AcceptedAt).TotalSeconds -gt 3) {
          try { $client.Close() } catch {}
          $pendingClients.RemoveAt($i)
        }
        continue
      }

      # Tiene datos listos para leer ahora mismo
      $pendingClients.RemoveAt($i)
      $processedAny = $true

      try {
        $stream.ReadTimeout = 1200
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $requestLine = $reader.ReadLine()
        if (-not $requestLine) { $client.Close(); continue }

        $parts = $requestLine.Split(" ")
        $method = $parts[0]
        $rawPath = $parts[1]
        $pathOnly = ($rawPath -split "\?")[0]
        if ($pathOnly -eq "/") { $pathOnly = "/cocina.html" }

        $contentLength = 0
        while ($true) {
          $headerLine = $reader.ReadLine()
          if ([string]::IsNullOrEmpty($headerLine)) { break }
          if ($headerLine -match "(?i)^Content-Length:\s*(\d+)") {
            $contentLength = [int]$matches[1]
          }
        }

        if ($method -eq "OPTIONS") {
          $header = "HTTP/1.1 200 OK`r`nAccess-Control-Allow-Origin: *`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
          $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
          $stream.Write($headerBytes, 0, $headerBytes.Length)
          $client.Close()
          continue
        }

        if ($pathOnly -eq "/api/state") {
          if ($method -eq "POST" -and $contentLength -gt 0) {
            $buffer = New-Object char[] $contentLength
            $read = 0
            while ($read -lt $contentLength) {
              $r = $reader.Read($buffer, $read, $contentLength - $read)
              if ($r -le 0) { break }
              $read += $r
            }
            $bodyStr = -join $buffer
            try {
              $incoming = $bodyStr | ConvertFrom-Json
              $seq++

              if (Test-Path $sharedStateFile) {
                $currentRaw = Get-Content $sharedStateFile -Raw -Encoding UTF8
                $current = $currentRaw | ConvertFrom-Json
              } else {
                $current = [PSCustomObject]@{ seq = $seq; orders = @(); riders = @() }
              }

              # Parche enviado desde el móvil de un repartidor
              if ($incoming.patchRider) {
                $pr = $incoming.patchRider
                $foundRider = $false
                $newRiders = @()
                foreach ($r in $current.riders) {
                  if ($r.id -eq $pr.id) {
                    $r | Add-Member -NotePropertyName "lat" -NotePropertyValue $pr.lat -Force
                    $r | Add-Member -NotePropertyName "lng" -NotePropertyValue $pr.lng -Force
                    $r | Add-Member -NotePropertyName "gpsActive" -NotePropertyValue ([bool]$pr.gpsActive) -Force
                    $r | Add-Member -NotePropertyName "onShift" -NotePropertyValue ([bool]$pr.onShift) -Force
                    if ($pr.shiftTimeStr) {
                      $r | Add-Member -NotePropertyName "shiftTimeStr" -NotePropertyValue $pr.shiftTimeStr -Force
                    }
                    $r | Add-Member -NotePropertyName "lastGpsUpdate" -NotePropertyValue $seq -Force
                    $foundRider = $true
                  }
                  $newRiders += $r
                }
                if (-not $foundRider) {
                  $newRiders += $pr
                }
                $current.riders = $newRiders

                if ($incoming.patchOrder) {
                  $po = $incoming.patchOrder
                  $newOrders = @()
                  foreach ($o in $current.orders) {
                    if ($o.id -eq $po.id) {
                      if ($po.status) { $o | Add-Member -NotePropertyName "status" -NotePropertyValue $po.status -Force }
                      if ($null -ne $po.departedAt) { $o | Add-Member -NotePropertyName "departedAt" -NotePropertyValue $po.departedAt -Force }
                      if ($null -ne $po.deliveredToClientAt) { $o | Add-Member -NotePropertyName "deliveredToClientAt" -NotePropertyValue $po.deliveredToClientAt -Force }
                      if ($null -ne $po.returnedToStoreAt) { $o | Add-Member -NotePropertyName "returnedToStoreAt" -NotePropertyValue $po.returnedToStoreAt -Force }
                      if ($po.deliveryProof) { $o | Add-Member -NotePropertyName "deliveryProof" -NotePropertyValue $po.deliveryProof -Force }
                    }
                    $newOrders += $o
                  }
                  $current.orders = $newOrders
                }
              } else {
                # Actualización completa desde el PC: preservar GPS activo de repartidores móviles
                if ($incoming.riders) {
                  $mergedRiders = @()
                  foreach ($incR in $incoming.riders) {
                    $existingR = $current.riders | Where-Object { $_.id -eq $incR.id } | Select-Object -First 1
                    if ($existingR -and ($existingR.gpsActive -or $existingR.onShift) -and (-not $incR.forceResetGps)) {
                      $incR | Add-Member -NotePropertyName "lat" -NotePropertyValue $existingR.lat -Force
                      $incR | Add-Member -NotePropertyName "lng" -NotePropertyValue $existingR.lng -Force
                      $incR | Add-Member -NotePropertyName "gpsActive" -NotePropertyValue ([bool]$existingR.gpsActive) -Force
                      $incR | Add-Member -NotePropertyName "onShift" -NotePropertyValue ([bool]$existingR.onShift) -Force
                      if ($existingR.shiftTimeStr) {
                        $incR | Add-Member -NotePropertyName "shiftTimeStr" -NotePropertyValue $existingR.shiftTimeStr -Force
                      }
                    }
                    $mergedRiders += $incR
                  }
                  $current.riders = $mergedRiders
                }
                if ($null -ne $incoming.orders) {
                  $current.orders = $incoming.orders
                }
              }

              $current | Add-Member -NotePropertyName "seq" -NotePropertyValue $seq -Force
              $savedJson = $current | ConvertTo-Json -Depth 10 -Compress
              [System.IO.File]::WriteAllText($sharedStateFile, $savedJson, [System.Text.Encoding]::UTF8)
              $respBytes = [System.Text.Encoding]::UTF8.GetBytes($savedJson)
            } catch {
              $respBytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false}')
            }
          } else {
            if (Test-Path $sharedStateFile) {
              $respBytes = [System.IO.File]::ReadAllBytes($sharedStateFile)
            } else {
              $respBytes = [System.IO.File]::ReadAllBytes((Join-Path $root "live_state.json"))
            }
          }
          $header = "HTTP/1.1 200 OK`r`nContent-Type: application/json; charset=utf-8`r`nAccess-Control-Allow-Origin: *`r`nCache-Control: no-cache`r`nContent-Length: $($respBytes.Length)`r`nConnection: close`r`n`r`n"
          $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
          $stream.Write($headerBytes, 0, $headerBytes.Length)
          $stream.Write($respBytes, 0, $respBytes.Length)
          $client.Close()
          continue
        }

        $localPath = Join-Path $root ($pathOnly.TrimStart('/').Replace('/', '\'))
        if (Test-Path $localPath -PathType Leaf) {
          $ext = [System.IO.Path]::GetExtension($localPath).ToLower()
          $mime = $mimeTypes[$ext]
          if (-not $mime) { $mime = "application/octet-stream" }
          $fileBytes = [System.IO.File]::ReadAllBytes($localPath)
          $header = "HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nAccess-Control-Allow-Origin: *`r`nCache-Control: no-cache`r`nContent-Length: $($fileBytes.Length)`r`nConnection: close`r`n`r`n"
          $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
          $stream.Write($headerBytes, 0, $headerBytes.Length)
          $stream.Write($fileBytes, 0, $fileBytes.Length)
        } else {
          $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
          $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: $($notFound.Length)`r`nConnection: close`r`n`r`n"
          $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
          $stream.Write($headerBytes, 0, $headerBytes.Length)
          $stream.Write($notFound, 0, $notFound.Length)
        }
        $client.Close()
      } catch {
        try { $client.Close() } catch {}
      }
    }

    if (-not $processedAny) {
      Start-Sleep -Milliseconds 15
    }
  } catch {
    Start-Sleep -Milliseconds 20
  }
}
