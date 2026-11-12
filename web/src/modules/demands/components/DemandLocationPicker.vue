<script setup lang="ts">
import { newClientId } from "../../../shared/utils/id";
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import type { OperationRecord } from "../../../../../server/shared/types/work-standards";
import type { EquipmentRecord } from "../../../../../server/shared/types/equipment";
import type { Page } from "../../../../../server/shared/types/contracts";
import type { DemandLocationKind } from "../../../../../server/shared/types/demands";
import type { LocationDraft } from "../types/demand";
import { api } from "../../../shared/api/client";
import BusinessTable from "../../../shared/ui/BusinessTable.vue";
import FieldControl from "../../../shared/ui/FieldControl.vue";
import { parseTowerList } from "../composables/location-selection";
import {
  equipmentLocationColumns,
  equipmentLocationPreferenceKey,
  equipmentLocationQueryKind,
  equipmentLocationDisplay,
} from "../composables/equipment-location-columns";
const props = defineProps<{
  open: boolean;
  operation: OperationRecord;
  existing: LocationDraft[];
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  add: [rows: LocationDraft[]];
}>();
const line = ref<string | null>(null),
  kind = ref<DemandLocationKind>("logical_tower"),
  query = ref(""),
  page = ref(1),
  total = ref(0),
  rows = ref<EquipmentRecord[]>([]),
  loading = ref(false),
  bulkLoading = ref(false),
  appliedSearch = ref(""),
  sortKey = ref(""),
  sortDirection = ref<"asc" | "desc">("desc"),
  columnFilters = ref<Record<string, string>>({});
const chosen = ref<Record<string, EquipmentRecord>>({}),
  pasted = ref(""),
  issues = ref<{ id: string; number: string; result: string }[]>([]);
let sequence = 0;
// One record = one business identity: line filters must not swap physical
// towers for logical tower rows (one physical tower can carry many circuits).
const reference = computed(() => equipmentLocationQueryKind(kind.value, line.value));
const excluded = computed(
  () =>
    new Set(
      props.existing.map(
        (row) =>
          row.location_kind +
          "/" +
          (row.logical_tower_id || row.physical_tower_id || row.span_id),
      ),
    ),
);
type SelectionContext = {
  kind: DemandLocationKind;
  reference: string;
  lineId: string | null;
  search: string;
};
function context(): SelectionContext {
  return {
    kind: kind.value,
    reference: reference.value,
    lineId: line.value,
    search: appliedSearch.value,
  };
}
function identity(row: EquipmentRecord, current: SelectionContext = context()) {
  return current.kind + "/" +
    (current.kind === "physical_tower" && current.reference === "towers"
      ? row.physical_tower_id
      : row.id);
}
function key(row: EquipmentRecord) { return identity(row); }
const available = computed(() =>
  rows.value.filter((row) => !excluded.value.has(key(row))),
);
const selectedCount = computed(() => Object.keys(chosen.value).length);
// Thousands of selected rows must not create thousands of label nodes.
const selectedPreview = computed(() => Object.entries(chosen.value)
  .slice(0, 30).map(([id, row]) => ({ id, row })));
const selectedOnPage = computed(() =>
  available.value.filter((row) => Boolean(chosen.value[key(row)])).length,
);
const pageAllSelected = computed(() =>
  available.value.length > 0 && selectedOnPage.value === available.value.length,
);
const pagePartiallySelected = computed(() =>
  selectedOnPage.value > 0 && !pageAllSelected.value,
);
function changePageSelection(selected: boolean) {
  if (loading.value || bulkLoading.value) return;
  if (selected && props.existing.length + selectedCount.value +
      available.value.filter((row) => !chosen.value[key(row)]).length > 5000) {
    ElMessage.warning("一条需求最多5000处作业位置，请先取消部分选择");
    return;
  }
  for (const row of available.value) choose(row, selected);
}
let selectionEpoch = 0;
function invalidateBulkSelection() {
  selectionEpoch++;
  bulkLoading.value = false;
}
function applySearch() {
  const next = query.value.trim();
  if (next !== appliedSearch.value) appliedSearch.value = next;
  else {
    page.value = 1;
    void load();
  }
}
const columns = computed(() => equipmentLocationColumns(kind.value));
function tableSort(value: { key: string; order: string }) {
  const selected = columns.value.find(col => col.key === value.key);
  sortKey.value = value.order && selected?.sortable ? selected.sortKey || "" : "";
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  void load();
}
function tableFilter(values: Record<string, string>) {
  const valid = new Map(columns.value
    .filter(col => col.filterable && col.filterKey)
    .map(col => [col.key, col.filterKey!]));
  columnFilters.value = Object.fromEntries(Object.entries(values)
    .filter(([key, value]) => valid.has(key) && value.trim())
    .map(([key, value]) => [valid.get(key)!, value]));
  page.value = 1;
  void load();
}
watch(
  () => props.open,
  (open) => {
    invalidateBulkSelection();
    if (open) {
      chosen.value = {};
      pasted.value = "";
      issues.value = [];
      line.value = null;
      query.value = "";
      appliedSearch.value = "";
      sortKey.value = "";
      sortDirection.value = "desc";
      columnFilters.value = {};
      page.value = 1;
      kind.value =
        props.operation.attribution_unit === "physical_tower"
          ? "physical_tower" : "logical_tower";
      void load();
    }
  },
);
watch(kind, () => {
  sortKey.value = "";
  sortDirection.value = "desc";
  columnFilters.value = {};
});
watch([line, kind, appliedSearch], () => {
  invalidateBulkSelection();
  page.value = 1;
  void load();
});
function parameters(
  currentPage: number,
  current: SelectionContext = context(),
  search = current.search,
) {
  return new URLSearchParams({
    page: String(currentPage),
    page_size: "100",
    q: search,
    line_id: current.lineId || "",
    sort: sortKey.value || "created_at",
    direction: sortDirection.value,
    filters: JSON.stringify({ status: "active", ...columnFilters.value }),
    deleted: "false",
  });
}
async function load() {
  if (!props.open) return;
  const seq = ++sequence, selection = context();
  loading.value = true;
  // Remove stale rows, but preserve the pagination total while loading:
  // resetting total to zero makes Element Plus jump from page 2 to page 1.
  rows.value = [];
  try {
    const result = await api<Page<EquipmentRecord>>(
      "/catalog/" + selection.reference + "?" + parameters(page.value, selection),
    );
    if (seq === sequence && props.open) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (failure) {
    if (seq === sequence) ElMessage.error((failure as Error).message);
  } finally {
    if (seq === sequence) loading.value = false;
  }
}
function choose(row: EquipmentRecord, selected: boolean, selection = context()) {
  const id = identity(row, selection);
  if (excluded.value.has(id)) return;
  if (selected && !chosen.value[id] &&
      props.existing.length + selectedCount.value >= 5000) {
    ElMessage.warning("一条需求最多5000处作业位置，请先取消部分选择");
    return;
  }
  if (selected)
    chosen.value[id] = {
      ...row,
      code: selection.kind,
      line_id: row.line_id || selection.lineId || undefined,
    };
  else delete chosen.value[id];
}
async function filteredRows(search = appliedSearch.value, selection = context()) {
  const all: EquipmentRecord[] = [];
  for (let currentPage = 1; ; currentPage++) {
    const response = await api<Page<EquipmentRecord>>(
      "/catalog/" + selection.reference + "?" +
        parameters(currentPage, selection, search),
    );
    if (response.total > 5000)
      throw Error("筛选结果超过5000处，请缩小线路或杆号范围");
    all.push(...response.items);
    if (all.length >= response.total) return all;
  }
}
/** Bulk actions are transactional in the UI: fetch/validate first, mutate once. */
async function changeFilteredSelection(selected: boolean) {
  if (bulkLoading.value || loading.value) return;
  const seq = ++selectionEpoch, current = context();
  bulkLoading.value = true;
  try {
    const candidates = await filteredRows(current.search, current);
    // An in-flight request must not apply results after a filter change or close.
    if (seq !== selectionEpoch || !props.open ||
        JSON.stringify(current) !== JSON.stringify(context())) return;
    const unique = new Map<string, EquipmentRecord>();
    for (const row of candidates) {
      const id = identity(row, current);
      if (!excluded.value.has(id)) unique.set(id, row);
    }
    if (selected) {
      const pending = [...unique.keys()].filter((id) => !chosen.value[id]);
      if (props.existing.length + selectedCount.value + pending.length > 5000) {
        ElMessage.warning("选择后将超过每条需求5000处位置上限，已保留原有选择");
        return;
      }
    }
    let changed = 0;
    for (const [id, row] of unique) {
      if (Boolean(chosen.value[id]) === selected) continue;
      choose(row, selected, current);
      changed++;
    }
    ElMessage.success(
      selected ? "已新增选择 " + changed + " 处筛选结果"
        : "已取消 " + changed + " 处筛选结果的选择",
    );
  } catch (failure) {
    if (seq === selectionEpoch) ElMessage.error((failure as Error).message);
  } finally {
    if (seq === selectionEpoch) bulkLoading.value = false;
  }
}
async function paste() {
  if (!line.value) {
    ElMessage.warning("粘贴杆号前请选择所属线路，避免跨线路同号歧义");
    return;
  }
  loading.value = true;
  try {
    const candidates = await filteredRows(""),
      tokens =
        kind.value === "span"
          ? pasted.value.split(/[\s,，、]+/).filter(Boolean)
          : parseTowerList(pasted.value);
    const seen = new Set<string>();
    issues.value = [];
    for (const number of tokens) {
      const matches = candidates.filter((row) =>
        kind.value === "span"
          ? row.start_tower_no + "~" + row.end_tower_no === number
          : kind.value === "physical_tower"
            ? (row.bindings || []).some(binding =>
                binding.line_id === line.value &&
                binding.logical_status !== "retired" &&
                !binding.logical_deleted &&
                binding.tower_no === number)
            : row.tower_no === number,
      );
      let result = "匹配成功";
      if (seen.has(number)) result = "清单重复";
      else if (!matches.length) result = "台账不存在或位置类型不适用";
      else if (matches.length > 1) result = "名称歧义，须核实";
      else if (
        excluded.value.has(key(matches[0])) ||
        chosen.value[key(matches[0])]
      )
        result = "已选择或重复";
      else choose(matches[0], true);
      seen.add(number);
      issues.value.push({ id: newClientId(), number, result });
    }
  } catch (failure) {
    ElMessage.error((failure as Error).message);
  } finally {
    loading.value = false;
  }
}
function add() {
  const selected = Object.values(chosen.value).map((row): LocationDraft => {
    const selectedKind = row.code as DemandLocationKind;
    const physical =
      selectedKind === "physical_tower"
        ? row.physical_tower_id || row.id
        : undefined;
    return {
      id: newClientId(),
      label: selectedKind === "physical_tower"
        ? row.asset_no || row.tower_code ||
            equipmentLocationDisplay(selectedKind, row, "related_towers").toString()
        : selectedKind === "span"
          ? equipmentLocationDisplay(selectedKind, row, "span").toString()
          : equipmentLocationDisplay(selectedKind, row, "tower_no").toString(),
      line_name: row.line_name || row.related_lines || row.line_id_label || "",
      location_kind: selectedKind,
      logical_tower_id: selectedKind === "logical_tower" ? row.id : undefined,
      physical_tower_id: physical,
      span_id: selectedKind === "span" ? row.id : undefined,
      context_line_id: selectedKind === "physical_tower" ? row.line_id : null,
      quantity_scaled: props.operation.default_quantity_scaled || 10000,
      work_mode: "unspecified",
      attributes: Object.fromEntries(
        JSON.parse(props.operation.attributes_schema_json)
          .filter(
            (field: {
              scope: string;
              source: string;
              default_value?: unknown;
            }) =>
              field.scope === "location" &&
              field.source === "manual" &&
              field.default_value !== undefined,
          )
          .map((field: { key: string; default_value: unknown }) => [
            field.key,
            field.default_value,
          ]),
      ),
    };
  });
  if (props.existing.length + selected.length > 5000) {
    ElMessage.error("一条需求最多5000处作业位置");
    return;
  }
  emit("add", selected);
  emit("update:open", false);
}
</script>
<template>
  <ElDialog
    :model-value="open"
    title="添加作业位置"
    width="min(1100px,96vw)"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="toolbar picker-filters">
      <FieldControl
        v-model="line"
        :field="{ type: 'ref', reference: 'lines' }"
      />
      <ElSelect
        v-if="
          operation.attribution_unit === 'logical_tower' &&
          operation.object_position === 'corridor'
        "
        v-model="kind"
        ><ElOption label="逻辑杆塔" value="logical_tower" /><ElOption
          label="档距"
          value="span"
      /></ElSelect>
      <ElInput
        v-model="query"
        clearable
        :placeholder="kind === 'span' ? '搜索档距端点' :
          kind === 'physical_tower' ? '搜索资产编号或关联杆号' : '搜索杆号或线路'"
        :disabled="bulkLoading"
        @change="applySearch"
        @keyup.enter="applySearch"
      />
      <div class="picker-bulk-actions">
        <ElButton :loading="bulkLoading" :disabled="loading || !total"
          title="包括当前筛选条件下的所有分页，已添加的位置自动跳过"
          @click="changeFilteredSelection(true)">全选筛选结果</ElButton>
        <ElButton :disabled="loading || bulkLoading || !selectedCount || !total"
          title="仅取消当前线路、位置类型及搜索条件下的选择；不影响其他已选位置"
          @click="changeFilteredSelection(false)">取消筛选结果</ElButton>
      </div>
    </div>
    <p class="picker-select-hint">表头复选框仅控制当前页；筛选结果操作涵盖全部分页，跨页已选位置会保留。</p>
    <BusinessTable
      :rows="available"
      :columns="columns"
      :table-key="equipmentLocationPreferenceKey(kind)"
      :loading="loading"
      :max-height="320"
      :actions-width="0"
      :sort-state="{ prop: sortKey, order: sortKey ?
        (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
      :filter-state="columnFilters"
      @sort-change="tableSort"
      @filter-change="tableFilter"
    >
      <template #header="{ column }">
        <ElCheckbox v-if="column.key === 'selected'"
          :model-value="pageAllSelected"
          :indeterminate="pagePartiallySelected"
          :disabled="loading || bulkLoading || !available.length"
          :aria-label="pageAllSelected ? '取消全选本页' : '全选本页'"
          :title="pageAllSelected ? '取消当前页全部选择' : '选择当前页全部可选位置'"
          @change="changePageSelection(Boolean($event))">{{ pageAllSelected ? "取消本页" : "全选本页" }}</ElCheckbox>
        <span v-else>{{ column.label }}</span>
      </template>
      <template #cell="{ row, column }"
        ><ElCheckbox
          v-if="column.key === 'selected'"
          :model-value="!!chosen[key(row)]"
          :disabled="loading || bulkLoading"
          :aria-label="'选择' + row.label"
          @change="choose(row, Boolean($event))"
        /><span v-else>{{
          equipmentLocationDisplay(kind, row, column.key)
        }}</span></template
      >
    </BusinessTable>
    <ElPagination
      v-model:current-page="page"
      :page-size="100"
      :total="total"
      layout="prev,pager,next,total"
      @current-change="load"
    />
    <ElCollapse
      ><ElCollapseItem title="粘贴杆号清单或连续区间"
        ><ElInput
          v-model="pasted"
          type="textarea"
          :rows="3"
          :placeholder="
            kind === 'span'
              ? '12~13、13~14'
              : '12、13、18-25（按真实台账逐项匹配）'
          "
        /><ElButton @click="paste">匹配并选择</ElButton>
        <BusinessTable
          v-if="issues.length"
          :rows="issues"
          :columns="[
            { key: 'number', label: '原始杆号' },
            { key: 'result', label: '匹配结果' },
          ]"
          table-key="demand:paste-results"
          sort-mode="off" filter-mode="off"
          :max-height="180"
          :actions-width="0"
          ><template #cell="{ row, column }">{{
            column.key === "number" ? row.number : row.result
          }}</template></BusinessTable
        >
      </ElCollapseItem></ElCollapse
    >
    <p class="picker-selection-summary">已选择 {{ selectedCount }} 处，可切换线路继续选择。</p>
    <div class="chosen-list">
      <ElTag
        v-for="item in selectedPreview"
        :key="item.id"
        closable
        @close="delete chosen[item.id]"
        >{{ item.row.label }}</ElTag
      >
      <span v-if="selectedCount > selectedPreview.length" class="picker-select-hint">
        另有 {{ selectedCount - selectedPreview.length }} 处已保留，可通过筛选条件取消勾选。
      </span>
    </div>
    <template #footer
      ><ElButton :disabled="!selectedCount || bulkLoading" @click="chosen = {}">清空全部已选</ElButton
      ><ElButton @click="emit('update:open', false)">取消</ElButton
      ><ElButton data-guide-action="demands.location-select-confirm"
        type="primary"
        :disabled="!selectedCount || loading || bulkLoading"
        @click="add"
        >添加已选位置</ElButton
      ></template
    >
  </ElDialog>
</template>
<style scoped>
.picker-filters {
  flex-wrap: wrap;
  gap: 10px;
}
.picker-filters > * {
  max-width: 260px;
}
.picker-filters .picker-bulk-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: none;
}
.picker-bulk-actions .el-button + .el-button { margin-left: 0; }
.picker-select-hint {
  color: var(--muted);
  font-size: 12px;
  margin: 4px 0 10px;
}
.picker-selection-summary { font-weight: 600; margin: 12px 0 8px; }
@media (max-width: 760px) {
  .picker-filters > * { max-width: 100%; }
  .picker-filters .picker-bulk-actions { flex-wrap: wrap; }
}
.chosen-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  max-height: 100px;
  overflow: auto;
}
</style>
