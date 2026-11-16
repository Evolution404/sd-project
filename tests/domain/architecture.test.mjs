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
  source("server/modules/c/service.ts", 'repository.insert("arbitrary_table", {});');
  source("web/src/modules/equipment/Bad.vue", '<script setup lang="ts">const row: any = {};</script>');
  source("web/src/modules/projects/Bad.vue", '<script setup lang="ts">const project: any = {};</script>');
  source("web/src/modules/finance/Bad.vue", '<script setup lang="ts">const settlement: any = {};</script>');
  source("web/src/shared/api/client.ts", 'export type Row = Record<string, any>;');
  const issues = inspectArchitecture(root);
  assert.ok(issues.some(issue => issue.includes("dependency cycle")));
  assert.ok(issues.some(issue => issue.includes("explicit any")));
  assert.ok(issues.some(issue => issue.includes("suppresses type checking")));
  assert.ok(issues.some(issue => issue.includes("reverses shared UI dependency")));
  assert.ok(issues.some(issue => issue.includes("c/service.ts bypasses a typed business repository")));
  assert.ok(issues.some(issue => issue.includes("equipment/Bad.vue contains explicit any")));
  for (const file of ["projects/Bad.vue", "finance/Bad.vue", "shared/api/client.ts"])
    assert.ok(issues.some(issue => issue.includes(file + " contains explicit any")));
});
