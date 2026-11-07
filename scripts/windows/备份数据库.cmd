@echo off
setlocal
cd /d "%~dp0"
set "DATA_DIR=%~dp0data"
if not exist "runtime\node.exe" (
 echo Missing runtime\node.exe
 pause
 exit /b 1
)
"runtime\node.exe" "scripts\backup.mjs"
pause
