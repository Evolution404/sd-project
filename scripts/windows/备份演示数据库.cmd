@echo off
setlocal
cd /d "%~dp0"
set "DATA_DIR=%~dp0data"
if not exist "runtime\node.exe" (
 echo Missing runtime\node.exe
 if /i not "%~1"=="--unattended" pause
 exit /b 1
)
"runtime\node.exe" "scripts\backup.mjs"
set "SD_COMMAND_STATUS=%ERRORLEVEL%"
if /i not "%~1"=="--unattended" pause
exit /b %SD_COMMAND_STATUS%
