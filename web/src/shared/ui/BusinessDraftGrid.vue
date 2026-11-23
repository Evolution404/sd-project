<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, render, shallowRef, watch } from "vue";
import { ElButton, ElMessage } from "element-plus";
import { TabulatorFull as Tabulator, type CellComponent, type ColumnDefinition } from "tabulator-tables";
import { parseSpreadsheetText, spreadsheetCellText } from "./spreadsheet-text";

export interface DraftGridColumn {
  field: string;
  title: string;
  width?: number;
  minWidth?: number;
  editable?: boolean;
}
export interface DraftGridRow {
  id: string;
  [key: string]: string | number | boolean | null | undefined;
}
type Edit = { id: string; field: string; before: string; after: string };

const props = defineProps<{
  rows: DraftGridRow[];
  columns: DraftGridColumn[];
  errors?: Record<string, string>;
  gridKey: string;
  mode: "view" | "edit";
}>();
const emit = defineEmits<{
  change: [id: string, field: string, value: string];
  "selection-change": [ids: string[]];
}>();
const host = ref<HTMLElement>();
const selectedIds = ref<string[]>([]);
const controls = new Map<string, { element: HTMLElement; name: string }>();
const editable = computed(() => new Set(props.columns.filter(column => column.editable).map(column => column.field)));
const undoSteps = shallowRef<Edit[][]>([]);
const redoSteps = shallowRef<Edit[][]>([]);
const canUndo = computed(() => undoSteps.value.length > 0);
const canRedo = computed(() => redoSteps.value.length > 0);
let table: Tabulator | undefined;
let ready = false;
let replaying = false;
const asText = (value: unknown) => String(value ?? "");

function publish(step: Edit[], side: "before" | "after") {
  for (const edit of step) emit("change", edit.id, edit.field, edit[side]);
}
function record(step: Edit[]) {
  if (!step.length) return;
  undoSteps.value = [...undoSteps.value.slice(-99), step];
  redoSteps.value = [];
  publish(step, "after");
}
function makeEdit(cell: CellComponent, before: unknown, after: unknown): Edit {
  return { id: String(cell.getRow().getIndex()), field: cell.getField(), before: asText(before), after: asText(after) };
}
function cellEdited(cell: CellComponent) {
  if (replaying || !editable.value.has(cell.getField())) return;
  const edit = makeEdit(cell, cell.getOldValue(), cell.getValue());
  if (edit.before !== edit.after) record([edit]);
}
function apply(step: Edit[], side: "before" | "after") {
  replaying = true;
  try {
    for (const edit of step) {
      const row = table?.getRow(edit.id);
      const cell = row && row.getCell(edit.field);
      if (cell) cell.setValue(edit[side], false);
    }
  } finally {
    replaying = false;
  }
}
function undo() {
  const step = undoSteps.value.at(-1);
  if (!step) return;
  apply(step, "before");
  undoSteps.value = undoSteps.value.slice(0, -1);
  redoSteps.value = [...redoSteps.value, step];
  publish(step, "before");
}
function redo() {
  const step = redoSteps.value.at(-1);
  if (!step) return;
  apply(step, "after");
  redoSteps.value = redoSteps.value.slice(0, -1);
  undoSteps.value = [...undoSteps.value, step];
  publish(step, "after");
}
function isEditor(event: Event) {
  return event.target instanceof HTMLElement &&
    Boolean(event.target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false'])"));
}
function keyboardHistory(event: KeyboardEvent) {
  if (props.mode !== "edit" || event.altKey || event.isComposing ||
    !(event.metaKey || event.ctrlKey) || isEditor(event)) return;
  const key = event.key.toLowerCase();
  if (key !== "z" && !(key === "y" && event.ctrlKey)) return;
  event.preventDefault();
  event.stopPropagation();
  if (key === "z" && !event.shiftKey) undo();
  else redo();
}
function paste(event: ClipboardEvent) {
  if (props.mode !== "edit" || !table || isEditor(event) || !event.clipboardData?.types.includes("text/plain")) return;
  const range = table.getRanges()[0];
  if (!range) return;
  event.preventDefault();
  const matrix = parseSpreadsheetText(event.clipboardData.getData("text/plain"));
  if (!matrix) {
    ElMessage.error("剪贴板表格格式不完整，请重新复制");
    return;
  }
  const columns = table.getColumns().filter(column => column.isVisible());
  const rows = table.getRows();
  const startColumn = columns.findIndex(column => column.getField() === range.getColumns()[0]?.getField());
  const startRow = rows.findIndex(row => row.getIndex() === range.getRows()[0]?.getIndex());
  const fields = columns.slice(startColumn, startColumn + matrix[0].length).map(column => column.getField());
  if (startColumn < 0 || startRow < 0 || fields.length !== matrix[0].length ||
    startRow + matrix.length > rows.length || fields.some(field => !editable.value.has(field))) {
    ElMessage.error("粘贴范围包含只读字段或超出已有明细。请从可编辑列开始粘贴，并保证有足够的行");
    return;
  }
  const step = matrix.flatMap((values, rowIndex) =>
    values.flatMap((value, columnIndex) => {
      const cell = rows[startRow + rowIndex].getCell(fields[columnIndex]);
      if (!cell) return [];
      const edit = makeEdit(cell, cell.getValue(), value);
      return edit.before === edit.after ? [] : [edit];
    }),
  );
  apply(step, "after");
  record(step);
}
function copyText(type: "plain" | "html", output: string) {
  const range = table?.getRanges()[0];
  if (type !== "plain" || !range) return output;
  const fields = range.getColumns().map(column => column.getField()).filter(field => field !== "__business_select");
  return range.getRows().map(row => fields.map(field => spreadsheetCellText(row.getData()[field])).join("\t")).join("\n");
}

function toggleRow(id: string) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter(selected => selected !== id)
    : [...selectedIds.value, id];
  renderSelector(id);
  emit("selection-change", selectedIds.value);
}
function renderSelector(id: string) {
  const control = controls.get(id);
  if (!control) return;
  const checked = selectedIds.value.includes(id);
  render(h(ElButton, {
    text: true, size: "small", class: "draft-select-row",
    "data-grid-select-id": id, role: "checkbox",
    "aria-label": "选择" + control.name, "aria-checked": checked,
    onClick: () => toggleRow(id),
  }, () => checked ? "☑" : "☐"), control.element);
}
function unmountControls() {
  for (const { element } of controls.values()) render(null, element);
  controls.clear();
}
function columns(): ColumnDefinition[] {
  const editing = props.mode === "edit";
  const selector: ColumnDefinition = {
    title: "选择", field: "__business_select", width: 58, minWidth: 46,
    resizable: false, headerSort: false, clipboard: false,
    formatter: cell => {
      const id = String(cell.getRow().getIndex());
      const existing = controls.get(id);
      if (existing) render(null, existing.element);
      const element = document.createElement("span");
      controls.set(id, { element, name: asText(cell.getRow().getData().name) || "明细" });
      renderSelector(id);
      return element;
    },
  };
  return [...(editing ? [selector] : []), ...props.columns.map((column): ColumnDefinition => ({
    field: column.field, title: column.title, width: column.width, minWidth: column.minWidth ?? 125,
    resizable: true, headerSort: false, editable: editing && Boolean(column.editable),
    editor: editing && column.editable ? "input" : undefined,
    formatter: "plaintext",
    cssClass: editing && column.editable ? "business-draft-editable" : "business-draft-readonly",
  }))];
}
const copyRows = () => props.rows.map(row => ({ ...row }));
function reconcileRows() {
  if (!ready || !table) return;
  const rows = copyRows();
  const current = table.getData() as DraftGridRow[];
  if (rows.length === current.length && rows.every((row, index) =>
    row.id === current[index].id && Object.keys(row).every(key => row[key] === current[index][key]))) return;
  const incoming = new Map(rows.map(row => [row.id, row]));
  const previous = new Map(current.map(row => [row.id, row]));
  const keepStep = (steps: Edit[][]) => steps.map(step => step.filter(edit =>
    incoming.has(edit.id) && incoming.get(edit.id)?.[edit.field] === previous.get(edit.id)?.[edit.field],
  )).filter(step => step.length);
  undoSteps.value = keepStep(undoSteps.value);
  redoSteps.value = keepStep(redoSteps.value);
  unmountControls();
  selectedIds.value = selectedIds.value.filter(id => incoming.has(id));
  emit("selection-change", selectedIds.value);
  void table.replaceData(rows);
}
onMounted(() => {
  if (!host.value) return;
  const editing = props.mode === "edit";
  table = new Tabulator(host.value, {
    index: "id", data: copyRows(), columns: columns(), layout: "fitColumns",
    height: "auto", placeholder: "暂无明细", editTriggerEvent: "dblclick",
    selectableRows: false, selectableRange: editing ? 1 : false,
    selectableRangeColumns: editing, selectableRangeRows: editing, selectableRangeClearCells: false,
    clipboard: editing ? "copy" : false, clipboardCopyRowRange: "range",
    clipboardCopyConfig: { columnHeaders: false, rowHeaders: false }, clipboardCopyStyled: false,
    clipboardCopyFormatter: copyText, history: false,
  });
  table.on("cellEdited", cellEdited);
  table.on("tableBuilt", () => { ready = true; reconcileRows(); });
});
onBeforeUnmount(() => {
  ready = false;
  unmountControls();
  table?.destroy();
  table = undefined;
});
watch(copyRows, reconcileRows);
defineExpose({ undo, redo, canUndo, canRedo });
</script>
<template>
  <div class="business-draft-grid" :class="mode === 'edit' ? 'is-editing' : 'is-viewing'" :data-grid-key="gridKey">
    <div ref="host" class="business-draft-host" :aria-label="mode === 'edit' ? 'Excel式草稿编辑表' : '草稿明细表'"
      @keydown.capture="keyboardHistory" @paste.capture="paste"></div>
    <div v-if="errors && Object.keys(errors).length" class="business-draft-errors" role="alert">
      <div v-for="(error,id) in errors" :key="id">{{ rows.find(row=>row.id===id)?.name??id }} · {{ error }}</div>
    </div>
  </div>
</template>
<style scoped>
.business-draft-grid{width:100%;min-width:0}
.business-draft-host{width:100%;overflow:hidden;border:1px solid var(--edge);border-radius:8px;font-size:13px}
.business-draft-grid :deep(.tabulator){
  background:var(--surface);color:var(--ink);border:0;font:inherit;
}
.business-draft-grid :deep(.tabulator-header),
.business-draft-grid :deep(.tabulator-header .tabulator-col){
  background:var(--table-heading)!important;
  color:var(--table-heading-ink)!important;
  border-color:var(--edge)!important;
}
.business-draft-grid :deep(.tabulator-col-title){
  color:var(--table-heading-ink)!important;
  font-size:13px;font-weight:600;
}
.business-draft-grid :deep(.tabulator .tabulator-row){
  background:var(--surface)!important;color:var(--ink)!important;
  border-bottom:1px solid var(--edge)!important;min-height:42px;
}
.business-draft-grid :deep(.tabulator .tabulator-row-even){
  background:var(--surface-subtle)!important;
}
.business-draft-grid :deep(.tabulator .tabulator-row:hover){
  background:var(--table-row-hover)!important;
}
.business-draft-grid :deep(.tabulator .tabulator-cell){
  background:transparent!important;color:var(--ink)!important;
  border-right:1px solid var(--edge)!important;
  padding:10px 12px;vertical-align:middle;
}
.business-draft-grid.is-editing :deep(.business-draft-editable){
  background:transparent!important;color:var(--ink)!important;
  font-weight:400;cursor:cell;
}
.business-draft-grid.is-editing :deep(.business-draft-editable:hover){
  background:var(--brand-soft)!important;
}
.business-draft-grid.is-editing :deep(.tabulator .tabulator-cell.tabulator-range-selected){
  outline:2px solid var(--brand-primary);outline-offset:-2px;
}
.business-draft-grid :deep(.tabulator-cell[tabulator-field="quantity_text"]){
  font-variant-numeric:tabular-nums;
}
.business-draft-grid :deep(.draft-select-row){
  color:var(--brand-primary);padding:2px 8px;font-size:18px;
}
.business-draft-errors{color:var(--el-color-danger);font-size:12px;padding:8px 2px}
</style>
