@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo Missing Windows Node runtime. Extract the complete offline package.
  pause
  exit /b 1
)
echo Training is available on this computer only. Each instance uses its own data directory.
echo Setup prompts for a separate administrator password. Training data is isolated.
"runtime\node.exe" "scripts\training\instance.mjs" start-new --port=8791
if errorlevel 1 pause
