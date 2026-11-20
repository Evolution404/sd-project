<script setup lang="ts">
import { useWorkRoute } from "../../shared/navigation/use-work-route";
import BusinessWorkSurface from "../../shared/ui/BusinessWorkSurface.vue";
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { resumeTask } from "../../shared/navigation/business-context";
import { ElMessage, ElMessageBox } from "element-plus";
import type {
  CatalogField,
  CatalogFormDefinition,
} from "../../../../server/shared/types/catalog";
import type {
  Page,
  AuditRecord,
} from "../../../../server/shared/types/contracts";
import type {
  OperationRecord,
  WorkObjectRecord,
} from "../../../../server/shared/types/work-standards";
import { api, statusText, money, quantity } from "../../shared/api/client";
import { factText } from "../../shared/utils/display";
import { useListRoute } from "../../shared/composables/use-list-route";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useDescriptionColumns } from "../../shared/composables/use-description-columns";
import { useAccess } from "../../shared/composables/use-access";
import BusinessTable, {
  type TableColumn,
} from "../../shared/ui/BusinessTable.vue";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import StandardEditor from "./StandardEditor.vue";
type Kind = "operations" | "objects";
type Item = OperationRecord | WorkObjectRecord;
interface Detail {
  item: Item;
  versions: unknown[];
  audits: AuditRecord[];
}
const route = useRoute(),
  router = useRouter(),
  can = useAccess(),
  descriptionColumns = useDescriptionColumns();
const workRoute = useWorkRoute();
const editorMode = computed(() => String(route.params.editor || ""));
const editorError = ref("");
let editorOriginDetail = "";
const editorLoading = ref(false);
let editorSequence = 0;
function leaveEditor() {
  return workRoute.exit({ name: "standards", params: { kind: route.params.kind || "", editor: "", definitionId: "" }, query: route.query });
}
const kind = computed({
  get: () => String(route.params.kind || "operations") as Kind,
  set: (value: Kind) => {
    void router.push({ name: "standards", params: { kind: value },
      query: typeof route.query.returnTo === "string" ? { returnTo: route.query.returnTo } : {} });
  },
});
const definitions = shallowRef<Partial<Record<Kind, CatalogFormDefinition>>>(
    {},
  ),
  labels = ref<Record<string, string>>({}),
  rows = ref<Item[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  deleted = ref(false),
  sort = ref(""),
  direction = ref(""),
  filters = ref<Record<string, string>>({}),
  loading = ref(false),
  loadError = ref(""),
  editor = ref(false),
  editing = ref<Item | null>(null),
  detailState = shallowRef<Detail | null>(null),
  showHistory = ref(false);

const detail = computed(() => detailState.value?.item || null);
const adoptedDemandReturnTo = computed(() =>
  typeof route.query.record === "string" &&
  typeof route.query.returnTo === "string" &&
  route.query.returnTo.startsWith("/demands") ? route.query.returnTo : null);
const returnToDemand = computed(() =>
  typeof route.query.record !== "string" &&
  typeof route.query.returnTo === "string" &&
  route.query.returnTo.startsWith("/demands") ? route.query.returnTo : null);
const adoptedVersion = computed(() => {
  if (kind.value !== "operations" || !adoptedDemandReturnTo.value) return null;
  const candidate = Number(route.query.adoptedVersion);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
});
const adoptedVersionExists = computed(() =>
  adoptedVersion.value !== null && detailState.value?.versions.some(version =>
    version !== null && typeof version === "object" &&
    "version" in version && version.version === adoptedVersion.value) === true);
function backToDemand() {
  if (returnToDemand.value) resumeTask(router, returnToDemand.value);
}
function changeSetupStep(next: "objects" | "operations" | "units") {
  if (next === "units") {
    void router.push({ name: "dictionaries", params: { kind: "units" },
      query: returnToDemand.value ? { returnTo: returnToDemand.value } : {} });
  } else {
    void router.push({ name: "standards", params: { kind: next },
      query: returnToDemand.value ? { returnTo: returnToDemand.value } : {} });
  }
}
async function setupSaved() {
  await leaveEditor();
  if (!returnToDemand.value) return;
  if (kind.value === "objects") changeSetupStep("operations");
  else backToDemand();
}
const fields = computed(() =>
  [
    ...(definitions.value[kind.value]?.rootFields || []),
    ...(definitions.value[kind.value]?.fields || []),
  ].filter((field) => !field.systemManaged),
);
const columns = computed<TableColumn[]>(() =>
  fields.value
    .filter((field) => field.type !== "json")
    .map((field) => ({
      key: field.key,
      label: field.label,
      minWidth: ["name", "title"].includes(field.key) ? 190 : 130,
    })),
);
function fact(row: Item, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}
function display(row: Item, field: CatalogField): string {
  const value = fact(row, field.key);
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "ref")
    return String(fact(row, field.key + "_label") || "历史关联对象");
  if (field.type === "boolean") return value ? "是" : "否";
  if (field.type === "money") return "¥" + money(Number(value));
  if (field.type === "quantity") return quantity(Number(value));
  if (field.type === "select")
    return String(statusText[String(value)] || value);
  if (field.type === "json") return factText(value, field.key, labels.value);
  return String(value);
}
function cell(row: Item, column: TableColumn): string {
  const field = fields.value.find((field) => field.key === column.key);
  return field ? display(row, field) : String(fact(row, column.key) ?? "—");
}
let sequence = 0;
async function load() {
  const current = ++sequence,
    requestedKind = kind.value;
  loading.value = true;
  loadError.value = "";
  const parameters = new URLSearchParams({
    page: String(page.value),
    q: query.value,
    deleted: String(deleted.value),
    sort: sort.value || "created_at",
    direction: direction.value || "desc",
    filters: JSON.stringify(filters.value),
  });
  try {
    const result = await api<Page<Item>>(
      `/catalog/${requestedKind}?${parameters}`,
    );
    if (current === sequence && requestedKind === kind.value) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (failure) {
    if (current === sequence) loadError.value = (failure as Error).message;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
const detailDialog = useEntityDialog(
  detailState,
  (id) => api<Detail>(`/catalog/${kind.value}/${id}?deleted=true&history=true`),
  () => { showHistory.value = false; },
);
async function refresh() {
  await load();
  if (detail.value) await detailDialog.reload();
}
function edit(row?: Item) {
  editorOriginDetail = detailDialog.isOpen.value ? detail.value?.id || "" : "";
  return workRoute.enter({ name: "standards", params: { kind: route.params.kind || "", editor: row ? "edit" : "new", definitionId: row?.id || "" }, query: route.query });
}
async function loadEditor() {
  const sequence = ++editorSequence;
  const mode = editorMode.value;
  editorError.value = "";
  editor.value = false;
  editing.value = null;
  if (!mode) {
    editorLoading.value = false;
    const detailId = editorOriginDetail;
    editorOriginDetail = "";
    if (detailId && !detailDialog.isOpen.value) await detailDialog.open(detailId);
    return;
  }
  editorLoading.value = true;
  try {
    if (!can("admin")) throw new Error("当前账号没有维护正式定义的权限");
    const id = route.params.definitionId;
    const row = mode === "new" ? null : typeof id === "string" && id
      ? await api<Item>(`/catalog/${kind.value}/${id}`) : null;
    if (sequence !== editorSequence) return;
    if (mode !== "new" && (!row || row.deleted)) throw new Error("正式定义不存在或已删除");
    editing.value = row;
    editor.value = true;
  } catch (error) {
    if (sequence === editorSequence) editorError.value = (error as Error).message;
  } finally {
    if (sequence === editorSequence) editorLoading.value = false;
  }
}
watch([editorMode, () => route.params.definitionId, kind], loadEditor, { immediate: true });
async function remove(row: Item) {
  try {
    const impact = await api<{ references: number; expected_version: number }>(
      `/catalog/${kind.value}/${row.id}/deletion-impact`,
    );
    await ElMessageBox.confirm(
      `当前有${impact.references}处正式关联。删除保留原定义版本和这些关联，并停止新增选用。`,
      "确认删除",
      { type: "warning" },
    );
    await api<unknown>(`/catalog/${kind.value}/${row.id}`, "DELETE", {
      expected_version: impact.expected_version,
      expected_references: impact.references,
    });
    await refresh();
    ElMessage.success("已删除，正式历史已保留");
  } catch (failure) {
    if (failure instanceof Error) ElMessage.error(failure.message);
  }
}

function tableSort(value: { key: string; order: string }) {
  sort.value = value.key;
  direction.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  void load();
}
function tableFilter(values: Record<string, string>) {
  filters.value = values;
  page.value = 1;
  void load();
}
watch(kind, () => {
  sequence++;
  rows.value = [];
  detailDialog.close();
  editor.value = false;
  void load();
});
useListRoute({ q: query, page, deleted, sort, direction, filters }, load);
watch(() => [kind.value, route.query.record, route.query.adoptedVersion], async () => {
  const id = route.query.record;
  if (typeof id !== "string" || !id) return;
  await detailDialog.open(id);
  if (route.query.adoptedVersion && detail.value?.id === id)
    showHistory.value = true;
}, { immediate: true, flush: "post" });
onMounted(async () => {
  try {
    [definitions.value, labels.value] = await Promise.all([
      api<Record<Kind, CatalogFormDefinition>>("/catalogs"),
      api<Record<string, string>>("/display-labels"),
    ]);
    await load();
  } catch (failure) {
    loadError.value = (failure as Error).message;
  }
});
</script>
<template>
  <div v-show="!editorMode">
  <div class="page-heading">
    <div>
      <h1>作业标准</h1>
      <p>维护固定单位、作业对象和录入模板，正式定义变更保留历史。</p>
    </div>

  </div>
  <ElAlert v-if="returnToDemand" class="setup-return-bar" type="info" :closable="false"
    title="当前正在配置需求录入所需的基础信息；配置完成后将恢复原需求草稿。">
    <div class="toolbar">
      <ElButton size="small" @click="backToDemand">返回需求录入</ElButton>
      <ElButton size="small" @click="changeSetupStep('objects')">配置作业对象</ElButton>
      <ElButton size="small" @click="changeSetupStep('units')">配置计量单位</ElButton>
      <ElButton size="small" @click="changeSetupStep('operations')">配置操作类型</ElButton>
    </div>
  </ElAlert>
  <ElTabs v-model="kind"
    ><ElTabPane name="operations" label="操作类型" /><ElTabPane
      name="objects"
      label="作业对象"
  /></ElTabs>
  <div class="panel">

    <ElAlert
      v-if="loadError"
      :title="loadError"
      type="error"
      :closable="false"
    />
    <BusinessTable detail-column="name" @open-detail="detailDialog.open($event.id)"
      :rows="rows"
      :columns="columns"
      :table-key="'catalog:' + kind"
      :loading="loading"
      :filter-state="filters"
      :actions-width="180"
      :search-active="!!query"
      @clear-search="
        query = '';
        filters = {};
        page = 1;
        load();
      "
      :sort-state="{
        prop: sort,
        order: sort ? (direction === 'asc' ? 'ascending' : 'descending') : null,
      }"
      @sort-change="tableSort"
      @filter-change="tableFilter"
    >
      <template #toolbar="{ openSettings, clearFilters, hasActiveFilters }">
        <div class="unified-list-tools">
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
              <ElCheckbox data-guide-action="standards.show-deleted"
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
      <ElButton :data-guide-action="kind === 'objects' ? 'standards.object' : 'standards.operation'" type="primary" v-if="can('admin')" @click="edit()"
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

    </BusinessTable>
    <ElPagination
      v-model:current-page="page"
      :page-size="30"
      :total="total"
      layout="prev, pager, next, total"
      @current-change="load"
    />
  </div>
  <BusinessDetailDialog
    :open="detailDialog.isOpen.value && !editorMode"
    :title="(definitions[kind]?.title || '') + '详情'"
    :loading="detailDialog.loading.value"
    :error="detailDialog.error.value"
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
        <ElButton v-if="adoptedDemandReturnTo" link type="primary"
          @click="resumeTask(router, adoptedDemandReturnTo)">返回需求详情</ElButton>
        <ElButton data-guide-action="standards.edit"
          v-if="can('admin') && !detail.deleted"
          @click="edit(detail)"
          >编辑</ElButton
        ><ElButton data-guide-action="standards.version" @click="showHistory = true">完整历史</ElButton
        ><ElButton data-guide-action="standards.delete"
          type="danger"
          v-if="can('admin') && !detail.deleted"
          @click="remove(detail)"
          >删除</ElButton
        >
      </div>
      <ElAlert v-if="adoptedVersion !== null"
        :title="adoptedVersionExists
          ? '该需求正式采用第' + adoptedVersion + '版操作定义，下面可追溯该版本'
          : '需求采用的第' + adoptedVersion + '版操作定义未能找到，请核对正式历史'"
        :type="adoptedVersionExists ? 'info' : 'warning'"
        :closable="false" />
      <div class="panel">
        <h2>正式定义</h2>
        <ElDescriptions :column="descriptionColumns" border>
          <ElDescriptionsItem
            v-for="field in fields"
            :key="field.key"
            :label="field.label"
            :span="field.type === 'json' ? descriptionColumns : 1"
            >{{ display(detail, field) }}</ElDescriptionsItem
          >
        </ElDescriptions>
      </div>
      <div v-if="showHistory" class="panel">
        <h2>完整版本与审计历史</h2>
        <BusinessHistory
          :value="{
            versions: detailState?.versions,
            audits: detailState?.audits,
          }"
        />
      </div>
    </template>
  </BusinessDetailDialog>
  </div>
  <BusinessWorkSurface v-if="editorMode && (editorLoading || editorError)" title="读取办理信息" @back="leaveEditor">
    <ElSkeleton v-if="editorLoading" :rows="4" animated />
    <ElAlert v-else :title="editorError" type="error" :closable="false"><ElButton @click="loadEditor">重试</ElButton></ElAlert>
  </BusinessWorkSurface>
  <StandardEditor
    :key="kind"
    :open="editor"
    @update:open="value => { if (!value) leaveEditor(); }"
    :kind="kind"
    :definition="definitions[kind]"
    :editing="editing"
    :refresh="refresh"
    @saved="setupSaved"
  />
</template>
