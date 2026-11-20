@echo off
cd /d "%~dp0"
echo Запуск сайта "Волнуй"...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 (
  echo.
  echo Сервер не запустился. Подробности находятся в открытом окне PowerShell.
  pause
)