import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

function vueFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? vueFiles(path)
      : entry.isFile() && entry.name.endsWith(".vue") ? [path] : [];
  });
}

test("all business data tables use the single customizable BusinessTable adapter", () => {
  const root = resolve("web/src");
  const files = vueFiles(root).filter(file => !file.endsWith("/BusinessTable.vue"));
  assert.ok(files.length > 8, "the audit scope must contain the real application");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<ElTable(?:Column)?\b/,
      file + " bypasses the shared table adapter");
  }
  const shared = readFileSync(join(root, "components/BusinessTable.vue"), "utf8");
  assert.match(shared, /hideable\?: boolean/);
  assert.match(shared, /c\.hideable === false/);
  const project = readFileSync(join(root, "pages/ProjectPage.vue"), "utf8");
  const block = project.split("const approvalEditorColumns")[1].split("const projectScopeColumns")[0];
  assert.equal((block.match(/hideable: false/g) || []).length, 3,
    "all formal approval decision input columns must be permanently visible");
});
