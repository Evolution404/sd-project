#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export DATA_DIR="$ROOT/.local-test-data"
export HOST="0.0.0.0"
export PORT="8787"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装 Node.js 24 或以上版本。"
  read -r -p "按回车退出..." _pause
  exit 1
fi
if [ ! -f dist/index.html ]; then
  echo "前端未构建，正在尝试构建。"
  npm run build
fi
echo "输电项目管理 - 本地测试服务"
echo "本机访问：http://127.0.0.1:8787"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [ -n "$LAN_IP" ]; then echo "局域网访问：http://$LAN_IP:8787（需在系统管理中授权客户端 IP）"; fi
echo "测试数据：$DATA_DIR"
echo "首次登录前请执行「初始化本地测试管理员.command」。"
echo "保持此终端窗口打开，Ctrl+C 停止服务。"
echo
exec node server/server.mjs
