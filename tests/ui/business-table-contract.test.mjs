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
  const shared = readFileSync(join(root, "shared/ui/BusinessTable.vue"), "utf8");
  assert.match(shared, /hideable\?: boolean/);
  assert.match(shared, /<ElTable border allow-drag-last-column\b/, "Element Plus drag also needs the last-column flag");
  assert.match(shared, /@header-dragend="resize"/);
  assert.match(shared, /:width="columnWidth\(col\)"/);
  const app = readFileSync(join(root, "app/App.vue"), "utf8");
  assert.doesNotMatch(app, /调整侧栏宽度<\/ElButton|sidebar-settings|<ElSlider\s+v-model="sidebarWidth"/);
  assert.match(app, /class="sidebar-resize-grip"/);
  assert.match(app, /@pointerdown="startSidebarResize"/);
  assert.match(app, /@keydown="resizeSidebarByKeyboard"/);

  assert.match(shared, /c\.hideable === false/);
  const project = readFileSync(join(root, "modules/projects/ProjectPage.vue"), "utf8");
  const block = project.split("const approvalEditorColumns")[1].split("const projectScopeColumns")[0];
  assert.equal((block.match(/hideable: false/g) || []).length, 2,
    "complete-demand approval shows two immutable location facts, not partial-approval inputs");
});

test("multi-action rows use one primary action and an accessible shared menu", () => {
  for (const name of ["modules/catalog/CatalogPage.vue", "modules/equipment/EquipmentPage.vue", "modules/materials/MaterialsPage.vue", "modules/dictionaries/DictionaryPage.vue", "modules/system/SystemPage.vue", "modules/projects/ProjectPage.vue", "modules/finance/FinancePanel.vue", "modules/files/EvidencePanel.vue"]) {
    const source = readFileSync(resolve("web/src", name), "utf8");
    assert.match(source, /<RowActions\b/);
    assert.doesNotMatch(source, /:actions-width="(?:295|300|530)"/);
  }
  const source = readFileSync(resolve("web/src/shared/ui/RowActions.vue"), "utf8");
  assert.match(source, /placement="bottom-end"/);
  assert.match(source, /action.disabled \|\| busy.value/);
  assert.match(source, /aria-label="更多操作"/);
});

test("column ordering uses SortableJS and a keyboard alternative", () => {
  const source = readFileSync(resolve("web/src/shared/ui/BusinessTable.vue"), "utf8");
  assert.match(source, /Sortable.create/);
  assert.match(source, /@keydown="reorderByKeyboard/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /onUnmounted\(stopColumnDrag\)/);
});

test("sparse tables use flexible minimum widths and detail viewing stays in one modal adapter", () => {
  const table = readFileSync(resolve("web/src/shared/ui/BusinessTable.vue"), "utf8");
  assert.match(table, /:min-width="columnMinWidth\(col\)"/);
  assert.match(table, /const stretchColumn = computed/);
  assert.doesNotMatch(table, /type="expand"/);
  const pages = { demands: "DemandPage", projects: "ProjectPage", catalog: "CatalogPage", equipment: "EquipmentPage", materials: "MaterialsPage", dictionaries: "DictionaryPage" };
  for (const [module, name] of Object.entries(pages)) {
    const source = readFileSync(resolve(`web/src/modules/${module}/${name}.vue`), "utf8");
    assert.match(source, /<BusinessDetailDialog\b/);
    assert.match(source, /useEntityDialog\(/);
    assert.doesNotMatch(source, /useEntityRoute|#expand/);
  }
  const dialog = readFileSync(resolve("web/src/shared/composables/use-entity-dialog.ts"), "utf8");
  assert.doesNotMatch(dialog, /router\.push|router\.replace/);
});
