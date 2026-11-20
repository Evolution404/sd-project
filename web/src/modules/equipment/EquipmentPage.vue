<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { resumeTask } from "../../shared/navigation/business-context";
import { ElMessage, ElMessageBox } from "element-plus";
import type {
  EquipmentCatalogKind,
  EquipmentKind,
  EquipmentRecord,
} from "../../../../server/shared/types/equipment";
import type {
  CatalogFormDefinition,
  CatalogField,
} from "../../../../server/shared/types/catalog";
import type {
  Page,
} from "../../../../server/shared/types/contracts";
import { api, statusText } from "../../shared/api/client";
import { useAccess } from "../../shared/composables/use-access";
import { usePageSelection } from "../../shared/composables/use-page-selection";
import { useListRoute } from "../../shared/composables/use-list-route";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useDescriptionColumns } from "../../shared/composables/use-description-columns";
import BusinessTable, {
  type TableColumn,
} from "../../shared/ui/BusinessTable.vue";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import ExchangePanel from "../exchange/ExchangePanel.vue";
import EquipmentEditor from "./EquipmentEditor.vue";
import EquipmentReplacementDialog from "./EquipmentReplacementDialog.vue";
import { equipmentColumns } from "./columns";
import { towerTypeLabel, towerNatureLabel } from "../../shared/utils/tower-labels.mjs";
const props = withDefaults(defineProps<{ voltage?: boolean }>(), {
  voltage: false,
});
const route = useRoute(),
  router = useRouter(),
  can = useAccess(),
  descriptionColumns = useDescriptionColumns();
const kinds: EquipmentKind[] = ["lines", "physical", "towers", "spans"];
const kind = computed<EquipmentCatalogKind>({
  get: () =>
    props.voltage
      ? "voltages"
      : ((route.params.kind || "lines") as EquipmentKind),
  set: (value) => {
    void router.push({ name: route.name!, params: { kind: value }, query: {} });
  },
});
const definitions = shallowRef<
  Partial<Record<EquipmentCatalogKind, CatalogFormDefinition>>
>({});
const rows = ref<EquipmentRecord[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  sortKey = ref(""),
  sortDirection = ref(""),
  columnFilters = ref<Record<string, string>>({}),
  deleted = ref(false),
  loading = ref(false),
  error = ref("");
const editing = ref<EquipmentRecord | null>(null),
  editorOpen = ref(false),
  replacing = ref(false),
  detail = ref<EquipmentRecord | null>(null),
  history = ref(false);
const fields = computed(() =>
  [
    ...(definitions.value[kind.value]?.rootFields || []),
    ...(definitions.value[kind.value]?.fields || []),
  ].filter(
    (field) =>
      !field.systemManaged &&
      !(kind.value === "towers" && field.key === "sort_rank"),
  ),
);
const columns = computed<TableColumn[]>(() =>
  kind.value === "voltages"
    ? [
        { key: "name", label: "名称", minWidth: 190 },
        { key: "status", label: "状态" },
      ]
    : equipmentColumns[kind.value],
);
const selection = usePageSelection(rows, () => JSON.stringify([kind.value, query.value, deleted.value, columnFilters.value]));
const { selectedIds, selected } = selection;
const appliedQuery = ref("");
let sequence = 0;
async function load() {
  const current = ++sequence,
    requested = kind.value;
  loading.value = true;
  error.value = "";
  const parameters = new URLSearchParams({
    page: String(page.value),
    q: query.value,
    deleted: String(deleted.value),
    sort: sortKey.value || "created_at",
    direction: sortDirection.value || "desc",
    filters: JSON.stringify(columnFilters.value),
  });
  try {
    const result = await api<Page<EquipmentRecord>>(
      `/catalog/${requested}?${parameters}`,
    );
    if (current === sequence && requested === kind.value) {
      appliedQuery.value = parameters.toString();
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (failure) {
    if (current === sequence) error.value = (failure as Error).message;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
const detailDialog = useEntityDialog(
  detail,
  (id) => api<EquipmentRecord>(`/catalog/${kind.value}/${id}?deleted=true`),
  () => {
    editorOpen.value = false;
    replacing.value = false;
    history.value = false;
  },
);
function inspectImport(id: string, importedKind?: EquipmentKind) {
  if (!importedKind) return;
  if (importedKind === kind.value) void detailDialog.open(id);
  else void router.push({ name: "ledger", params: { kind: importedKind }, query: { record: id } });
}
const {
  isOpen: detailOpen,
  loading: detailLoading,
  error: detailError,
} = detailDialog;
async function refresh() {
  await load();
  if (detail.value) {
    const id = detail.value.id;
    const value = await api<EquipmentRecord>(
      `/catalog/${kind.value}/${id}?deleted=true`,
    );
    if (detail.value?.id === id) detail.value = value;
  }
}
function edit(row?: EquipmentRecord) {
  editing.value = row || null;
  editorOpen.value = true;
}
async function remove(row: EquipmentRecord) {
  try {
    const impact = await api<{ expected_version: number; references: {lines: number; towers: number; spans: number; locations: number} }>(
      `/catalog/${kind.value}/${row.id}/deletion-impact`);
    const { lines, towers, spans, locations } = impact.references;
    await ElMessageBox.confirm(
      `当前关联线路 ${lines} 条、逻辑杆塔 ${towers} 基、档距 ${spans} 条、正式需求位置 ${locations} 处。删除后保留已有引用与历史，并停止新增选用。`,
      "确认删除",
      { type: "warning" },
    );
    await api(`/catalog/${kind.value}/${row.id}`, "DELETE", {
      expected_version: impact.expected_version, expected_references: impact.references,
    });
    await refresh();
  } catch (failure) {
    if (failure instanceof Error) ElMessage.error(failure.message);
  }
}
async function viewHistory(row: EquipmentRecord) {
  if (detail.value?.id !== row.id) await detailDialog.open(row.id);
  if (detail.value?.id !== row.id) return;
  history.value = true;
}
function cell(row: EquipmentRecord, column: TableColumn): unknown {
  const value = row[column.key as keyof EquipmentRecord];
  if (column.key === "tower_material") return row.tower_material_label || towerTypeLabel(value);
  if (column.key === "tower_nature") return row.tower_nature_label || towerNatureLabel(value);
  if (value === null || value === undefined || value === "") return "—";
  if (
    column.key === "height_scaled" ||
    column.key === "transmission_center_length_mm"
  )
    return Number(value) / (column.key === "height_scaled" ? 10000 : 1000);
  const field = fields.value.find((field) => field.key === column.key);
  if (
    field?.type === "select" ||
    ["tower_nature", "line_kind"].includes(column.key)
  )
    return statusText[String(value)] || value;
  if (field?.type === "ref")
    return (
      row[(column.key + "_label") as keyof EquipmentRecord] || "历史关联对象"
    );
  return value;
}
function display(field: CatalogField): unknown {
  return detail.value
    ? cell(detail.value, { key: field.key, label: field.label })
    : "—";
}
function tableSort(value: { key: string; order: string }) {
  sortKey.value = value.key;
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  void load();
}
function tableFilter(values: Record<string, string>) {
  columnFilters.value = values;
  page.value = 1;
  void load();
}
function clearSearch() {
  query.value = "";
  columnFilters.value = {};
  page.value = 1;
  void load();
}
watch(kind, () => {
  appliedQuery.value = "";
  rows.value = [];
  history.value = false;
  void load();
});
useListRoute(
  {
    q: query,
    page,
    deleted,
    sort: sortKey,
    direction: sortDirection,
    filters: columnFilters,
  },
  load,
);
const returnToDemand = computed(() =>
  typeof route.query.record === "string" &&
  typeof route.query.returnTo === "string" &&
  route.query.returnTo.startsWith("/demands") ? route.query.returnTo : null);
watch(() => [kind.value, route.query.record, route.query.history], async () => {
  const id = route.query.record;
  if (typeof id !== "string" || !id) return;
  await detailDialog.open(id);
  if (route.query.history === "true" && detail.value?.id === id)
    await viewHistory(detail.value);
}, { immediate: true, flush: "post" });
onMounted(async () => {
  try {
    definitions.value = await api("/catalogs");
    await load();
  } catch (failure) {
    error.value = (failure as Error).message;
  }
});
</script>
<template>
  <div class="page-heading">
    <div>
      <h1>{{ voltage ? "基础数据" : "输电设备台账" }}</h1>
      <p>
        {{
          voltage
            ? "电压等级与正式更正历史"
            : "线路、逻辑位置与物理杆塔的完整台账"
        }}
      </p>
    </div>

  </div>
  <ElTabs v-if="!voltage" v-model="kind"
    ><ElTabPane
      v-for="key in kinds"
      :key="key"
      :name="key"
      :label="definitions[key]?.title || key"
  /></ElTabs>
  <slot v-else name="tabs" />
  <ElAlert v-if="error" :title="error" type="error" :closable="false"
    ><ElButton @click="load">重试</ElButton></ElAlert
  >
  <div class="panel">

    <BusinessTable detail-fallback-key="label" :detail-column="kind === 'physical' ? 'asset_no' : kind === 'towers' ? 'tower_no' : kind === 'spans' ? 'start_tower_no' : 'name'" @open-detail="detailDialog.open($event.id)"
      :rows="rows"
      :columns="columns"
      :table-key="'catalog:' + kind"
      :loading="loading"
      :filter-state="columnFilters"
      :search-active="!!query"
      :sort-state="{
        prop: sortKey,
        order: sortKey
          ? sortDirection === 'asc'
            ? 'ascending'
            : 'descending'
          : null,
      }"
      :selectable="!voltage"
      :actions-width="180"
      @clear-search="clearSearch"
      :selected-ids="selectedIds" @selection-change="selection.updatePage"
      @sort-change="tableSort"
      @filter-change="tableFilter"
    >
      <template #toolbar="{ openSettings, clearFilters, hasActiveFilters }">
        <div v-if="selected.length" class="toolbar selection-toolbar" aria-label="设备批量操作">
          <span role="status">已选 {{ selected.length }} 条</span>
          <ExchangePanel kind="assets" :asset-kind="kind === 'voltages' ? undefined : kind"
            :selected-ids="selectedIds" :applied-query="appliedQuery" @changed="load" @inspect="inspectImport" />
          <ElButton link @click="selection.clear">清空选择</ElButton>
          <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
        </div>
        <div v-else class="unified-list-tools">
          <div class="toolbar">
            <ElInput
        v-model="query"
        clearable
        placeholder="搜索名称或真实属性"
        @change="
          page = 1;
          load();
        "
      />
            <ElPopover trigger="click" placement="bottom-start">
              <template #reference><ElButton>筛选</ElButton></template>
              <ElCheckbox data-guide-action="ledger.show-deleted"
        v-model="deleted"
        @change="
          page = 1;
          load();
        "
        >包含已删除</ElCheckbox
      >
            </ElPopover>
            <ElButton v-if="hasActiveFilters" link type="primary" @click="clearFilters">清除检索与列筛选</ElButton>
          </div>
          <div class="toolbar page-heading-actions">
      <ElButton :loading="loading" @click="load">刷新</ElButton>
      <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
      <ExchangePanel
        v-if="!voltage"
        kind="assets"
        :applied-query="appliedQuery"
        :asset-kind="kind === 'voltages' ? undefined : kind"
        :selected-ids="selectedIds"
        @changed="load" @inspect="inspectImport"
      />
      <ElButton :data-guide-action="kind === 'physical' ? 'ledger.physical' : kind === 'towers' ? 'ledger.logical' : kind === 'spans' ? 'ledger.span' : voltage ? 'dictionaries.voltage' : 'ledger.line'" v-if="can('admin') && definitions[kind]" type="primary" @click="edit()"
        >新增{{ definitions[kind]?.title }}</ElButton
      >
    </div>
        </div>
      </template>
      <template #cell="{ row, column }"
        ><ElTag
          v-if="column.key === 'status'"
          :type="
            row.deleted
              ? 'danger'
              : row.status === 'active'
                ? 'success'
                : 'info'
          "
          effect="plain"
          >{{ row.deleted ? "已删除" : cell(row, column) }}</ElTag
        ><span v-else>{{ cell(row, column) }}</span></template
      >
 </BusinessTable
    ><ElPagination
      v-model:current-page="page"
      :page-size="30"
      :total="total"
      layout="prev,pager,next,total"
      @current-change="load"
    />
  </div>
  <BusinessDetailDialog
    :open="detailOpen"
    :title="(definitions[kind]?.title || '设备') + '详情'"
    :loading="detailLoading"
    :error="detailError"
    @close="detailDialog.close"
    @retry="detailDialog.reload"
  >
    <template v-if="detail"
      ><div class="detail-header">
        <h1>{{ detail.label }}</h1>
        <ElTag>{{
          detail.deleted ? "已删除" : statusText[detail.status]
        }}</ElTag>
      </div>
      <div class="toolbar">
        <ElButton v-if="returnToDemand" link type="primary"
          @click="resumeTask(router, returnToDemand)">返回需求详情</ElButton>
        <ElButton data-guide-action="ledger.edit"
          v-if="can('admin') && (!detail.deleted || !voltage)"
          @click="edit(detail)"
          >{{ detail.deleted ? "更正历史" : "编辑" }}</ElButton
        ><ElButton data-guide-action="ledger.history" @click="viewHistory(detail)">完整历史</ElButton
        ><ElButton
          v-if="
            kind === 'physical' &&
            detail.status !== 'retired' &&
            !detail.deleted
          "
          :disabled="!can('admin')"
          data-guide-action="ledger.replace" @click="replacing = true"
          >整基更换</ElButton
        ><ElButton data-guide-action="ledger.delete"
          type="danger"
          v-if="can('admin') && !detail.deleted"
          @click="remove(detail)"
          >删除</ElButton
        >
      </div>
      <div class="panel">
        <h2>正式定义</h2>
        <ElDescriptions :column="descriptionColumns" border
          ><ElDescriptionsItem
            v-for="field in fields"
            :key="field.key"
            :label="field.label"
            >{{ display(field) }}</ElDescriptionsItem
          ><ElDescriptionsItem v-if="kind === 'towers'" label="杆塔性质">{{
            statusText[detail.tower_nature || ""] || "未填写"
          }}</ElDescriptionsItem></ElDescriptions
        >
      </div>
      <div v-if="kind === 'physical'" class="panel">
        <div class="subheading">
          关联逻辑杆塔（{{ detail.bindings?.length || 0 }}）
        </div>
        <BusinessTable
          client-side
          table-key="physical:bindings"
          :rows="detail.bindings || []"
          :columns="[
            { key: 'line_name', label: '线路', minWidth: 170 },
            { key: 'voltage_name', label: '电压等级' },
            { key: 'tower_no', label: '逻辑杆塔号' },
            { key: 'logical_status', label: '状态' },
          ]"
          ><template #cell="{ row: link, column, value }"
            ><ElTag v-if="column.key === 'logical_status'" effect="plain">{{
              link.logical_deleted ? "已删除" : statusText[link.logical_status]
            }}</ElTag
            ><span v-else>{{ value ?? "—" }}</span></template
          ></BusinessTable
        >
      </div>
      <div v-if="history" class="panel">
        <h2>完整版本与审计历史</h2>
        <BusinessHistory reveal :record-kind="kind" :record-id="detail.id" />
      </div>
    </template>
  </BusinessDetailDialog>
  <EquipmentEditor
    v-model:open="editorOpen"
    :kind="kind"
    :definition="definitions[kind]"
    :physical-definition="definitions.physical"
    :editing="editing"
    :refresh="refresh"
  />
  <EquipmentReplacementDialog
    v-model:open="replacing"
    :physical="detail"
    :definition="definitions.physical"
    :refresh="refresh"
  />
</template>
