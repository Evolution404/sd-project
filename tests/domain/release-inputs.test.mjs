import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { sourceSnapshot } from "../../scripts/release/source-snapshot.mjs";

test("release input fingerprint includes build configuration and detects source edits", t => {
  const root = mkdtempSync(join(tmpdir(), "sd-release-inputs-"));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  mkdirSync(join(root, "server"));
  writeFileSync(join(root, "server", "main.ts"), "export const ready = true;");
  for (const name of ["vite.config.ts", "tsconfig.json", "tsconfig.server.json"]) writeFileSync(join(root,name), "{}");
  let snapshot = sourceSnapshot(root);
  for (const name of ["vite.config.ts", "tsconfig.json", "tsconfig.server.json", "server/main.ts"]) {
    assert.match(snapshot.files[name], /^[a-f0-9]{64}$/);
    writeFileSync(join(root,name), "changed " + name);
    const changed = sourceSnapshot(root);
    assert.notEqual(changed.sha256, snapshot.sha256);
    snapshot = changed;
  }
  assert.deepEqual(sourceSnapshot(root), snapshot);
});
test("package verification fails early when the host runtime is outside Node24", () => {
  const module = new URL("../../scripts/release/source-snapshot.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    `Object.defineProperty(process,'version',{value:'v26.0.0'}); const {requireNode24}=await import(${JSON.stringify(module)}); requireNode24();`], {encoding:"utf8"});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node24/);
});
