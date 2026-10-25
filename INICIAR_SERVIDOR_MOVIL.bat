@echo off
title Panel Cocina y Radar GPS - Socarratt Madrid
echo =========================================================
echo   ARRANCANDO SISTEMA SOCARRATT (COCINA + GPS REPARTIDORES)
echo =========================================================
echo.
echo 1. Cerrando sesiones anteriores si estaban abiertas...
taskkill /F /IM cloudflared.exe >nul 2>&1
echo 2. Iniciando Servidor Local de Cocina (Puerto 8080)...
start "Servidor Local Socarratt (NO CERRAR)" powershell -ExecutionPolicy Bypass -File "%~dp0servidor-socarratt.ps1"
timeout /t 2 >nul
echo 3. Creando Tunel Seguro HTTPS Cloudflare para los Moviles...
start "Tunel HTTPS Movil Cloudflare (NO CERRAR)" powershell -ExecutionPolicy Bypass -File "%~dp0iniciar-tunel.ps1"
timeout /t 4 >nul
echo 4. Abriendo el Tablon de Cocina en el navegador...
start http://127.0.0.1:8080/cocina.html
echo.
echo =========================================================
echo   LISTO! Deja las 2 ventanas negras minimizadas durante
echo   todo el servicio de 13:00 a 16:30.
echo =========================================================
timeout /t 5 >nul
