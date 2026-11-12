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
  loading = ref(false);
const chosen = ref<Record<string, EquipmentRecord>>({}),
  pasted = ref(""),
  issues = ref<{ id: string; number: string; result: string }[]>([]);
let sequence = 0;
const reference = computed(() =>
  kind.value === "span"
    ? "spans"
    : kind.value === "physical_tower" && !line.value
      ? "physical"
      : "towers",
);
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
function key(row: EquipmentRecord) {
  return (
    kind.value +
    "/" +
    (kind.value === "physical_tower" && reference.value === "towers"
      ? row.physical_tower_id
      : row.id)
  );
}
const available = computed(() =>
  rows.value.filter((row) => !excluded.value.has(key(row))),
);
const columns = [
  {
    key: "selected",
    label: "选择",
    sortable: false,
    filterable: false,
    minWidth: 85,
  },
  { key: "label", label: "作业设备", minWidth: 240 },
  { key: "tower_no", label: "杆号或档距", minWidth: 150 },
  { key: "line_name", label: "所属线路", minWidth: 180 },
];
watch(
  () => props.open,
  (open) => {
    if (open) {
      chosen.value = {};
      pasted.value = "";
      issues.value = [];
      kind.value =
        props.operation.work_target_type === "physical"
          ? "physical_tower"
          : props.operation.default_location_kind === "span"
            ? "span"
            : "logical_tower";
      void load();
    }
  },
);
watch([line, kind], () => {
  page.value = 1;
  void load();
});
function parameters(currentPage: number, search = query.value) {
  return new URLSearchParams({
    page: String(currentPage),
    page_size: "100",
    q: search,
    line_id: line.value || "",
    filters: JSON.stringify({ status: "active" }),
    deleted: "false",
  });
}
async function load() {
  if (!props.open) return;
  const seq = ++sequence;
  loading.value = true;
  try {
    const result = await api<Page<EquipmentRecord>>(
      "/catalog/" + reference.value + "?" + parameters(page.value),
    );
    if (seq === sequence) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (failure) {
    ElMessage.error((failure as Error).message);
  } finally {
    if (seq === sequence) loading.value = false;
  }
}
function choose(row: EquipmentRecord, selected: boolean) {
  const id = key(row);
  if (excluded.value.has(id)) return;
  if (selected)
    chosen.value[id] = {
      ...row,
      code: kind.value,
      line_id: row.line_id || line.value || undefined,
    };
  else delete chosen.value[id];
}
async function filteredRows(search = query.value) {
  const all: EquipmentRecord[] = [];
  for (let currentPage = 1; ; currentPage++) {
    const response = await api<Page<EquipmentRecord>>(
      "/catalog/" + reference.value + "?" + parameters(currentPage, search),
    );
    if (response.total > 5000)
      throw Error("筛选结果超过5000处，请缩小线路或杆号范围");
    all.push(...response.items);
    if (all.length >= response.total) return all;
  }
}
async function selectAll() {
  loading.value = true;
  try {
    for (const row of await filteredRows()) choose(row, true);
  } catch (failure) {
    ElMessage.error((failure as Error).message);
  } finally {
    loading.value = false;
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
      label: row.tower_no || row.label,
      line_name: row.line_name || row.line_id_label || "",
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
          operation.work_target_type === 'line' &&
          operation.allow_tower &&
          operation.allow_span
        "
        v-model="kind"
        ><ElOption label="逻辑杆塔" value="logical_tower" /><ElOption
          label="档距"
          value="span"
      /></ElSelect>
      <ElInput
        v-model="query"
        clearable
        placeholder="搜索杆号或设备"
        @change="
          page = 1;
          load();
        "
      />
      <ElButton @click="available.forEach((row) => choose(row, true))"
        >全选本页</ElButton
      ><ElButton :loading="loading" @click="selectAll">全选筛选结果</ElButton>
    </div>
    <BusinessTable
      :rows="available"
      :columns="columns"
      table-key="demand:location-picker"
      :loading="loading"
      :max-height="320"
      :actions-width="0"
    >
      <template #cell="{ row, column }"
        ><ElCheckbox
          v-if="column.key === 'selected'"
          :model-value="!!chosen[key(row)]"
          :aria-label="'选择' + row.label"
          @change="choose(row, Boolean($event))"
        /><span v-else-if="column.key === 'tower_no'">{{
          row.tower_no || row.start_tower_no + " ~ " + row.end_tower_no
        }}</span
        ><span v-else-if="column.key === 'line_name'">{{
          row.line_name || row.line_id_label || row.related_lines || "独立实物"
        }}</span
        ><span v-else>{{ row.label }}</span></template
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
          :max-height="180"
          :actions-width="0"
          ><template #cell="{ row, column }">{{
            column.key === "number" ? row.number : row.result
          }}</template></BusinessTable
        >
      </ElCollapseItem></ElCollapse
    >
    <p>已选择 {{ Object.keys(chosen).length }} 处，可切换线路继续选择。</p>
    <div class="chosen-list">
      <ElTag
        v-for="(row, id) in chosen"
        :key="id"
        closable
        @close="delete chosen[id]"
        >{{ row.label }}</ElTag
      >
    </div>
    <template #footer
      ><ElButton @click="chosen = {}">清空选择</ElButton
      ><ElButton @click="emit('update:open', false)">取消</ElButton
      ><ElButton
        type="primary"
        :disabled="!Object.keys(chosen).length"
        @click="add"
        >添加已选位置</ElButton
      ></template
    >
  </ElDialog>
</template>
<style scoped>
.picker-filters {
  flex-wrap: wrap;
}
.picker-filters > * {
  max-width: 260px;
}
.chosen-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  max-height: 100px;
  overflow: auto;
}
</style>
