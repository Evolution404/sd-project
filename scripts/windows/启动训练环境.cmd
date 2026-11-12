@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo 缺少 Windows Node 运行时，请确认已解压完整离线包。
  pause
  exit /b 1
)
echo 独立训练环境仅在本机启动，每个实例使用不同 DATA_DIR。
echo 首次运行会要求设置独立管理员口令；训练数据不会写入正式数据库。
"runtime\node.exe" "scripts\training\instance.mjs" start-new --port=8791
if errorlevel 1 pause
