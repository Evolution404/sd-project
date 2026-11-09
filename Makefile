.DEFAULT_GOAL := dev
.PHONY: dev demo build test check
DATA_DIR ?= $(CURDIR)/data
HOST ?= 127.0.0.1
PORT ?= 8787
dev: build
	@DATA_DIR="$(DATA_DIR)" HOST="$(HOST)" PORT="$(PORT)" node server/main.mjs
demo:
	@npm run demo
build:
	@npm run build
test:
	@npm test
check:
	@npm run check
