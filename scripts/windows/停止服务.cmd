@echo off
setlocal
cd /d "%~dp0"
set "SD_PS_MODE="
if /i "%~1"=="--unattended" set "SD_PS_MODE=-Unattended"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dataset-ui.ps1" -Action Stop %SD_PS_MODE%
set "SD_COMMAND_STATUS=%ERRORLEVEL%"
if not defined SD_PS_MODE pause
exit /b %SD_COMMAND_STATUS%
