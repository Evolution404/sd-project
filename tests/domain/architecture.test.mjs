import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectArchitecture } from "../../scripts/check-architecture.mjs";

test("architecture gate rejects cycles, shared-to-business imports and type suppression", t => {
  const root = mkdtempSync(join(tmpdir(), "sd-architecture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function source(path, code) {
    const parts = path.split("/"); parts.pop();
    mkdirSync(join(root, ...parts), { recursive: true });
    writeFileSync(join(root, path), code);
  }
  source("server/modules/a/service.ts", 'import "../b/service.js"; export const x: any = 1;');
  source("server/modules/b/service.ts", 'import "../a/service.js"; // @ts-nocheck');
  source("web/src/shared/ui/Bad.ts", 'import "../../modules/projects/Bad.ts";');
  source("web/src/modules/projects/Bad.ts", 'export const bad = true;');
  const issues = inspectArchitecture(root);
  assert.ok(issues.some(issue => issue.includes("dependency cycle")));
  assert.ok(issues.some(issue => issue.includes("explicit any")));
  assert.ok(issues.some(issue => issue.includes("suppresses type checking")));
  assert.ok(issues.some(issue => issue.includes("reverses shared UI dependency")));
});
