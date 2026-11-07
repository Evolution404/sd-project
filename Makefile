# Mac/Linux development: make dev opens IPv4 LAN listening; the application enforces the exact-IP allowlist.
# Test data is isolated from the real deployment data directory.
.DEFAULT_GOAL := dev
.PHONY: dev build test check

# Development schemas intentionally have no in-place migrations. Use a fresh
# directory for each canonical schema version while preserving all older data.
# Read the version from schema-version.mjs; do not maintain a second hardcoded number.
SCHEMA_VERSION := $(shell sed -nE 's/^export const SCHEMA_VERSION=([0-9]+);.*/\1/p' server/database/schema-version.mjs)
ifeq ($(strip $(SCHEMA_VERSION)),)
$(error Cannot determine schema version from server/database/schema-version.mjs)
endif
DATA_DIR ?= $(CURDIR)/data
HOST ?= 0.0.0.0
PORT ?= 8787

dev:
	@command -v node >/dev/null 2>&1 || { echo "请先安装 Node.js 24 或更高版本"; exit 1; }
	@node -e "if (Number(process.versions.node.split('.')[0]) < 24) { console.error('需要 Node.js 24 或更高版本'); process.exit(1); }"
	@if [ ! -x node_modules/.bin/vite ] || [ ! -x node_modules/.bin/vue-tsc ]; then echo "首次运行：安装项目依赖"; npm ci --no-audit --no-fund; fi
	@npm run build
	@DATA_DIR="$(DATA_DIR)" HOST="$(HOST)" PORT="$(PORT)" node scripts/dev-start.mjs

build:
	@npm run build

test:
	@npm test

check:
	@npm run check
