# sd_project local development, verification and isolated release commands.
# Running make without a target only displays help; it does not build or start anything.
.DEFAULT_GOAL := help

.PHONY: help dev demo build test check check-schema test-browser test-performance \
        package-win package-win-demo test-package test-package-demo release release-final

DATA_DIR ?= $(CURDIR)/data
HOST ?= 127.0.0.1
PORT ?= 8787

# Prefer the repository's pinned toolchain when available, without changing
# the user's global Node or pnpm installation.
LOCAL_NODE := $(wildcard $(CURDIR)/.build/toolchains/node24/bin/node)
LOCAL_PNPM := $(wildcard $(CURDIR)/.build/toolchains/pnpm/node_modules/.bin/pnpm)
export PATH := $(if $(LOCAL_NODE),$(dir $(LOCAL_NODE)):)$(if $(LOCAL_PNPM),$(dir $(LOCAL_PNPM)):)$(PATH)
PNPM := $(if $(LOCAL_PNPM),$(LOCAL_PNPM),pnpm)
NODE := $(if $(LOCAL_NODE),$(LOCAL_NODE),node)
DEMO_PORT ?= 8788

help:
	@printf '%s\n' \
	  '项目全流程管理 — 开发与打包命令' \
	  '' \
	  '  make help                 显示本帮助（默认）' \
	  '  make dev                  编译并启动开发服务' \
	  '  make demo                 启动本机演示环境（默认8788）' \
	  '  make demo DEMO_PORT=8789  启动独立端口及独立演示数据' \
	  '  make build                编译前后端' \
	  '  make check                运行完整工程检查' \
	  '  make check-schema         验证数据库结构及数据字典' \
	  '  make test                 运行工程测试' \
	  '  make test-browser         运行浏览器回归' \
	  '  make test-performance     运行性能回归' \
	  '' \
	  '  make release              同一基线打包并验证双版本' \
	  '  make release-final        干净HEAD全量验收并发布双版本' \
	  '  make package-win          打包并验证正式 Windows 离线版（不含数据）' \
	  '  make package-win-demo     一键打包并验证 Windows 内网演示版' \
	  '  make test-package         验证正式 Windows 发布包' \
	  '  make test-package-demo    验证 Windows 演示包' \
	  '' \
	  '  演示 ZIP：dist/sd-project-win10-x64-demo.zip' \
	  '  正式 ZIP：dist/sd-project-win10-x64.zip' \
	  '  演示包包含虚构测试数据、演示专用账号和密码，仅适用于可信内网。'

dev: build
	@DATA_DIR="$(DATA_DIR)" HOST="$(HOST)" PORT="$(PORT)" $(NODE) dist/server/main.js

demo:
	@SD_DEMO_PORT="$(DEMO_PORT)" $(PNPM) run demo

build:
	@$(PNPM) run build

test:
	@$(PNPM) test

check:
	@$(PNPM) run check

check-schema:
	@$(PNPM) run check:schema

test-browser:
	@$(PNPM) run test:browser

test-performance:
	@$(PNPM) run test:performance

package-win:
	@$(PNPM) run package:win

package-win-demo:
	@$(PNPM) run package:win:demo

release:
	@$(PNPM) run release

release-final:
	@$(PNPM) run verify:release

test-package:
	@$(PNPM) run test:package

test-package-demo:
	@$(PNPM) run test:package:demo
