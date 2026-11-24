import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
function make(...args) {
  const run = spawnSync("make", args, {
    cwd: root, encoding: "utf8", timeout: 8000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run.stdout;
}
test("plain make only prints command help and does not build or run services", () => {
  const makefile = readFileSync(resolve(root, "Makefile"), "utf8");
  assert.match(makefile, /^\.DEFAULT_GOAL\s*:=\s*help$/m);
  const output = make();
  assert.match(output, /项目全流程管理/);
  assert.match(output, /make package-win-demo/);
  assert.doesNotMatch(output, /SERVER_BUILD_OK|SCHEMA113_READY|vite.*built/);
  const dryRun = make("-n");
  assert.match(dryRun, /printf/);
  assert.doesNotMatch(dryRun, /pnpm run build|pnpm run demo|dist\/server\/main/);
});
test("single demo packaging target builds and validates the ZIP", () => {
  const output = make("-n", "package-win-demo");
  assert.match(output, /pnpm run package:win:demo/);
  assert.doesNotMatch(output,/test:package:demo/);
  assert.match(make("-n","release"),/pnpm run release/);
  assert.match(make("-n","release-final"),/pnpm run verify:release/);
  const formal = make("-n", "package-win");
  assert.match(formal, /pnpm run package:win/);
  assert.doesNotMatch(formal, /demo/);
});
