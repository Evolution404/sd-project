<script setup lang="ts" generic="TRow extends object = Row">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { Setting, Filter, Rank } from "@element-plus/icons-vue";
import Sortable from "sortablejs";
import type { TableInstance } from "element-plus";
import type { Row } from "../api/client";
import { formatVisibleDateTime } from "../utils/datetime";
export type TableColumn = {
  key: string; label: string; minWidth?: number;
  sortable?: boolean; filterable?: boolean; hideable?: boolean;
  customHeader?: boolean;
  /** Stable server whitelist keys; capabilities are never inferred from a display label. */
  sortKey?: string; filterKey?: string;
  /** Hidden on a new per-entity preference profile until explicitly selected. */
  defaultVisible?: boolean;
};
const props = withDefaults(defineProps<{
  rows: TRow[]; columns: TableColumn[]; tableKey: string;
  selectedIds?: readonly string[];
  detailColumn?: string;
  detailGuideAction?: string;
  detailFallbackKey?: string;
  selectable?: boolean; loading?: boolean; actionsWidth?: number;
  clientSide?: boolean; maxHeight?: number | string; compact?: boolean;
  /** If omitted, only client-side tables and explicitly controlled remote tables show controls. */
  sortMode?: "local" | "remote" | "off";
  filterMode?: "local" | "remote" | "off";
  filterState?: Record<string, string>;
  searchActive?: boolean;
  fixedFilterKeys?: readonly string[];
  sortState?: { prop: string; order: "ascending" | "descending" | null };
}>(), { selectable: false, loading: false, actionsWidth: 190 });
const emit = defineEmits<{
  (e: "open-detail", row: TRow): void;
  (e: "clear-search"): void;
  (e: "selection-change", rows: TRow[]): void;
  (e: "sort-change", value: { key: string; order: string }): void;
  (e: "filter-change", filters: Record<string, string>): void;
}>();
defineSlots<{
  cell(props: { row: TRow; column: TableColumn; value: unknown }): unknown;
  header(props: { column: TableColumn }): unknown;
  toolbar(props: { openSettings: () => void; clearFilters: () => void; activeFilterCount: number; hasActiveFilters: boolean; appliedFilters: Array<{ label: string; value: string }> }): unknown;
  actions(props: { row: TRow }): unknown;
}>();
function detailValue(row: object, column: string): unknown {
  return valueAt(row, column) || (props.detailFallbackKey ? valueAt(row, props.detailFallbackKey) : undefined);
}
function valueAt(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}
type Pref = { order: string[]; hidden: string[]; fixed: string[]; widths: Record<string, number> };
function defaultPref(): Pref {
  return {
    order: [], hidden: props.columns.filter(col => col.defaultVisible === false).map(col => col.key),
    fixed: [], widths: {},
  };
}
function readPref(): Pref {
  try {
    const raw = localStorage.getItem("sd-columns:" + props.tableKey);
    if (!raw) return defaultPref();
    const saved: Partial<Pref> = JSON.parse(raw);
    return {
      order: Array.isArray(saved.order) ? saved.order : [],
      hidden: Array.isArray(saved.hidden) ? saved.hidden : defaultPref().hidden,
      fixed: Array.isArray(saved.fixed) ? saved.fixed : [],
      widths: saved.widths && typeof saved.widths === "object" ? saved.widths : {},
    };
  } catch { return defaultPref(); }
}
const pref = ref<Pref>({ order: [], hidden: [], fixed: [], widths: {} });
const sortingEnabled = computed(() => props.sortMode === "off" ? false
  : props.sortMode === "remote" || props.sortMode === "local" ? true
    : props.clientSide || props.sortState !== undefined);
const filteringEnabled = computed(() => props.filterMode === "off" ? false
  : props.filterMode === "remote" || props.filterMode === "local" ? true
    : props.clientSide || props.filterState !== undefined);
const filters = ref<Record<string, string>>({});
const appliedFilters = computed(() => props.columns.flatMap(column => {
  const value = filters.value[column.key]?.trim();
  return value && !props.fixedFilterKeys?.includes(column.key) ? [{ label: column.label, value }] : [];
}));
const activeFilterCount = computed(() => appliedFilters.value.length);
const hasActiveFilters = computed(() => props.searchActive ||
  (filteringEnabled.value && activeFilterCount.value > 0));
function clearFilters() {
  filters.value = Object.fromEntries(Object.entries(filters.value).filter(([key]) => props.fixedFilterKeys?.includes(key)));
  if (props.searchActive) emit("clear-search");
  else if (!props.clientSide && filteringEnabled.value) emit("filter-change", { ...filters.value });
}
const table = ref<TableInstance>();
watch([table, () => props.rows, () => props.selectedIds], () => {
  if (!table.value || props.selectedIds === undefined) return;
  const ids = new Set(props.selectedIds);
  table.value.clearSelection();
  for (const row of props.rows)
    if (ids.has(String(valueAt(row, "id")))) table.value.toggleRowSelection(row, true);
}, { flush: "post" });
function selectionChanged(rows: Row[], fromUser: boolean) {
  if ((props.selectedIds !== undefined) === fromUser) emit("selection-change", rows as TRow[]);
}

watch(() => props.filterState, value => { if (value) filters.value = { ...value }; }, { immediate: true, deep: true });
watch(() => props.sortState, async value => {
  if (!sortingEnabled.value) return;
  await nextTick();
  if (value?.prop && value.order) table.value?.sort(value.prop, value.order);
  else table.value?.clearSort();
}, { deep: true });
const localSort = ref({ key: "", order: "" });
const tableRows = computed(() => {
  if (!props.clientSide) return props.rows;
  const activeFilters = Object.entries(filters.value).filter(([, value]) => !!value?.trim());
  const result = props.rows.filter(row => activeFilters.every(([key, value]) =>
    String(valueAt(row, key) ?? "").toLocaleLowerCase("zh-CN").includes(value.trim().toLocaleLowerCase("zh-CN"))));
  const { key, order } = localSort.value;
  if (key && order) result.sort((a, b) => {
    const va = valueAt(a, key), vb = valueAt(b, key);
    if (va == null) return vb == null ? 0 : 1;
    if (vb == null) return -1;
    const compare = typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb), "zh-CN", { numeric: true });
    return order === "ascending" ? compare : -compare;
  });
  return result;
});
const settings = ref(false);
const settingsList = ref<HTMLElement>();
const announcement = ref("");
let sortable: Sortable | undefined;
const orderedColumns = computed(() => {
  const keys = [...new Set([...pref.value.order, ...props.columns.map(c => c.key)])];
  return keys.map(key => props.columns.find(c => c.key === key)).filter((v): v is TableColumn => !!v);
});
const shownColumns = computed(() => orderedColumns.value.filter(c => c.hideable === false || !pref.value.hidden.includes(c.key)));
// Element Plus requires a bordered table for its native column resize handler.
function defaultColumnWidth(col: TableColumn) {
  // Chinese characters occupy approximately one full 14px em; use extra
  // room for sortable arrows, filter actions and header cell padding.
  const textWidth = [...col.label].reduce((sum, char) =>
    sum + (/[^\x00-\x7f]/.test(char) ? 14.5 : 8), 0);
  const controls = (!sortingEnabled.value || col.sortable === false ? 0 : 20)
    + (!filteringEnabled.value || col.filterable === false ? 0 : 28);
  return Math.ceil(Math.max(col.minWidth ?? 130, textWidth + controls + 28));
}
function savedColumnWidth(col: TableColumn) {
  const saved = pref.value.widths[col.key];
  return Number.isFinite(saved) && saved >= 80 && saved <= 1200
    ? saved : undefined;
}
// Let Element Plus distribute spare space. If every data column has a saved
// width, the last one remains flexible so the table never leaves a blank area.
const stretchColumn = computed(() => shownColumns.value.every(col => savedColumnWidth(col) !== undefined)
  ? shownColumns.value.at(-1)?.key : undefined);
function columnWidth(col: TableColumn) {
  return col.key === stretchColumn.value ? undefined : savedColumnWidth(col);
}
function columnMinWidth(col: TableColumn) {
  return columnWidth(col) === undefined ? savedColumnWidth(col) ?? defaultColumnWidth(col) : 80;
}

function persist() {
  localStorage.setItem("sd-columns:" + props.tableKey, JSON.stringify(pref.value));
}
function show(key: string, value: boolean) {
  if (props.columns.find(c => c.key === key)?.hideable === false) return;
  pref.value.hidden = value ? pref.value.hidden.filter(k => k !== key) : [...pref.value.hidden, key];
  persist();
}
function toggleFixed(key: string) {
  pref.value.fixed = pref.value.fixed.includes(key)
    ? pref.value.fixed.filter(item => item !== key)
    : [...pref.value.fixed, key];
  persist();
}
function move(key: string, next: number) {
  const keys = orderedColumns.value.map(c => c.key);
  const i = keys.indexOf(key);
  if (i < 0 || next < 0 || next >= keys.length || i === next) return;
  keys.splice(i, 1);
  keys.splice(next, 0, key);
  pref.value.order = keys;
  announcement.value = `${props.columns.find(col => col.key === key)?.label}已移至第${next + 1}列`;
  persist();
}
function startColumnDrag() {
  stopColumnDrag();
  if (!settingsList.value) return;
  sortable = Sortable.create(settingsList.value, {
    handle: ".column-drag-handle",
    draggable: ".column-setting-item",
    animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 120,
    ghostClass: "column-drag-ghost",
    onEnd(event) {
      const { oldIndex, newIndex, item, from } = event;
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
      // Restore the DOM before Vue applies the reordered keyed children.
      from.removeChild(item);
      from.insertBefore(item, from.children[oldIndex] || null);
      move(item.dataset.columnKey!, newIndex);
    },
  });
}
function stopColumnDrag() {
  sortable?.destroy();
  sortable = undefined;
}
async function reorderByKeyboard(event: KeyboardEvent, key: string, index: number) {
  const next = event.key === "ArrowUp" ? index - 1
    : event.key === "ArrowDown" ? index + 1
    : event.key === "Home" ? 0
    : event.key === "End" ? orderedColumns.value.length - 1 : null;
  if (next === null) return;
  event.preventDefault();
  move(key, next);
  await nextTick();
  const row = Array.from(settingsList.value?.children || [])
    .find(element => (element as HTMLElement).dataset.columnKey === key);
  row?.querySelector<HTMLButtonElement>(".column-drag-handle")?.focus();
}
onUnmounted(stopColumnDrag);
function resize(newWidth: number, _oldWidth: number, column: { property?: string; label?: string }) {
  const key = column.property || (column.label === "操作" ? "__actions" : null);
  if (!key || !Number.isFinite(newWidth)) return;
  pref.value.widths = { ...pref.value.widths, [key]: Math.round(newWidth) };
  persist();
}
function openColumnSettings() { settings.value = true; }
function reset() {
  pref.value = defaultPref();
  persist();
  void restoreColumnLayout();
}
function filter() {
  if (filteringEnabled.value && !props.clientSide)
    emit("filter-change", Object.fromEntries(Object.entries(filters.value).filter(([, value]) => value.trim())));
}
function handleSort(value: { prop?: string | null; order?: string | null }) {
  if (!sortingEnabled.value) return;
  const sort = { key: value.prop || "", order: value.order || "" };
  if (props.clientSide) localSort.value = sort;
  else if (sort.key !== props.sortState?.prop || sort.order !== (props.sortState?.order || "")) emit("sort-change", sort);
}
// Restoring persisted widths changes the Element Plus column layout after
// the initial table mount. Explicitly recalculate once Vue has applied them
// so a reloaded table never stays narrower than its available workspace.
async function restoreColumnLayout() {
  await nextTick();
  table.value?.doLayout();
}
onMounted(async () => {
  pref.value = readPref();
  await restoreColumnLayout();
});
watch(() => props.tableKey, async () => {
  pref.value = readPref();
  filters.value = { ...props.filterState };
  localSort.value = { key: "", order: "" };
  await restoreColumnLayout();
});
</script>
<template>
  <div class="business-table">
    <slot name="toolbar" :open-settings="openColumnSettings" :clear-filters="clearFilters" :active-filter-count="activeFilterCount" :has-active-filters="hasActiveFilters" :applied-filters="appliedFilters">
    <div class="business-table-tools">
      <div class="business-table-state">
        <span class="business-table-row-count" role="status">{{ loading ? '正在加载…' : '本页 ' + tableRows.length + ' 条' }}</span>
        <ElButton v-if="hasActiveFilters" size="small" plain type="primary" @click="clearFilters">
          {{ searchActive ? "清除检索与筛选" : "已筛选 " + activeFilterCount + " 列 · 清除" }}
        </ElButton>
      </div>
      <ElButton class="business-column-setting-trigger" size="small" plain @click="settings = true"><ElIcon><Setting /></ElIcon> 列设置</ElButton>
    </div>
    </slot>
    <ElTable border allow-drag-last-column ref="table" :data="tableRows as Row[]" :default-sort="sortState?.order ? { prop: sortState.prop, order: sortState.order } : undefined" :row-key="(row: Row) => String(row.id || row.location_item_no || row.code || row.name || row.month || row.quarter || row.created_at || JSON.stringify(row))" v-loading="loading"
      :max-height="maxHeight" :size="compact ? 'small' : 'default'" table-layout="fixed" class="business-table-grid"
      @selection-change="selectionChanged($event, false)"
      @select="selectionChanged($event, true)" @select-all="selectionChanged($event, true)"
      @sort-change="handleSort"
      @header-dragend="resize">
      <ElTableColumn v-if="selectable" type="selection" width="48" fixed="left" />
      <ElTableColumn v-for="col in shownColumns" :key="col.key" :prop="col.key" :label="col.label"
        :min-width="columnMinWidth(col)" :width="columnWidth(col)"
        :sortable="!sortingEnabled || col.sortable === false ? false : 'custom'"
        :sort-orders="['ascending', 'descending']"
        :fixed="pref.fixed.includes(col.key) ? 'left' : false" resizable show-overflow-tooltip>
        <template #header>
          <slot v-if="col.customHeader && $slots.header" name="header" :column="col" />
          <template v-else>
            <span class="business-column-title" :title="col.label">{{ col.label }}</span>
            <ElPopover v-if="filteringEnabled && col.filterable !== false" trigger="click" width="220" placement="bottom">
              <ElInput v-model="filters[col.key]" clearable size="small" :placeholder="'筛选' + col.label" @change="filter" @clear="filter" @keyup.enter="filter" />
              <template #reference><ElButton class="business-filter-button" :class="{ 'is-active-filter': !!filters[col.key]?.trim() }" text size="small" :aria-label="'筛选' + col.label" :aria-pressed="!!filters[col.key]?.trim()" @click.stop><ElIcon><Filter /></ElIcon></ElButton></template>
            </ElPopover>
          </template>
        </template>
        <template #default="{ row }">
          <ElButton v-if="col.key === detailColumn && detailValue(row, col.key)" class="cell-link" link type="primary" :data-guide-action="detailGuideAction"
            @click.stop="emit('open-detail', row as TRow)">{{ detailValue(row, col.key) }}</ElButton>
          <slot v-else name="cell" :row="row as TRow" :column="col" :value="formatVisibleDateTime(valueAt(row, col.key), col.key)">
            {{ formatVisibleDateTime(valueAt(row, col.key), col.key) ?? "—" }}
          </slot>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="$slots.actions" label="操作" fixed="right" :min-width="80"
        :width="pref.widths.__actions || actionsWidth" resizable>
        <template #default="{ row }"><slot name="actions" :row="row as TRow" /></template>
      </ElTableColumn>
      <template #empty>
        <ElEmpty :description="hasActiveFilters ? '没有符合筛选条件的记录' : '暂无记录'" :image-size="76">
          <ElButton v-if="hasActiveFilters" size="small" @click="clearFilters">清除筛选条件</ElButton>
        </ElEmpty>
      </template>
    </ElTable>
    <ElDialog v-model="settings" title="自定义表格列" width="500px" append-to-body
      @opened="startColumnDrag" @closed="stopColumnDrag">
      <p class="muted">拖动左侧手柄排序，或聚焦手柄后按上下方向键、Home / End。设置自动保存。</p>
      <div ref="settingsList" class="column-settings-list">
      <div v-for="(col, i) in orderedColumns" :key="col.key" :data-column-key="col.key" class="column-setting-item">
        <ElButton class="column-drag-handle" text size="small" :aria-label="'调整' + col.label + '顺序'"
          title="拖动排序，或使用上下方向键" @keydown="reorderByKeyboard($event, col.key, i)"><ElIcon><Rank /></ElIcon></ElButton>
        <ElCheckbox :model-value="col.hideable === false || !pref.hidden.includes(col.key)" :disabled="col.hideable === false || (shownColumns.length === 1 && !pref.hidden.includes(col.key))"
          @change="show(col.key, Boolean($event))">{{ col.label }}</ElCheckbox>
        <div class="column-setting-actions"><ElButton text size="small" @click="toggleFixed(col.key)">{{ pref.fixed.includes(col.key) ? '取消固定' : '固定列' }}</ElButton></div>
      </div>
      </div>
      <p class="column-order-announcement" aria-live="polite">{{ announcement }}</p>
      <template #footer><ElButton @click="reset">恢复默认</ElButton><ElButton type="primary" @click="settings = false">完成</ElButton></template>
    </ElDialog>
  </div>
</template>
<style scoped>
.business-table-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;min-height:30px}
.business-table-state{display:flex;align-items:center;flex-wrap:wrap;gap:10px;min-width:0}
.business-table-row-count{font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted)}
.business-column-setting-trigger{flex-shrink:0}
.business-column-title{font-weight:600;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto}
.business-table-grid :deep(.el-table__header-wrapper th .cell) {
  white-space:nowrap;display:flex;align-items:center;flex-wrap:nowrap;min-width:0;
}
.business-table-grid :deep(.el-table__header-wrapper th .caret-wrapper) {flex:none}
.business-table-grid :deep(.el-table__header-wrapper th .cell .business-filter-button) {flex:none}
.business-filter-button{padding:2px 5px;margin-left:4px;vertical-align:middle;color:var(--muted);border-radius:6px}
.business-filter-button.is-active-filter{color:var(--brand-primary);background:var(--brand-soft)}
.business-table-grid :deep(.el-table__body tr:hover > td.el-table__cell){transition:background-color .12s ease}
.column-settings-list{max-height:55vh;overflow:auto}
.column-setting-item{display:flex;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--edge)}
.column-setting-actions{display:flex;margin-left:auto}
.column-drag-handle{cursor:grab;touch-action:none}
.column-drag-handle:active{cursor:grabbing}
.column-drag-ghost{opacity:.45;background:var(--el-color-primary-light-9)}
.column-order-announcement{font-size:12px;color:var(--muted);min-height:18px}
.column-setting-actions .el-button+.el-button{margin-left:0}
</style>
