@echo off
setlocal
cd /d "%~dp0"
"runtime\node.exe" "scripts\training\instance.mjs" list
pause
