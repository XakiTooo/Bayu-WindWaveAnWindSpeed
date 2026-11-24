@echo off
title Matikan BAYU IoT Dashboard
color 0E
cd /d "%~dp0"

echo =====================================================================
echo    MENGHENTIKAN SERVER BAYU IoT DASHBOARD & LIVE INSPECTOR
echo =====================================================================
echo.

setlocal enabledelayedexpansion
set KILLED=0

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>nul
    if !errorlevel! equ 0 (
        echo [OK] Menghentikan Dashboard Web di port 3000 (PID: %%a)
        set KILLED=1
    )
)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>nul
    if !errorlevel! equ 0 (
        echo [OK] Menghentikan Live Inspector di port 3001 (PID: %%a)
        set KILLED=1
    )
)

echo.
if "%KILLED%"=="1" (
    color 0A
    echo [SUKSES] Semua service port 3000 dan 3001 berhasil dimatikan dengan bersih.
) else (
    echo [INFO] Tidak ada service port 3000 atau 3001 yang sedang berjalan.
)

echo.
pause
