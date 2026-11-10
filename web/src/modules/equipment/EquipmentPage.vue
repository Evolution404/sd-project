<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import type {
  EquipmentCatalogKind,
  EquipmentKind,
  EquipmentRecord,
} from "../../../../server/shared/types/equipment";
import type {
  CatalogDefinition,
  CatalogField,
} from "../../../../server/shared/types/catalog";
import type {
  JsonValue,
  Page,
} from "../../../../server/shared/types/contracts";
import { api, statusText } from "../../shared/api/client";
import { useAccess } from "../../shared/composables/use-access";
import { useListRoute } from "../../shared/composables/use-list-route";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useDescriptionColumns } from "../../shared/composables/use-description-columns";
import BusinessTable, {
  type TableColumn,
} from "../../shared/ui/BusinessTable.vue";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import RowActions from "../../shared/ui/RowActions.vue";
import ExchangePanel from "../exchange/ExchangePanel.vue";
import EquipmentEditor from "./EquipmentEditor.vue";
import EquipmentReplacementDialog from "./EquipmentReplacementDialog.vue";
import { equipmentColumns } from "./columns";
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
  Partial<Record<EquipmentCatalogKind, CatalogDefinition>>
>({});
const rows = ref<EquipmentRecord[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  sortKey = ref(""),
  sortDirection = ref(""),
  columnFilters = ref<Record<string, string>>({}),
  deleted = ref(false),
  selectedIds = ref<string[]>([]),
  loading = ref(false),
  error = ref("");
const editing = ref<EquipmentRecord | null>(null),
  editorOpen = ref(false),
  replacing = ref(false),
  detail = ref<EquipmentRecord | null>(null),
  history = shallowRef<JsonValue | null>(null);
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
    history.value = null;
  },
);
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
    await ElMessageBox.confirm(
      "删除后从正常列表与新增选择中移除，正式历史和已有引用保留。",
      "确认删除",
      { type: "warning" },
    );
    await api(`/catalog/${kind.value}/${row.id}`, "DELETE", {
      expected_version: row.version,
    });
    await refresh();
  } catch (failure) {
    if (failure instanceof Error) ElMessage.error(failure.message);
  }
}
async function viewHistory(row: EquipmentRecord) {
  if (detail.value?.id !== row.id) await detailDialog.open(row.id);
  if (detail.value?.id !== row.id) return;
  try {
    const value = await api<JsonValue>(
      `/catalog/${kind.value}/history/${row.id}`,
    );
    if (detail.value?.id === row.id) history.value = value;
  } catch (failure) {
    ElMessage.error((failure as Error).message);
  }
}
function cell(row: EquipmentRecord, column: TableColumn): unknown {
  const value = row[column.key as keyof EquipmentRecord];
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
  selectedIds.value = [];
  rows.value = [];
  history.value = null;
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
      <div class="section-caption">
        {{ voltage ? "基础配置" : "设备与物资" }}
      </div>
      <h1>{{ voltage ? "基础数据" : "输电设备台账" }}</h1>
      <p>
        {{
          voltage
            ? "电压等级与正式更正历史"
            : "线路、逻辑位置与物理杆塔的完整台账"
        }}
      </p>
    </div>
    <div class="page-heading-actions">
      <ElButton :disabled="!can('admin') || !definitions[kind]" type="primary" @click="edit()"
        >新增{{ definitions[kind]?.title }}</ElButton
      ><ExchangePanel
        v-if="!voltage"
        kind="assets"
        :query="query"
        :selected-ids="selectedIds"
        @changed="load"
      />
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
    <div class="toolbar">
      <ElInput
        v-model="query"
        clearable
        placeholder="搜索名称或真实属性"
        @change="
          page = 1;
          load();
        "
      /><ElCheckbox
        v-model="deleted"
        @change="
          page = 1;
          load();
        "
        >包含已删除</ElCheckbox
      ><ElButton @click="load">刷新</ElButton
      ><span class="muted">共 {{ total }} 项</span>
    </div>
    <BusinessTable
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
      @selection-change="
        (selected) => (selectedIds = selected.map((row) => String(row.id)))
      "
      @sort-change="tableSort"
      @filter-change="tableFilter"
    >
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
      <template #actions="{ row }"
        ><RowActions
          :actions="[
            { label: '查看', run: () => detailDialog.open(row.id) },
            {
              label: '编辑',
              disabled: !can('admin') || row.deleted,
              run: () => edit(row),
            },
            ...(row.deleted && !voltage
              ? [
                  {
                    label: '更正历史',
                    disabled: !can('admin'),
                    run: () => edit(row),
                  },
                ]
              : []),
            { label: '历史', run: () => viewHistory(row) },
            {
              label: '删除',
              danger: true,
              disabled: !can('admin') || row.deleted,
              run: () => remove(row),
            },
          ]"
      /></template> </BusinessTable
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
        <ElButton
          :disabled="!can('admin') || detail.deleted"
          @click="edit(detail)"
          >编辑</ElButton
        ><ElButton @click="viewHistory(detail)">完整历史</ElButton
        ><ElButton
          v-if="
            kind === 'physical' &&
            detail.status !== 'retired' &&
            !detail.deleted
          "
          :disabled="!can('admin')"
          @click="replacing = true"
          >整基更换</ElButton
        ><ElButton
          type="danger"
          :disabled="!can('admin') || detail.deleted"
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
      <BusinessHistory
        v-if="detail.identity_decisions?.length"
        :value="{ identity_decisions: detail.identity_decisions }"
      /><BusinessHistory
        v-if="detail.replacements?.length"
        :value="{ replacements: detail.replacements }"
      />
      <div v-if="history" class="panel">
        <h2>完整版本与审计历史</h2>
        <BusinessHistory :value="history" />
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
