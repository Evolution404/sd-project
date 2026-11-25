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
  frozen?: boolean;
}
export interface DraftGridRow {
  id: string;
  [key: string]: string | number | boolean | null | undefined;
}
export type DraftGridEdit = { id: string; field: string; before: string; after: string };
type Edit = DraftGridEdit;

const props = defineProps<{
  rows: DraftGridRow[];
  columns: DraftGridColumn[];
  errors?: Record<string, string>;
  gridKey: string;
  selectable?: boolean;
  nativeHeaders?: boolean;
  rowEditable?: (id: string, field: string) => boolean;
  validateBatch?: (edits: readonly DraftGridEdit[]) => string | null;
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
let mounted = false;
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
  if (edit.before === edit.after) return;
  const error = (!props.rowEditable || props.rowEditable(edit.id, edit.field))
    ? props.validateBatch?.([edit]) : "此作业位置未纳入所选正式批准版本，不可修改";
  if (error) {
    replaying = true;
    cell.setValue(edit.before, false);
    replaying = false;
    ElMessage.error(error);
    return;
  }
  record([edit]);
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
  if (event.isComposing || isEditor(event)) return;
  if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && table) {
    const target=event.target instanceof HTMLElement ? event.target : null;
    const cellElement=target?.closest<HTMLElement>(".tabulator-cell[tabulator-field]");
    const rowElement=cellElement?.closest<HTMLElement>(".tabulator-row");
    const row=rowElement && table.getRows("active").find(item=>item.getElement()===rowElement);
    const field=cellElement?.getAttribute("tabulator-field")??"";
    if (row && editable.value.has(field) &&
        (!props.rowEditable || props.rowEditable(String(row.getIndex()),field))) {
      event.preventDefault();
      event.stopPropagation();
      row.getCell(field)?.edit();
      return;
    }
  }
  if (event.altKey || !(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key !== "z" && !(key === "y" && event.ctrlKey)) return;
  event.preventDefault();
  event.stopPropagation();
  if (key === "z" && !event.shiftKey) undo();
  else redo();
}
function paste(event: ClipboardEvent) {
  if (!table || isEditor(event) || !event.clipboardData?.types.includes("text/plain")) return;
  const range = table.getRanges()[0];
  if (!range) return;
  event.preventDefault();
  const matrix = parseSpreadsheetText(event.clipboardData.getData("text/plain"));
  if (!matrix) {
    ElMessage.error("剪贴板表格格式不完整，请重新复制");
    return;
  }
  const columns = table.getColumns().filter(column => column.isVisible());
  const rows = table.getRows("active");
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
  const rejected = step.find(edit => props.rowEditable && !props.rowEditable(edit.id, edit.field));
  const error = rejected ? "粘贴范围含未纳入所选批准版本的只读位置"
    : props.validateBatch?.(step);
  if (error) {
    ElMessage.error(error);
    return;
  }
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
  return [...(props.selectable ? [selector] : []), ...props.columns.map((column): ColumnDefinition => ({
    field: column.field, title: column.title, width: column.width, minWidth: column.minWidth ?? 125,
    resizable: true, frozen: Boolean(column.frozen), headerSort: Boolean(props.nativeHeaders),
    headerFilter: props.nativeHeaders ? "input" : undefined,
    headerFilterPlaceholder: "筛选…",
    editable: cell => Boolean(column.editable) &&
      (!props.rowEditable || props.rowEditable(String(cell.getRow().getIndex()),column.field)),
    editor: column.editable ? "input" : undefined,
    formatter: "plaintext",
    cssClass: column.editable ? "business-draft-editable" : "business-draft-readonly",
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
  // Vue mirrors committed cells asynchronously. A parent update is not a new
  // edit and must not silently erase the undo/redo history.
  const keepStep = (steps: Edit[][]) => steps.map(step => step.filter(edit =>
    incoming.has(edit.id),
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
  mounted = true;
  const instance = new Tabulator(host.value, {
    index: "id", data: copyRows(), columns: columns(), layout: "fitColumns",
    height: "auto", placeholder: "暂无明细", editTriggerEvent: "dblclick",
    selectableRows: false, selectableRange: 1,
    selectableRangeColumns: true, selectableRangeRows: true, selectableRangeClearCells: false,
    clipboard: "copy", clipboardCopyRowRange: "range",
    clipboardCopyConfig: { columnHeaders: false, rowHeaders: false }, clipboardCopyStyled: false,
    clipboardCopyFormatter: copyText, history: false,
  });
  table = instance;
  instance.on("cellEdited", cellEdited);
  // Range selection may consume the native editing trigger on large virtualized
  // workbooks; use Tabulator's own public CellComponent.edit as a fallback.
  instance.on("cellDblClick", (_event, cell) => {
    const field=cell.getField();
    if (!editable.value.has(field) ||
        (props.rowEditable && !props.rowEditable(String(cell.getRow().getIndex()),field))) return;
    if (!cell.getElement().querySelector("input,textarea")) cell.edit();
  });
  instance.on("tableBuilt", () => {
    if (!mounted) {
      unmountControls();
      instance.destroy();
      return;
    }
    ready = true;
    reconcileRows();
  });
});
onBeforeUnmount(() => {
  mounted = false;
  unmountControls();
  if (ready) table?.destroy();
  ready = false;
  table = undefined;
});
async function focusRow(id: string) {
  if (!table?.getRow(id)) return;
  try {
    await table.scrollToRow(id, "center", false);
    const row=table.getRow(id);
    const editCell=props.columns.find(column=>column.editable);
    row?.getCell(editCell?.field??"")?.getElement().focus({preventScroll:true});
  } catch { /* A filtered-out row is not scrollable; callers reveal it first. */ }
}
watch(copyRows, reconcileRows);
defineExpose({ undo, redo, focusRow, canUndo, canRedo });
</script>
<template>
  <div class="business-draft-grid is-editing" :data-grid-key="gridKey">
    <div ref="host" class="business-draft-host" aria-label="Excel式草稿编辑表"
      @keydown.capture="keyboardHistory" @paste.capture="paste"></div>
    <div v-if="errors && Object.keys(errors).length" class="business-draft-errors" role="alert">
      <div v-for="(error,id) in errors" :key="id">{{ rows.find(row=>row.id===id)?.name??id }} · {{ error }}</div>
    </div>
  </div>
</template>
<style scoped>
.business-draft-grid{width:100%;min-width:0}
.business-draft-grid :deep(.tabulator-col-title){
  color:var(--table-heading-ink);
  font-size:11px;font-weight:500;
}
.business-draft-grid :deep(.tabulator-header .tabulator-col .tabulator-col-content){
  min-height:38px;display:flex;align-items:center;padding:8px 10px;
}
.business-draft-grid.is-editing :deep(.business-draft-editable){cursor:cell;}
.business-draft-grid.is-editing :deep(.business-draft-editable:hover){
  background:var(--brand-soft);
}
/* The range border is the selection cue. The headers keep their normal theme. */
.business-draft-host.tabulator :deep(.tabulator-header .tabulator-col:is(.tabulator-range-highlight, .tabulator-range-selected)) {
  background-color: var(--table-heading);
  color: var(--table-heading-ink);
}
.business-draft-host.tabulator :deep(.tabulator-row:is(.tabulator-range-highlight, .tabulator-range-selected) .tabulator-range-row-header) {
  background-color: transparent;
  color: inherit;
}
.business-draft-host.tabulator :deep(.tabulator-range-overlay .tabulator-range) {
  border: 2px solid var(--brand-primary);
}
.business-draft-host.tabulator :deep(.tabulator-range-overlay .tabulator-range-cell-active) {
  border: 0;
}
.business-draft-host :deep(.tabulator-cell.tabulator-editing.tabulator-range-selected) {
  border-color: transparent;
}
.business-draft-grid :deep(.tabulator-cell[tabulator-field="quantity_text"]){
  font-variant-numeric:tabular-nums;
}
.business-draft-grid :deep(.draft-select-row){
  color:var(--brand-primary);padding:2px 8px;font-size:18px;
}
.business-draft-errors{color:var(--el-color-danger);font-size:12px;padding:8px 2px}
</style>
