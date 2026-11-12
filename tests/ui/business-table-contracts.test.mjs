import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

test("every mounted BusinessTable has working sort/filter controls or explicitly disables them", () => {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
  const r=spawnSync(process.execPath,["scripts/check-business-table-contracts.mjs"],{
    cwd:root,encoding:"utf8",timeout:30000,
  });
  assert.equal(r.status,0,(r.stderr||"")+"\n"+(r.stdout||""));
  assert.match(r.stdout,/BUSINESS_TABLE_CONTRACTS_OK instances=\d+/);
});
