#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export DATA_DIR="$ROOT/.local-test-data"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装 Node.js 24 或以上版本。"
  read -r -p "按回车退出..." _pause
  exit 1
fi
echo "输电项目管理 - 本地测试账号初始化"
echo "此操作仅创建第一个管理员；不会覆盖现有账号。"
read -r -p "管理员用户名（直接回车为 admin）: " username
username="${username:-admin}"
read -r -s -p "设置管理员密码: " password
echo
read -r -s -p "再次输入管理员密码: " verify
echo
if [ "$password" != "$verify" ]; then
  echo "两次密码不一致。"
  unset password verify
  read -r -p "按回车退出..." _pause
  exit 1
fi
export SD_ADMIN_USER="$username"
export SD_ADMIN_PASSWORD="$password"
unset password verify
node scripts/init-admin.mjs
code=$?
unset SD_ADMIN_USER SD_ADMIN_PASSWORD
echo
if [ "$code" -eq 0 ]; then
  echo "初始化成功。接下来打开 http://127.0.0.1:8787 登录。"
else
  echo "初始化未完成，请查看上面的提示。"
fi
read -r -p "按回车退出..." _pause
exit "$code"
