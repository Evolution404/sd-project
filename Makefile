# sd_project local development, verification and isolated release commands.
# Running make without a target only displays help; it does not build or start anything.
.DEFAULT_GOAL := help

.PHONY: help dev demo build test check check-schema test-browser test-performance \
        package-win package-win-demo test-package test-package-demo

DATA_DIR ?= $(CURDIR)/data
HOST ?= 127.0.0.1
PORT ?= 8787

help:
	@printf '%s\n' \
	  '项目全流程管理 — 开发与打包命令' \
	  '' \
	  '  make help                 显示本帮助（默认）' \
	  '  make dev                  编译并启动开发服务' \
	  '  make demo                 启动本机演示环境' \
	  '  make build                编译前后端' \
	  '  make check                运行完整工程检查' \
	  '  make check-schema         验证数据库结构及数据字典' \
	  '  make test                 运行工程测试' \
	  '  make test-browser         运行浏览器回归' \
	  '  make test-performance     运行性能回归' \
	  '' \
	  '  make package-win          打包正式 Windows 离线版（不含数据）' \
	  '  make package-win-demo     一键打包并验证 Windows 内网演示版' \
	  '  make test-package         验证正式 Windows 发布包' \
	  '  make test-package-demo    验证 Windows 演示包' \
	  '' \
	  '  演示 ZIP：dist/sd-project-win10-x64-demo.zip' \
	  '  正式 ZIP：dist/sd-project-win10-x64.zip' \
	  '  演示包包含虚构测试数据、管理员账号和随机密码，仅适用于可信内网。'

dev: build
	@DATA_DIR="$(DATA_DIR)" HOST="$(HOST)" PORT="$(PORT)" node dist/server/main.js

demo:
	@npm run demo

build:
	@npm run build

test:
	@npm test

check:
	@npm run check

check-schema:
	@npm run check:schema

test-browser:
	@npm run test:browser

test-performance:
	@npm run test:performance

package-win:
	@npm run package:win

package-win-demo:
	@npm run package:win:demo
	@npm run test:package:demo

test-package:
	@npm run test:package

test-package-demo:
	@npm run test:package:demo
