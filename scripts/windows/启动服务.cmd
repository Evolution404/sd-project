@echo off
setlocal
cd /d "%~dp0"
set "DATA_DIR=%~dp0data"
if not exist "runtime\node.exe" (
 echo ERROR: runtime\node.exe is missing. Extract the full ZIP archive first.
 pause
 exit /b 1
)
set "HOST=0.0.0.0"
if not defined PORT set "PORT=8787"
echo SD Project local server, port %PORT%
echo Access on this PC: http://127.0.0.1:%PORT%
echo To allow LAN clients, configure Windows Firewall for TCP %PORT%.
echo Press Ctrl+C to stop.
"runtime\node.exe" "server\main.mjs"
echo Server stopped. Exit code: %ERRORLEVEL%
pause
