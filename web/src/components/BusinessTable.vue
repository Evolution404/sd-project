<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue";
import { Setting, Filter } from "@element-plus/icons-vue";
import type { Row } from "../services/api";
export type TableColumn = { key: string; label: string; minWidth?: number; sortable?: boolean; filterable?: boolean };
const props = withDefaults(defineProps<{
  rows: Row[]; columns: TableColumn[]; tableKey: string;
  selectable?: boolean; loading?: boolean; actionsWidth?: number;
  clientSide?: boolean;
}>(), { selectable: false, loading: false, actionsWidth: 260 });
const emit = defineEmits<{
  (e: "selection-change", rows: Row[]): void;
  (e: "sort-change", value: { key: string; order: string }): void;
  (e: "filter-change", filters: Record<string, string>): void;
}>();
type Pref = { order: string[]; hidden: string[]; fixed: string[]; widths: Record<string, number> };
function readPref(): Pref {
  try {
    const saved = JSON.parse(localStorage.getItem("sd-columns:" + props.tableKey) || "{}");
    return {
      order: Array.isArray(saved.order) ? saved.order : [],
      hidden: Array.isArray(saved.hidden) ? saved.hidden : [],
      fixed: Array.isArray(saved.fixed) ? saved.fixed : [],
      widths: saved.widths || {},
    };
  } catch { return { order: [], hidden: [], fixed: [], widths: {} }; }
}
const pref = ref<Pref>({ order: [], hidden: [], fixed: [], widths: {} });
const filters = ref<Record<string, string>>({});
const localSort = ref({ key: "", order: "" });
const tableRows = computed(() => {
  if (!props.clientSide) return props.rows;
  const activeFilters = Object.entries(filters.value).filter(([, value]) => !!value?.trim());
  const result = props.rows.filter(row => activeFilters.every(([key, value]) =>
    String(row[key] ?? "").toLocaleLowerCase("zh-CN").includes(value.trim().toLocaleLowerCase("zh-CN"))));
  const { key, order } = localSort.value;
  if (key && order) result.sort((a, b) => {
    const va = a[key], vb = b[key];
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
const orderedColumns = computed(() => {
  const keys = [...new Set([...pref.value.order, ...props.columns.map(c => c.key)])];
  return keys.map(key => props.columns.find(c => c.key === key)).filter((v): v is TableColumn => !!v);
});
const shownColumns = computed(() => orderedColumns.value.filter(c => !pref.value.hidden.includes(c.key)));
function persist() {
  localStorage.setItem("sd-columns:" + props.tableKey, JSON.stringify(pref.value));
}
function show(key: string, value: boolean) {
  pref.value.hidden = value ? pref.value.hidden.filter(k => k !== key) : [...pref.value.hidden, key];
  persist();
}
function toggleFixed(key: string) {
  pref.value.fixed = pref.value.fixed.includes(key)
    ? pref.value.fixed.filter(item => item !== key)
    : [...pref.value.fixed, key];
  persist();
}
function move(key: string, delta: number) {
  const keys = orderedColumns.value.map(c => c.key);
  const i = keys.indexOf(key), next = i + delta;
  if (next < 0 || next >= keys.length) return;
  [keys[i], keys[next]] = [keys[next]!, keys[i]!];
  pref.value.order = keys;
  persist();
}
function resize(newWidth: number, _oldWidth: number, column: { property?: string }) {
  if (!column.property) return;
  pref.value.widths = { ...pref.value.widths, [column.property]: newWidth };
  persist();
}
function reset() {
  pref.value = { order: [], hidden: [], fixed: [], widths: {} };
  filters.value = {};
  localSort.value = { key: "", order: "" };
  persist();
  if (!props.clientSide) emit("filter-change", {});
}
function filter() {
  if (!props.clientSide)
    emit("filter-change", Object.fromEntries(Object.entries(filters.value).filter(([, value]) => value.trim())));
}
function handleSort(value: { prop?: string | null; order?: string | null }) {
  const sort = { key: value.prop || "", order: value.order || "" };
  if (props.clientSide) localSort.value = sort;
  else emit("sort-change", sort);
}
onMounted(() => { pref.value = readPref(); });
watch(() => props.tableKey, () => { pref.value = readPref(); filters.value = {}; localSort.value = { key: "", order: "" }; });
</script>
<template>
  <div class="business-table">
    <div class="business-table-tools">
      <span class="business-table-hint">点击表头排序，按列筛选</span>
      <ElButton size="small" text @click="settings = true"><ElIcon><Setting /></ElIcon> 列设置</ElButton>
    </div>
    <ElTable :data="tableRows" :row-key="(row: Row) => String(row.id || row.code || row.name || row.month || row.quarter || row.created_at || JSON.stringify(row))" v-loading="loading"
      table-layout="fixed" class="business-table-grid"
      @selection-change="emit('selection-change', $event)"
      @sort-change="handleSort"
      @header-dragend="resize">
      <ElTableColumn v-if="selectable" type="selection" width="48" fixed="left" />
      <ElTableColumn v-if="$slots.expand" type="expand" width="50">
        <template #default="{ row }"><slot name="expand" :row="row" /></template>
      </ElTableColumn>
      <ElTableColumn v-for="col in shownColumns" :key="col.key" :prop="col.key" :label="col.label"
        :min-width="col.minWidth || 130" :width="pref.widths[col.key] || undefined"
        :sortable="col.sortable === false ? false : 'custom'"
        :fixed="pref.fixed.includes(col.key) ? 'left' : false" resizable show-overflow-tooltip>
        <template #header>
          <span class="business-column-title">{{ col.label }}</span>
          <ElPopover v-if="col.filterable !== false" trigger="click" width="220" placement="bottom">
            <ElInput v-model="filters[col.key]" clearable size="small" :placeholder="'筛选' + col.label" @change="filter" @clear="filter" />
            <template #reference><ElButton class="business-filter-button" text size="small" :aria-label="'筛选' + col.label" @click.stop><ElIcon><Filter /></ElIcon></ElButton></template>
          </ElPopover>
        </template>
        <template #default="{ row }"><slot name="cell" :row="row" :column="col">{{ row[col.key] ?? "—" }}</slot></template>
      </ElTableColumn>
      <ElTableColumn v-if="$slots.actions" label="操作" fixed="right" :min-width="actionsWidth">
        <template #default="{ row }"><slot name="actions" :row="row" /></template>
      </ElTableColumn>
    </ElTable>
    <ElDialog v-model="settings" title="自定义表格列" width="500px" append-to-body>
      <p class="muted">选择显示列、固定列和调整顺序；拖动表头边界调整列宽，所有设置自动保存。</p>
      <div v-for="(col, i) in orderedColumns" :key="col.key" class="column-setting-item">
        <ElCheckbox :model-value="!pref.hidden.includes(col.key)" :disabled="shownColumns.length === 1 && !pref.hidden.includes(col.key)"
          @change="show(col.key, Boolean($event))">{{ col.label }}</ElCheckbox>
        <div class="column-setting-actions"><ElButton text size="small" @click="toggleFixed(col.key)">{{ pref.fixed.includes(col.key) ? '取消固定' : '固定列' }}</ElButton><ElButton text size="small" :disabled="i === 0" @click="move(col.key, -1)">上移</ElButton><ElButton text size="small" :disabled="i === orderedColumns.length - 1" @click="move(col.key, 1)">下移</ElButton></div>
      </div>
      <template #footer><ElButton @click="reset">恢复默认</ElButton><ElButton type="primary" @click="settings = false">完成</ElButton></template>
    </ElDialog>
  </div>
</template>
<style scoped>
.business-table-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.business-table-hint{color:var(--muted);font-size:12px}
.business-column-title{font-weight:600}
.business-filter-button{padding:2px 5px;margin-left:4px;vertical-align:middle;color:var(--muted)}
.column-setting-item{display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--edge)}
.column-setting-actions{display:flex}
.column-setting-actions .el-button+.el-button{margin-left:0}
</style>
