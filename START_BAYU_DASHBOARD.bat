@echo off
title BAYU IoT - Wind Speed & Direction System
color 0B
cd /d "%~dp0"

echo =====================================================================
echo    SISTEM TELEMETRI ANGIN BAYU & AEROSENSE ALERT SYSTEM
echo    Kelompok Okta Resistor / Kelompok 53 UPN "Veteran" Yogyakarta
echo =====================================================================
echo.

REM 1. Cek instalasi Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js tidak ditemukan di komputer ini!
    echo Silakan install Node.js terlebih dahulu dari https://nodejs.org/
    pause
    exit /b 1
)

REM 2. Cek dependensi node_modules
if not exist "node_modules\" (
    echo [INFO] Folder node_modules belum ada. Menginstall paket library...
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo [ERROR] Gagal menginstall dependensi npm!
        pause
        exit /b 1
    )
)

REM 3. Mode akun dummy hanya berjalan lewat next dev.
set "DASHBOARD_SCRIPT=start"
if exist ".env.local" (
    findstr /B /C:"BAYU_LOCAL_AUTH=1" ".env.local" >nul 2>nul
    if not errorlevel 1 set "DASHBOARD_SCRIPT=dev"
)

REM 4. Cek hasil build Next.js jika menjalankan mode produksi.
if "%DASHBOARD_SCRIPT%"=="start" if not exist ".next\" (
    echo [INFO] Menyiapkan dan mengompilasi build dashboard Next.js...
    call npm run build
    if %errorlevel% neq 0 (
        color 0C
        echo [ERROR] Build Next.js gagal!
        pause
        exit /b 1
    )
)

REM 5. Bersihkan port 3000 dan 3001 jika masih ada proses lama yang menggantung
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>nul
)

echo.
echo [1/2] Menjalankan Web Dashboard pada Port 3000...
start "BAYU - Web Dashboard (Port 3000)" cmd /k "cd /d %~dp0 && npm run %DASHBOARD_SCRIPT%"

echo [2/2] Menjalankan Standalone Live Telemetry Inspector pada Port 3001...
start "BAYU - Live Telemetry Inspector (Port 3001)" cmd /k "cd /d %~dp0 && node tools/live-monitor.mjs"

echo.
echo Menunggu server siap...
timeout /t 3 /nobreak >nul

echo Buka browser Anda secara manual ke alamat di bawah.

echo.
echo =====================================================================
echo  [SUKSES] Sistem Monitoring Aktif!
echo  - Dashboard Utama   : http://localhost:3000
echo  - Live Inspector    : http://localhost:3001
echo.
echo  Biarkan jendela terminal yang terbuka tetap berjalan.
echo  Untuk mematikan sistem, jalankan STOP_BAYU_DASHBOARD.bat
echo =====================================================================
echo.
pause
