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
  assert.match(shared, /<ElTable border allow-drag-last-column\b/, "Element Plus drag also needs the last-column flag");
  assert.match(shared, /@header-dragend="resize"/);
  assert.match(shared, /:width="columnWidth\(col\)"/);
  const app = readFileSync(join(root, "App.vue"), "utf8");
  assert.doesNotMatch(app, /调整侧栏宽度<\/ElButton|sidebar-settings|<ElSlider\s+v-model="sidebarWidth"/);
  assert.match(app, /class="sidebar-resize-grip"/);
  assert.match(app, /@pointerdown="startSidebarResize"/);
  assert.match(app, /@keydown="resizeSidebarByKeyboard"/);

  assert.match(shared, /c\.hideable === false/);
  const project = readFileSync(join(root, "pages/ProjectPage.vue"), "utf8");
  const block = project.split("const approvalEditorColumns")[1].split("const projectScopeColumns")[0];
  assert.equal((block.match(/hideable: false/g) || []).length, 3,
    "all formal approval decision input columns must be permanently visible");
});

test("multi-action rows use one primary action and an accessible shared menu", () => {
  for (const name of ["pages/CatalogPage.vue", "pages/SystemPage.vue", "pages/ProjectPage.vue", "components/FinancePanel.vue", "components/EvidencePanel.vue"]) {
    const source = readFileSync(resolve("web/src", name), "utf8");
    assert.match(source, /<RowActions\b/);
    assert.doesNotMatch(source, /:actions-width="(?:295|300|530)"/);
  }
  const source = readFileSync(resolve("web/src/components/RowActions.vue"), "utf8");
  assert.match(source, /placement="bottom-end"/);
  assert.match(source, /action.disabled \|\| busy.value/);
  assert.match(source, /aria-label="更多操作"/);
});
