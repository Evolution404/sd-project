<script setup lang="ts" generic="TRow extends { id: string }">
import { computed, h, onBeforeUnmount, onMounted, ref, render, shallowRef, watch } from "vue";
import { ElButton } from "element-plus";
import { TabulatorFull as Tabulator, type ColumnDefinition } from "tabulator-tables";
import type { GridFilter, GridFilters } from "../../../../server/shared/types/contracts";
import { formatVisibleDateTime } from "../utils/datetime";
import ExcelColumnFilter, { type LoadFacetPage } from "./ExcelColumnFilter.vue";

export interface GridColumn {
  key: string;
  label: string;
  minWidth?: number;
  queryKey?: string;
  hideable?: boolean;
  defaultVisible?: boolean;
  value?: (row: Record<string, unknown>) => unknown;
}
type Preference = { order: string[]; hidden: string[]; widths: Record<string, number>; frozen?: string };

const props = defineProps<{
  rows: TRow[];
  columns: GridColumn[];
  tableKey: string;
  loading?: boolean;
  detailColumn?: string;
  sortKey?: string;
  sortDirection?: "asc" | "desc" | "";
  filters: GridFilters;
  getValues: LoadFacetPage;
}>();
const emit = defineEmits<{
  "open-detail": [row: TRow];
  "sort-change": [sort: { key: string; direction: "asc" | "desc" | "" }];
  "filter-change": [filters: GridFilters];
}>();
const host = ref<HTMLElement>();
const popup = ref<HTMLElement>();
const settings = ref(false);
const activeFilter = shallowRef<{ column: GridColumn; anchor: HTMLElement } | null>(null);
const coords = ref({ left: 0, top: 0 });
const headerControls = new Map<string, HTMLElement>();
const rowControls = new Map<string, HTMLElement>();
const pref = ref<Preference>(defaultPreference());
let table: Tabulator | undefined;
let ready = false;
let mounted = false;
const allColumns = computed(() => {
  const keys = [...new Set([...(pref.value.frozen ? [pref.value.frozen] : []), ...pref.value.order])];
  return [
    ...keys.flatMap(key => props.columns.find(column => column.key === key) ?? []),
    ...props.columns.filter(column => !keys.includes(column.key)),
  ];
});
const field = (column: GridColumn) => column.queryKey ?? column.key;
const isVisible = (column: GridColumn) => column.hideable === false || !pref.value.hidden.includes(column.key);

function defaultPreference(): Preference {
  return { order: [], hidden: props.columns.filter(column => column.defaultVisible === false).map(column => column.key), widths: {} };
}
function readPreference() {
  try {
    const saved = JSON.parse(localStorage.getItem("sd-grid:" + props.tableKey) ?? "null") as Preference | null;
    if (saved && Array.isArray(saved.order) && Array.isArray(saved.hidden) && saved.widths) {
      pref.value = { ...saved, order: [...new Set(saved.order)] };
    }
  } catch {
    // The declared defaults remain available if browser storage is unavailable.
  }
}
function savePreference() {
  try { localStorage.setItem("sd-grid:" + props.tableKey, JSON.stringify(pref.value)); }
  catch { /* Browser storage can be disabled. The current settings still apply. */ }
}
function switchColumn(key: string, show: boolean) {
  const column = props.columns.find(item => item.key === key);
  if (!column || column.hideable === false || (!show &&
    !props.columns.some(item => item.key !== key && isVisible(item)))) return;
  const hidden = new Set(pref.value.hidden);
  if (show) hidden.delete(key);
  else hidden.add(key);
  pref.value.hidden = [...hidden];
  if (!show && pref.value.frozen === key) {
    setFrozen(key);
    return;
  }
  savePreference();
  const instanceColumn = ready && table?.getColumn(key);
  if (instanceColumn) {
    if (show) instanceColumn.show();
    else instanceColumn.hide();
  }
}
function setFrozen(key: string) {
  pref.value.frozen = pref.value.frozen === key ? undefined : key;
  savePreference();
  buildColumns();
}
function canMoveColumn(index: number, diff: number) {
  const start = pref.value.frozen ? 1 : 0;
  return index >= start && index + diff >= start && index + diff < allColumns.value.length;
}
function moveColumn(key: string, diff: number) {
  const order = allColumns.value.map(column => column.key);
  const index = order.indexOf(key);
  const target = index + diff;
  if (!ready || !canMoveColumn(index, diff)) return;
  table?.moveColumn(key, order[target], diff > 0);
}
function cleanup(controls: Map<string, HTMLElement>) {
  for (const element of controls.values()) render(null, element);
  controls.clear();
}
function closeFilter(restoreFocus = true) {
  const previous = activeFilter.value;
  activeFilter.value = null;
  if (restoreFocus) previous?.anchor.querySelector("button")?.focus({ preventScroll: true });
}
function positionFilter() {
  const anchor = activeFilter.value?.anchor;
  if (!anchor || !popup.value) return;
  const bounds = anchor.getBoundingClientRect();
  const { width, height } = popup.value.getBoundingClientRect();
  coords.value = {
    left: Math.max(10, Math.min(bounds.right - width, window.innerWidth - width - 10)),
    top: Math.max(10, Math.min(bounds.bottom + 4, window.innerHeight - height - 10)),
  };
}
function updateHeaderButton(column: GridColumn) {
  const container = headerControls.get(column.key);
  if (!container) return;
  const query = field(column);
  const direction = props.sortKey === query ? props.sortDirection : "";
  const filtered = Object.hasOwn(props.filters, query);
  render(h(ElButton, {
    text: true, size: "small", class: ["grid-column-heading", { "is-filtered": filtered }],
    "data-grid-filter": column.key,
    "aria-label": column.label + "：筛选和排序" + (filtered ? "，已筛选" : "") +
      (direction === "asc" ? "，升序" : direction === "desc" ? "，降序" : ""),
    "aria-haspopup": "dialog",
    "aria-expanded": activeFilter.value?.column.key === column.key,
    onClick: () => {
      if (activeFilter.value?.column.key === column.key) closeFilter();
      else activeFilter.value = { column, anchor: container };
    },
  }, () => [
    h("span", { class: "grid-column-label" }, column.label),
    h("span", { class: "grid-column-indicators", "aria-hidden": "true" }, [
      direction ? h("span", { class: "grid-sort-symbol" }, direction === "asc" ? "↑" : "↓") : null,
      h("span", { class: "grid-column-arrow" }, "▾"),
    ]),
  ]), container);
  const parent = container.closest(".tabulator-col");
  if (direction) parent?.setAttribute("aria-sort", direction === "asc" ? "ascending" : "descending");
  else parent?.removeAttribute("aria-sort");
}
function updateHeaderButtons() {
  for (const column of props.columns) updateHeaderButton(column);
}
function applyFilter(query: string, selection: GridFilter | null) {
  const next = { ...props.filters };
  if (selection === null) delete next[query];
  else next[query] = selection;
  closeFilter();
  emit("filter-change", next);
}
function setSort(query: string, direction: "asc" | "desc" | "") {
  closeFilter();
  emit("sort-change", { key: direction ? query : "", direction });
}
function buildColumn(column: GridColumn): ColumnDefinition {
  const key = column.key;
  return {
    field: key, title: column.label, minWidth: column.minWidth ?? 125,
    width: pref.value.widths[key], visible: isVisible(column), frozen: pref.value.frozen === key,
    headerSort: false, resizable: true, editable: false,
    titleFormatter: () => {
      const container = document.createElement("span");
      const previous = headerControls.get(key);
      if (previous) render(null, previous);
      container.className = "grid-header-container";
      headerControls.set(key, container);
      updateHeaderButton(column);
      return container;
    },
    formatter: cell => {
      const row = cell.getRow().getData() as TRow;
      const raw = column.value ? column.value(row) : cell.getValue();
      if (key === props.detailColumn) {
        const previous = rowControls.get(row.id);
        if (previous) render(null, previous);
        const container = document.createElement("span");
        render(h(ElButton, { type: "primary", link: true, class: "cell-link grid-detail-link",
          "data-grid-record-id": row.id, onClick: () => emit("open-detail", row) },
          () => String(raw ?? "—")), container);
        rowControls.set(row.id, container);
        return container;
      }
      const span = document.createElement("span");
      span.textContent = String(formatVisibleDateTime(raw, key) ?? "—");
      return span;
    },
  };
}
function buildColumns() {
  if (!ready || !table) return;
  closeFilter(false);
  cleanup(headerControls);
  cleanup(rowControls);
  table.setColumns(allColumns.value.map(buildColumn));
  updateHeaderButtons();
}
const copyRows = () => props.rows.map(row => ({ ...row }));
function refreshGridData() {
  if (!ready || !table) return;
  cleanup(rowControls);
  void table.replaceData(copyRows());
}
function reset() {
  pref.value = defaultPreference();
  savePreference();
  buildColumns();
}
onMounted(() => {
  if (!host.value) return;
  mounted = true;
  readPreference();
  const rows = props.rows;
  const instance = new Tabulator(host.value, {
    index: "id", data: copyRows(), columns: allColumns.value.map(buildColumn),
    layout: "fitColumns", height: "auto", placeholder: "暂无记录", movableColumns: true,
    selectableRows: false, selectableRange: false, clipboard: false,
  });
  table = instance;
  instance.on("tableBuilt", () => {
    if (!mounted) {
      cleanup(headerControls);
      cleanup(rowControls);
      instance.destroy();
      return;
    }
    ready = true;
    updateHeaderButtons();
    if (rows !== props.rows) refreshGridData();
  });
  instance.on("columnMoved", (_column, current) => {
    pref.value.order = current.map(column => column.getField());
    savePreference();
  });
  instance.on("columnResized", column => {
    pref.value.widths[column.getField()] = column.getWidth();
    savePreference();
  });
});
onBeforeUnmount(() => {
  mounted = false;
  closeFilter(false);
  cleanup(headerControls);
  cleanup(rowControls);
  if (ready) table?.destroy();
  ready = false;
  table = undefined;
});
watch(() => props.rows, refreshGridData);
watch(() => props.columns, buildColumns, { deep: true });
watch(() => [props.filters, props.sortKey, props.sortDirection, activeFilter.value], updateHeaderButtons);
watch(popup, (element, _previous, onCleanup) => {
  if (!element) return;
  positionFilter();
  const observer = new ResizeObserver(positionFilter);
  observer.observe(element);
  function dismissOutside(event: PointerEvent) {
    if (event.target instanceof Element && !element?.contains(event.target) &&
      !event.target.closest(".grid-column-heading")) closeFilter(false);
  }
  function dismissEscape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeFilter();
  }
  function dismissOnScroll(event: Event) {
    if (event.target instanceof Node && element?.contains(event.target)) return;
    closeFilter(false);
  }
  function dismissOnResize() { closeFilter(false); }
  document.addEventListener("pointerdown", dismissOutside);
  document.addEventListener("keydown", dismissEscape);
  window.addEventListener("scroll", dismissOnScroll, true);
  window.addEventListener("resize", dismissOnResize);
  onCleanup(() => {
    observer.disconnect();
    document.removeEventListener("pointerdown", dismissOutside);
    document.removeEventListener("keydown", dismissEscape);
    window.removeEventListener("scroll", dismissOnScroll, true);
    window.removeEventListener("resize", dismissOnResize);
  });
}, { flush: "post" });
defineExpose({ openSettings: () => { settings.value = true; }, reset });
</script>
<template>
  <div class="business-tabulator">
    <div v-if="loading" class="grid-loading" role="status">正在加载…</div>
    <div ref="host" class="grid-host" aria-label="业务数据表"></div>
    <Teleport to="body">
      <div v-if="activeFilter" ref="popup" class="excel-grid-popup"
        :style="{ left: coords.left + 'px', top: coords.top + 'px' }">
        <ExcelColumnFilter :key="activeFilter.column.key"
          :field="field(activeFilter.column)" :label="activeFilter.column.label"
          :selected="filters[field(activeFilter.column)]"
          :sort="sortKey === field(activeFilter.column) ? sortDirection : ''" :has-sort="Boolean(sortDirection)"
          :get-values="getValues" @apply="applyFilter" @sort="setSort" @close="closeFilter()" />
      </div>
    </Teleport>
    <ElDialog v-model="settings" title="自定义表格列" width="500px" append-to-body>
      <p class="muted">调整显示、顺序和列宽。可将一列固定在左侧，设置自动保存在本机浏览器。</p>
      <div v-for="(column, index) in allColumns" :key="column.key" class="grid-column-setting">
        <ElCheckbox :model-value="isVisible(column)" :disabled="column.hideable === false"
          @change="switchColumn(column.key, Boolean($event))">{{ column.label }}</ElCheckbox>
        <ElButton text size="small" :disabled="!isVisible(column)"
          :aria-label="(pref.frozen === column.key ? '取消固定' : '固定') + column.label"
          @click="setFrozen(column.key)">{{ pref.frozen === column.key ? "取消固定" : "固定" }}</ElButton>
        <ElButton text size="small" :disabled="!canMoveColumn(index, -1)" :aria-label="'上移' + column.label"
          @click="moveColumn(column.key, -1)">↑</ElButton>
        <ElButton text size="small" :disabled="!canMoveColumn(index, 1)" :aria-label="'下移' + column.label"
          @click="moveColumn(column.key, 1)">↓</ElButton>
      </div>
      <template #footer><ElButton @click="reset">恢复默认</ElButton><ElButton type="primary" @click="settings = false">完成</ElButton></template>
    </ElDialog>
  </div>
</template>
<style scoped>
.business-tabulator { position: relative; width: 100%; min-width: 0; }
.grid-loading { position: absolute; right: 10px; top: 10px; color: var(--muted); z-index: 3; background: var(--surface); }
.excel-grid-popup { position: fixed; z-index: 3000; }
.grid-column-setting { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--edge); }
.grid-column-setting .el-checkbox { margin-right: auto; }

.grid-host :deep(.tabulator-header .tabulator-col .tabulator-col-content) { padding: 0; }
.grid-host :deep(.grid-header-container) { display: block; width: 100%; }
.grid-host :deep(.grid-column-heading) {
  display: flex;
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--table-heading-ink);
  font-size: 11px;
  font-weight: 500;
  text-align: left;
}
.grid-host :deep(.grid-column-heading > span) {
  display: flex; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: 8px;
}
.grid-host :deep(.grid-column-heading.is-text:not(.is-disabled):hover) { background: var(--facet-header-hover); color: var(--table-heading-ink); }
.grid-host :deep(.grid-column-heading.is-filtered),
.grid-host :deep(.grid-column-heading.is-filtered.is-text:not(.is-disabled):hover) { background: var(--facet-selected); color: var(--facet-accent); }
.grid-host :deep(.grid-column-heading:focus-visible) { outline: 2px solid var(--facet-accent); outline-offset: -2px; }
.grid-host :deep(.grid-column-label) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grid-host :deep(.grid-column-indicators) { display: flex; align-items: center; gap: 3px; color: var(--facet-muted); font-size: 12px; }
.grid-host :deep(.grid-sort-symbol) { color: var(--facet-accent); font-size: 14px; font-weight: 700; }
.grid-host :deep(.grid-column-heading.is-filtered .grid-column-arrow) {
  color: var(--facet-accent); background: var(--facet-arrow-bg); border-radius: 3px; padding: 0 2px;
}
.grid-host :deep(.grid-detail-link) { color: var(--brand-primary); padding: 0; font-weight: 500; }
</style>
