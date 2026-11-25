@echo off
setlocal
cd /d "%~dp0"
set "SD_PS_MODE="
if /i "%~1"=="--unattended" set "SD_PS_MODE=-Unattended"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restore-ui.ps1" %SD_PS_MODE%
set "SD_COMMAND_STATUS=%ERRORLEVEL%"
if not "%SD_COMMAND_STATUS%"=="0" echo Restore failed. Existing data has not been overwritten.
if not defined SD_PS_MODE pause
exit /b %SD_COMMAND_STATUS%
