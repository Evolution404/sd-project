<script setup lang="ts">
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useDescriptionColumns } from "../../shared/composables/use-description-columns";import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
const descriptionColumns = useDescriptionColumns();
import { useListRoute } from "../../shared/composables/use-list-route";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
import { ref, onMounted, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createProjectForDemand, projectContext, setupContext } from "../../shared/navigation/business-context";
import { parkDemandDraft, takeDemandDraft } from "../../shared/forms/demand-draft-handoff";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "../../shared/ui/FieldControl.vue";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import PricingQuoteDialog from "../pricing/PricingQuoteDialog.vue";
import SiteFeaturesEditor from "../pricing/SiteFeaturesEditor.vue";
import EvidencePanel from "../files/EvidencePanel.vue";
import ExchangePanel from "../exchange/ExchangePanel.vue";
import { api, type Row, quantity, statusText } from "../../shared/api/client";
import type { OperationRecord, OperationVersion } from "../../../../server/shared/types/work-standards";
const adoptedOperation = ref<OperationVersion | null>(null),
  lastOperationId = ref("");
// Requests for previous definitions can resolve out of order when switching
// operation types quickly; only the latest explicit selection may modify draft.
let operationChangeSequence = 0;
const workQuantityPrecision = ref(4);
let unitPrecisionSequence = 0;
async function syncWorkQuantityPrecision(selected: OperationRecord | OperationVersion | null) {
  const sequence = ++unitPrecisionSequence;
  workQuantityPrecision.value = 4;
  if (!selected?.default_unit_id) return;
  try {
    const response = await api<{ versions: Array<{ version: number; quantity_precision?: number }> }>(
      "/catalog/units/" + selected.default_unit_id + "?history=true",
    );
    if (sequence !== unitPrecisionSequence) return;
    const adopted = response.versions.find(row => row.version === selected.default_unit_version);
    workQuantityPrecision.value = adopted?.quantity_precision ?? 4;
  } catch (failure) {
    if (sequence === unitPrecisionSequence)
      ElMessage.warning("未能读取计量单位精度，保存仍将由服务端校验：" + (failure as Error).message);
  }
}

const props = defineProps<{ user: Row }>();
const route = useRoute(), router = useRouter();
const projectPickerOpen = ref(false), projectSearch = ref(""), projectPage = ref(1);
const projectCandidates = ref<Row[]>([]), projectTotal = ref(0);
const projectLoading = ref(false), linking = ref(false), selectedProjectId = ref("");
let projectSearchSequence = 0;
async function loadProjectCandidates() {
  const sequence = ++projectSearchSequence;
  projectLoading.value = true;
  try {
    const params = new URLSearchParams({
      page: String(projectPage.value), page_size: "20", q: projectSearch.value,
      deleted: "false",
    });
    const response = await api<{ items: Row[]; total: number }>("/projects?" + params);
    if (projectSearchSequence !== sequence) return;
    projectCandidates.value = response.items.filter(project => project.status !== "closed");
    projectTotal.value = response.total;
  } catch (error) {
    if (projectSearchSequence === sequence) ElMessage.error((error as Error).message);
  } finally {
    if (projectSearchSequence === sequence) projectLoading.value = false;
  }
}
function openProjectPicker() {
  if (!detail.value || detail.value.status !== "active" || detail.value.binding) return;
  projectSearch.value = "";
  projectPage.value = 1;
  selectedProjectId.value = "";
  projectPickerOpen.value = true;
  void loadProjectCandidates();
}
async function linkSelectedProject() {
  if (!detail.value || !selectedProjectId.value || linking.value) return;
  linking.value = true;
  try {
    const demandId = detail.value.id;
    await api(`/projects/${selectedProjectId.value}/link`, "POST", {
      demand_id: demandId, expected_version: detail.value.current_version,
    });
    projectPickerOpen.value = false;
    ElMessage.success("需求已承接，可直接进入子项目继续入库与批准");
    await detailDialog.reload();
    await load();
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally { linking.value = false; }
}
function openLinkedProject() {
  if (detail.value?.binding?.project_id) {
    void router.push(projectContext(detail.value.binding.project_id,
      "scope", { focus: "demand", record: detail.value.id }));
  }
}
function openAdoptedOperation() {
  if (!detail.value?.operation_id || !detail.value.operation_version) return;
  void router.push({
    name: "standards",
    params: { kind: "operations" },
    query: {
      record: detail.value.operation_id,
      adoptedVersion: String(detail.value.operation_version),
      returnTo: route.fullPath,
    },
  });
}
function openLocationRecord(location: Record<string, unknown>) {
  const target = location.location_kind === "span"
    ? { kind: "spans", id: location.span_id }
    : location.location_kind === "physical_tower"
      ? { kind: "physical", id: location.physical_tower_id }
      : { kind: "towers", id: location.logical_tower_id };
  if (typeof target.id !== "string" || !target.id) {
    ElMessage.warning("该历史作业位置没有对应的设备正式身份");
    return;
  }
  void router.push({
    name: "ledger",
    params: { kind: target.kind },
    query: { record: target.id, history: "true", returnTo: route.fullPath },
  });
}
function createProjectAndLink() {
  if (!detail.value) return;
  void router.push(createProjectForDemand(detail.value.id));
}
function secondaryAction(action: string) {
  if (!detail.value) return;
  if (action === "edit") void edit(detail.value);
  if (action === "history") void showHistory();
  if (action === "quote") quoteOpen.value = true;
  if (action === "return") void transition(detail.value, "returned");
  if (action === "cancel") void transition(detail.value, "cancelled");
  if (action === "delete") void remove(detail.value);
}
const rows = ref<Row[]>([]),
  listLoading = ref(false),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  sortKey = ref(""),
  sortDirection = ref("desc"),
  columnFilters = ref<Record<string, string>>({}),
  selected = ref<Row[]>([]),
  detail = ref<Row | null>(null),
  dialog = ref(false),
  loading = ref(false),
  form = ref<Row>({}),
  editing = ref<Row | null>(null),
  operations = ref<OperationRecord[]>([]),
  businessLabels = ref<Row>({}),
  errors = ref<Row>({}),
  history = ref<Row | null>(null),
  quoteOpen = ref(false),
  formRef = ref(),
  showDeleted = ref(false);
const setupStatus = ref<"loading" | "ready" | "missing" | "error">("loading");
async function checkOperationSetup() {
  setupStatus.value = "loading";
  try {
    const result = await api<{ total: number }>("/catalog/operations?page=1&page_size=1");
    setupStatus.value = result.total ? "ready" : "missing";
  } catch { setupStatus.value = "error"; }
}
function configureMissingOperation() {
  if (!can("admin")) return;
  parkDemandDraft({
    // Vue ref values are reactive proxies; structuredClone(proxy) throws.
    // Serialize the purely JSON business form before transient handoff.
    form: JSON.parse(JSON.stringify(form.value)),
    lineIds: [...locationLineIds.value],
  });
  dialog.value = false;
  void router.push(setupContext(route, "operations"));
}
async function resumeDemandDraft() {
  if (route.query.resume !== "demand") return;
  const parked = takeDemandDraft();
  const { resume: ignored, ...queryWithoutResume } = route.query;
  void ignored;
  await router.replace({ query: queryWithoutResume });
  if (!parked) return;
  await edit();
  form.value = parked.form;
  locationLineIds.value = parked.lineIds;
  lastOperationId.value = String(parked.form.operation_id || "");
  if (lastOperationId.value) await operationRecord(lastOperationId.value);
  draftGuard.capture();
  ElMessage.success("已恢复原需求录入内容");
}
const locationLineIds = ref<(string | null)[]>([]);
function clearLocationDevice(loc: Row) {
  loc.logical_tower_id = null;
  loc.physical_tower_id = null;
  loc.span_id = null;
  loc.span_version = undefined;
  loc.site_features_json = "{}";
  loc.adopt_current_definition = true;
}
function changeLocationKind(loc: Row) {
  clearLocationDevice(loc);
}
function removeLocation(index: number) {
  form.value.work_locations.splice(index, 1);
  locationLineIds.value.splice(index, 1);
}
const operation = computed(() => {
  const adopted = adoptedOperation.value;
  // A frozen version has its own row ID, but downstream pricing and catalog
  // lookups require the stable operation identity, never that version-row ID.
  if (adopted && adopted.operation_id === form.value.operation_id &&
      adopted.version === form.value.operation_version)
    return { ...adopted, id: adopted.operation_id };
  return operations.value.find((item) => item.id === form.value.operation_id);
});
const extraFields = computed(() =>
  JSON.parse(operation.value?.fields_json || "[]"),
);
const locationReference = computed(() =>
  operation.value?.work_target_type === "physical" ? "physical" : "towers",
);
const demandLocationColumns: TableColumn[] = [
  { key: "location_snapshot_json", label: "位置", minWidth: 230, sortable: false, filterable: false },
  { key: "quantity_scaled", label: "数量", minWidth: 135 },
  { key: "work_mode", label: "作业方式", minWidth: 130 },
  { key: "site_features_json", label: "现场特征", minWidth: 230, sortable: false, filterable: false },
];
const projectPickerColumns: TableColumn[] = [
  { key: "name", label: "项目名称", minWidth: 210 },
  { key: "code", label: "项目编号", minWidth: 150 },
  { key: "status", label: "阶段", minWidth: 115 },
];
const demandMaterialColumns: TableColumn[] = [
  { key: "material_name", label: "物资名称", minWidth: 165 },
  { key: "model", label: "型号", minWidth: 145 },
  { key: "specification", label: "规格", minWidth: 145 },
  { key: "quantity_scaled", label: "预计数量", minWidth: 165 },
];
function resetListPage() {
  page.value = 1;
  void load();
}
const demandColumns: TableColumn[] = [
  { key: "demand_no", label: "需求编号", minWidth: 150 },
  { key: "operation_snapshot", label: "操作类型", minWidth: 160 },
  { key: "problem_description", label: "问题描述", minWidth: 200 },
  { key: "quantity_scaled", label: "工作量" },
  { key: "unit_snapshot", label: "计量单位" },
  { key: "work_locations", filterable: false, label: "作业位置数", sortable: false },
  { key: "status", label: "状态" },
  { key: "binding", filterable: false, label: "当前关联", sortable: false },
];
function sortTable(value: { key: string; order: string }) {
  sortKey.value = value.key;
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  load();
}
function filterTable(value: Record<string, string>) {
  columnFilters.value = value;
  page.value = 1;
  load();
}
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  listLoading.value = true;
  try {
    const result = await api(
      `/demands?page=${page.value}&q=${encodeURIComponent(query.value)}&deleted=${showDeleted.value}&sort=${encodeURIComponent(sortKey.value || "created_at")}&direction=${sortDirection.value}&filters=${encodeURIComponent(JSON.stringify(columnFilters.value))}`,
    );
    if (sequence !== loadSequence) return;
    rows.value = result.items;
    total.value = result.total;
    const id = detail.value?.id;
    if (id) {
      const updated = await api("/demands/" + id + "?deleted=true");
      if (sequence === loadSequence && detail.value?.id === id) detail.value = updated;
    }
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error((error as Error).message);
  } finally {
    if (sequence === loadSequence) listLoading.value = false;
  }
}
const needsCompletionReview = ref(false);
const draftGuard = useDialogDraftGuard(() => form.value);
function closeEditor() { void draftGuard.confirmClose(() => { dialog.value = false; }); }
function beforeEditorClose(done: () => void) { void draftGuard.confirmClose(done); }
async function edit(row?: Row) {
  editing.value = row || null;  needsCompletionReview.value = false;
  const value = row ? await api("/demands/" + row.id) : null;
  form.value = value
    ? structuredClone(value)
    : {
        demand_no: "",
        operation_id: "",
        problem_description: "",
        completion_standard: "",
        work_locations: [],
        materials: [],
        sources: [{ description: "", discovered_on: "" }],
      };
  for (const loc of form.value.work_locations)
    loc.site_features_json = JSON.stringify(loc.site_features_json || {});
  // A historical selected object must remain visible even outside the current
  // search range; infer its actual line only from persisted relationships.
  locationLineIds.value = await Promise.all(form.value.work_locations.map(async (loc: Row) => {
    const selectedId = loc.location_kind === "span" ? loc.span_id
      : loc.location_kind === "physical_tower" ? loc.physical_tower_id
        : loc.logical_tower_id;
    if (!selectedId) return null;
    const target = loc.location_kind === "span" ? "spans"
      : loc.location_kind === "physical_tower" ? "physical" : "towers";
    try {
      const item = await api("/catalog/" + target + "/" + selectedId + "?deleted=true");
      if (target === "physical") {
        const active = item.bindings?.filter((link: Row) =>
          link.logical_status !== "retired" && !link.logical_deleted) || [];
        const unique = [...new Set(active.map((link: Row) => link.line_id))];
        return unique.length === 1 ? String(unique[0]) : null;
      }
      return item.line_id || null;
    } catch { return null; }
  }));
  form.value.custom_fields = value?.custom_fields || {};
  adoptedOperation.value = value
    ? (await api("/catalog/operations/history/" + value.operation_id)).find(
        (definition: Row) => definition.version === value.operation_version,
      )
    : null;
  lastOperationId.value = form.value.operation_id;
  errors.value = {};
  await syncWorkQuantityPrecision(operation.value || null);
  dialog.value = true;
  draftGuard.capture();
  if (!row) void checkOperationSetup();
}
async function operationRecord(key: string): Promise<OperationRecord | null> {
  if (!key) return null;
  const found = operations.value.find(item => item.id === key);
  if (found) return found;
  const fetched = await api<OperationRecord>("/catalog/operations/" + key + "?deleted=true");
  operations.value.push(fetched);
  return fetched;
}
async function chooseOperation(selectedId: string | null) {
  const sequence = ++operationChangeSequence;
  ++unitPrecisionSequence;
  const requestedId = String(selectedId || "");
  form.value.operation_id = requestedId;
  const current = () => sequence === operationChangeSequence &&
    form.value.operation_id === requestedId;
  const selected = await operationRecord(requestedId);
  if (!current() || !selected) return;
  const incompatible = form.value.work_locations.some(
    (loc: Row) =>
      (selected.work_target_type === "physical") !==
        (loc.location_kind === "physical_tower") ||
      (loc.location_kind === "span"
        ? !selected.allow_span
        : !selected.allow_tower),
  );
  if (incompatible) {
    try {
      await ElMessageBox.confirm(
        "新操作不适用当前作业位置，请重新选择真实设备。",
        "切换操作类型",
        { confirmButtonText: "重新选择位置", cancelButtonText: "保留原操作" },
      );
      if (!current()) return;
      form.value.work_locations = [];
      locationLineIds.value = [];
    } catch {
      if (!current()) return;
      form.value.operation_id = lastOperationId.value;
      return;
    }
  }
  const previous = adoptedOperation.value?.operation_id === lastOperationId.value
    ? adoptedOperation.value
    : await operationRecord(lastOperationId.value);
  if (!current()) return;
  const oldDefault = String(previous?.completion_standard || "").trim();
  const currentStandard = String(form.value.completion_standard || "").trim();
  const newDefault = String(selected.completion_standard || "");
  if (!currentStandard || currentStandard === oldDefault) {
    form.value.completion_standard = newDefault;
    needsCompletionReview.value = false;
  } else {
    needsCompletionReview.value = !!newDefault &&
      currentStandard !== newDefault.trim();
  }
  form.value.operation_version = selected.version;
  lastOperationId.value = selected.id;
  form.value.custom_fields = Object.fromEntries(
    JSON.parse(selected.fields_json || "[]").map((field: Row) => [
      field.key,
      form.value.custom_fields?.[field.key] ?? field.default ?? null,
    ]),
  );
  form.value.target_object = selected.default_target_object;
  if (!form.value.work_locations.length) addLocation();
  void syncWorkQuantityPrecision(selected);
}
function addLocation() {
  const op = operation.value;
  locationLineIds.value.push(null);
  form.value.work_locations.push({
    location_kind:
      op?.work_target_type === "physical"
        ? "physical_tower"
        : op?.default_location_kind === "span"
          ? "span"
          : "logical_tower",
    quantity_scaled: op?.default_quantity_scaled || 10000,
    work_mode: "unspecified",
    site_features_json: "{}",
  });
}
async function save() {
  if (loading.value) return;
  loading.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) return;
    const unavailable = (form.value.work_locations || []).find((location: Row) =>
      location.price_features_load_error || location.price_features_loading);
    if (unavailable) {
      ElMessage.error(unavailable.price_features_load_error ||
        "现场计价信息尚未加载完毕，请稍后保存");
      return;
    }
    const input = {
      ...Object.fromEntries(
        [
          "demand_no",
          "operation_id",
          "operation_version",
          "problem_description",
          "target_object",
          "completion_standard",
          "priority_id",
          "expected_on",
          "work_locations",
          "materials",
          "custom_fields",
          "duplicate_decision",
          "duplicate_matches",
        ].map((key) => [key, form.value[key]]),
      ),
      expected_version: editing.value?.current_version,
      sources: form.value.sources.filter((x: Row) => x.id || x.description),
    };
    const saved = await api<{ id: string }>(
      "/demands" + (editing.value ? "/" + editing.value.id : ""),
      "POST", input,
    );
    ElMessage.success("需求版本已保存，可继续确认或承接");
    dialog.value = false;
    await load();
    await detailDialog.open(saved.id);
  } catch (e) {
    errors.value = (e as Row).fields || {};
    if (errors.value.duplicates) {
      try {
        await ElMessageBox.confirm(
          "与需求 " +
            errors.value.duplicates.join("、") +
            " 的操作和位置重复。确认现场事实属于独立需求并分别保留？",
          "疑似重复需求复核",
          { confirmButtonText: "确认为独立需求", cancelButtonText: "返回核对" },
        );
        form.value.duplicate_decision = "separate";
        form.value.duplicate_matches = errors.value.duplicates;
        loading.value = false;
        await save();
      } catch {}
    } else ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
async function transition(row: Row, status: string) {
  try {
    await ElMessageBox.confirm(
      "确认记录此次正式需求状态决定？",
      statusText[status],
    );
    const timeline = await api("/demands/" + row.id + "/history");
    await api("/demands/" + row.id + "/status", "POST", {
      status,
      expected_version: row.current_version,
      expected_event_seq: timeline.events.at(-1).event_seq,
    });
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function removeSource(source: Row) {
  try {
    await ElMessageBox.confirm(
      "从当前来源列表移除，原始来源、证据及历史引用保留。",
      "删除来源",
    );
    await api("/sources/" + source.id, "DELETE", {});
    await load();
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function showHistory() {
  history.value = await api("/demands/" + detail.value!.id + "/history");
}
async function remove(row: Row) {
  try {
    await ElMessageBox.confirm(
      "删除后从正常列表移除，正式历史继续可查。须先取消需求并解除当前关联。",
      "删除需求",
    );
    await api("/demands/" + row.id, "DELETE", {
      expected_version: row.current_version,
    });
    await detailDialog.close();
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
useListRoute({ q: query, page, deleted: showDeleted, sort: sortKey, direction: sortDirection, filters: columnFilters }, load);
const detailDialog = useEntityDialog(detail, id => api('/demands/' + id + '?deleted=true'), () => { dialog.value = false; history.value = null; quoteOpen.value = false; });
watch(() => route.query.demand, demandId => {
  if (typeof demandId === "string" && demandId && demandId !== detail.value?.id)
    void detailDialog.open(demandId);
}, { immediate: true });
const { isOpen: detailOpen, loading: detailLoading, error: detailError } = detailDialog;
onMounted(async () => {
  businessLabels.value = await api("/display-labels");
  await load();
  await resumeDemandDraft();
});
</script>
<template>
  <div class="page-heading">
      <div>
        <div class="section-caption">专业需求管理</div>
        <h1>专业需求</h1>
        <p>一种操作，多处作业位置。数量、现场条件与来源分别留存。</p>
      </div>
      <div class="page-heading-actions">
        <ExchangePanel
          kind="demands"
          :selected-ids="selected.map((x) => x.id)"
          :query="query"
          @changed="load"
        /><ElButton :disabled="!can('write')" type="primary" @click="edit()"
          >新增需求</ElButton
        >
      </div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <ElInput
          v-model="query"
          placeholder="需求编号、问题或位置"
          clearable
          @change="resetListPage"
        /><ElCheckbox v-model="showDeleted" @change="resetListPage"
          >包含已删除</ElCheckbox
        ><ElButton @click="load">刷新</ElButton>
      </div>
      <BusinessTable :search-active="!!query" @clear-search="query = ''; columnFilters = {}; page = 1; load()" :loading="listLoading" :rows="rows" :columns="demandColumns" table-key="demand:list" selectable :filter-state="columnFilters"
        :sort-state="{ prop: sortKey, order: sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
        @selection-change="selected = $event" @sort-change="sortTable" @filter-change="filterTable">
        <template #cell="{ row, column }">
          <span v-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</span>
          <span v-else-if="column.key === 'work_locations'">{{ row.work_locations?.length || 0 }} 处</span>
          <span v-else-if="column.key === 'binding'">{{ row.binding ? '已关联子项目' : '未关联' }}</span>
          <ElTag v-else-if="column.key === 'status'" effect="plain">{{ row.deleted ? "已删除" : statusText[row.status] }}</ElTag>
          <span v-else>{{ row[column.key] ?? '—' }}</span>
        </template>
        <template #actions="{ row }">
          <ElButton size="small" @click="detailDialog.open(row.id)">查看</ElButton>
        </template>
      </BusinessTable>
      <ElPagination
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev, pager, next, total"
        @current-change="load"
      /></div
  >
  <BusinessDetailDialog :open="detailOpen" title="需求详情" :loading="detailLoading" :error="detailError"
    @close="detailDialog.close" @retry="detailDialog.reload">
    <template v-if="detail"><div class="detail-header">
      <div>
        <h1>{{ detail.operation_snapshot }} · {{ detail.problem_description }}</h1>
        <div class="muted demand-technical-reference">需求编号：{{ detail.demand_no }} · 正式定义第{{ detail.current_version }}版</div>
      </div>
      <ElTag :type="detail.status === 'active' ? 'success' : 'info'">{{ statusText[detail.status] }}</ElTag>
    </div>
    <div class="panel demand-next-action">
      <div class="toolbar">
        <div>
          <h2>当前办理状态</h2>
          <p class="muted">
            {{ detail.status === 'pending' || detail.status === 'returned' ? '需求待确认有效后可以承接立项。' :
              detail.status === 'active' && !detail.binding ? '需求已确认有效，下一步可纳入子项目。' :
              detail.status === 'active' && detail.binding ? '需求已由子项目承接，可继续办理入库和批准。' :
              '需求已取消，正式定义及历史仍可追溯。' }}
          </p>
        </div>
        <ElButton v-if="['pending','returned'].includes(detail.status)"
          type="primary" :disabled="!can('demand.activate')"
          :title="can('demand.activate') ? undefined : '需要需求确认权限，请交由审核人员办理'"
          @click="transition(detail,'active')">
          确认需求有效
        </ElButton>
        <ElButton v-else-if="detail.status === 'active' && !detail.binding"
          type="primary" :disabled="!can('write')"
          :title="can('write') ? undefined : '关联子项目需要编辑权限'"
          @click="openProjectPicker">
          关联子项目
        </ElButton>
        <ElButton v-else-if="detail.binding?.project_id" type="primary" @click="openLinkedProject">
          进入承接项目
        </ElButton>
        <ElButton :disabled="!can('write') || detail.status === 'cancelled'"
          :title="detail.status === 'cancelled' ? '需求已取消，只能查看正式历史' :
            can('write') ? undefined : '修订需求需要编辑权限'"
          @click="edit(detail)">修订需求</ElButton>
        <ElDropdown trigger="click" @command="secondaryAction">
          <ElButton>更多操作</ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem command="quote">参考价试算</ElDropdownItem>
              <ElDropdownItem command="history">完整历史</ElDropdownItem>
              <ElDropdownItem v-if="detail.status === 'active'" command="return" :disabled="!can('demand.activate')">退回</ElDropdownItem>
              <ElDropdownItem v-if="detail.status !== 'cancelled'" command="cancel" :disabled="!can('demand.activate')" divided>取消需求</ElDropdownItem>
              <ElDropdownItem command="delete" :disabled="!can('admin')">删除</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
      </div>
      <ElAlert v-if="['pending','returned'].includes(detail.status) && !can('demand.activate')"
        class="permission-hint" type="info" :closable="false"
        title="当前账号没有需求确认权限，须由审核人员确认后才能进入承接。" />
      <ElAlert v-if="detail.status === 'active' && !detail.binding && !can('write')"
        class="permission-hint" type="info" :closable="false"
        title="当前账号没有编辑权限，关联子项目须由管理员或编辑人员办理。" />
      <ElAlert v-if="!can('write') && detail.status !== 'cancelled'"
        class="permission-hint" type="info" :closable="false"
        title="当前账号没有需求修订权限，可以查阅详情、采用定义和正式历史。" />
    </div>
    <div class="panel">
      <div class="toolbar">
        <h2>需求定义</h2>
        <ElButton link type="primary" @click="openAdoptedOperation">
          查看采用的操作定义（第{{ detail.operation_version }}版）
        </ElButton>
      </div>
      <ElDescriptions :column="descriptionColumns" border
        ><ElDescriptionsItem label="问题描述">{{
          detail.problem_description
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="总工作量"
          >{{ quantity(detail.quantity_scaled) }}
          {{ detail.unit_snapshot }}</ElDescriptionsItem
        ><ElDescriptionsItem label="作业对象">{{
          detail.work_object_snapshot
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="验收标准">{{
          detail.completion_standard
        }}</ElDescriptionsItem></ElDescriptions
      >
    </div>
    <div class="panel">
      <h2>作业位置</h2>
      <BusinessTable client-side table-key="demand:detail-locations"
        :rows="detail.work_locations || []" :columns="demandLocationColumns">
        <template #cell="{ row, column }">
          <ElButton v-if="column.key === 'location_snapshot_json'"
            link type="primary" @click="openLocationRecord(row)">
            {{ row.location_snapshot_json?.line_name || '' }}
            {{ row.location_snapshot_json?.location_label || row.location_snapshot_json?.tower_no || row.location_snapshot_json?.physical_code || row.span_id }}
          </ElButton>
          <span v-else-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</span>
          <span v-else-if="column.key === 'work_mode'">{{ statusText[row.work_mode] || row.work_mode }}</span>
          <span v-else-if="column.key === 'site_features_json'">
            {{ Object.entries(row.site_features_json || {}).map(([key, value]) =>
              (businessLabels[key + '@' + (value as Row).factor_version] || businessLabels[key] || '历史价格特征') +
              ' · ' + (value as Row).value).join(' / ') || '—' }}
          </span>
          <span v-else>{{ row[column.key] ?? '—' }}</span>
        </template>
      </BusinessTable>
    </div>
    <div class="panel">
      <h2>来源与预计物资</h2>
      <p v-for="source in detail.sources" :key="source.id">
        {{ source.description }}
        <span class="muted">{{ source.discovered_on }}</span
        ><ElButton :disabled="!can('write')" size="small" @click="edit(detail)"
          >更正</ElButton
        ><ElButton
          :disabled="!can('admin')"
          size="small"
          type="danger"
          @click="removeSource(source)"
          >删除</ElButton
        >
      </p>
      <BusinessTable client-side table-key="demand:detail-materials"
        :rows="detail.materials || []" :columns="demandMaterialColumns">
        <template #cell="{ row, column }">
          <span v-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }} {{ row.unit_snapshot }}</span>
          <span v-else>{{ row[column.key] ?? '—' }}</span>
        </template>
      </BusinessTable>
    </div>
    <EvidencePanel
      :key="detail.id"
      owner-kind="demand_id"
      :owner-id="detail.id"
  /></template>
  </BusinessDetailDialog>
  <ElDialog append-to-body
    v-model="dialog"
    :title="editing ? '修订需求' : '新增专业需求'"
    width="1000px"
    :close-on-click-modal="false" :before-close="beforeEditorClose"
    ><ElForm ref="formRef" :model="form" label-position="top" novalidate
      ><div class="form-grid">
        <ElFormItem
          label="操作类型"
          prop="operation_id"
          :rules="[{ required: true, message: '请选择操作类型' }]"
          ><FieldControl
            v-model="form.operation_id"
            :field="{ type: 'ref', reference: 'operations' }"
            :selected-label="operation?.name || ''"
            @update:model-value="chooseOperation"
          /></ElFormItem>
        <ElAlert v-if="setupStatus === 'missing' && !form.operation_id"
          type="warning" :closable="false" class="full-width"
          title="尚未配置操作类型，完成作业标准配置后可继续录入当前需求。">
          <ElButton size="small" type="primary" :disabled="!can('admin')"
            @click="configureMissingOperation">配置操作类型</ElButton>
          <span v-if="!can('admin')" class="muted">当前账号无配置权限，请联系管理员。</span>
        </ElAlert>
        <ElAlert v-else-if="setupStatus === 'error'" type="error" :closable="false"
          class="full-width" title="操作类型列表暂不可用，请检查网络或刷新配置。" />
        <ElFormItem
          label="问题描述"
          prop="problem_description"
          :rules="[{ required: true, message: '请填写问题描述' }]"
          ><ElInput
            v-model="form.problem_description"
            type="textarea" /></ElFormItem
        ><ElFormItem
          label="验收标准"
          prop="completion_standard"
          :rules="[{ required: true, message: '请填写验收标准' }]"
          ><ElInput v-model="form.completion_standard" type="textarea"
        /></ElFormItem>
        <ElAlert v-if="needsCompletionReview" class="full-width" type="warning"
          :closable="false"
          title="操作类型已经切换：当前验收标准包含手工填写内容，已保留。请确认其适用于新的作业类型。" />
      </div>
      <ElCollapse
        ><ElCollapseItem title="优先级与期望日期（按需填写）" name="priority"
          ><div class="form-grid">
            <ElFormItem label="优先级"
              ><FieldControl
                v-model="form.priority_id"
                :field="{ type: 'ref', reference: 'priorities' }" /></ElFormItem
            ><ElFormItem label="期望日期"
              ><ElDatePicker
                v-model="form.expected_on"
                value-format="YYYY-MM-DD"
            /></ElFormItem></div></ElCollapseItem
      ></ElCollapse>
      <div v-if="extraFields.length" class="form-grid">
        <ElFormItem
          v-for="field in extraFields"
          :key="field.key"
          :label="field.label"
          :prop="['custom_fields', field.key]"
          :required="field.required"
          :rules="
            field.required
              ? [{ required: true, message: '请填写' + field.label }]
              : []
          "
          :error="errors['custom_fields.' + field.key]"
          ><FieldControl
            v-model="form.custom_fields[field.key]"
            :field="{
              ...field,
              booleanNative: true,
              type: field.type === 'number' ? 'decimal' : field.type,
            }"
        /></ElFormItem>
      </div>
      <h3 class="subheading">作业位置与工作量</h3>
      <ElAlert
        v-if="operation"
        :title="
          '作业对象和单位由操作定义自动取得。' + (operation.entry_hint || '')
        "
        type="info"
        :closable="false"
      />
      <div
        v-for="(loc, index) in form.work_locations"
        :key="index"
        class="panel"
      >
        <div class="form-grid">
          <ElFormItem
            v-if="operation?.allow_span && operation?.allow_tower"
            label="位置类型"
            ><ElSelect v-model="loc.location_kind" @change="changeLocationKind(loc)"
              ><ElOption label="杆塔" value="logical_tower" /><ElOption
                label="档距"
                value="span" /></ElSelect></ElFormItem
          ><ElFormItem label="所属线路（筛选作业设备）">
            <FieldControl v-model="locationLineIds[Number(index)]"
              :field="{ type: 'ref', reference: 'lines' }"
              @update:model-value="clearLocationDevice(loc)" />
          </ElFormItem>
          <ElFormItem
            label="作业设备"
            :prop="[
              'work_locations',
              String(index),
              loc.location_kind === 'span'
                ? 'span_id'
                : loc.location_kind === 'physical_tower'
                  ? 'physical_tower_id'
                  : 'logical_tower_id',
            ]"
            :rules="[{ required: true, message: '请选择真实作业设备' }]"
            required
            ><FieldControl
              v-model="
                loc[
                  loc.location_kind === 'span'
                    ? 'span_id'
                    : loc.location_kind === 'physical_tower'
                      ? 'physical_tower_id'
                      : 'logical_tower_id'
                ]
              "
              @update:model-value="
                loc.adopt_current_definition = true;
                loc.span_version = undefined;
                loc.site_features_json = '{}';
              "
              :field="{
                type: 'ref',
                reference:
                  loc.location_kind === 'span' ? 'spans' : locationReference,
              }"
              :filters="locationLineIds[Number(index)] ? { line_id: locationLineIds[Number(index)]! } : {}" /></ElFormItem
          ><ElFormItem
            :label="workQuantityPrecision === 0 ? '实际数量（整数）' : '实际数量（最多' + workQuantityPrecision + '位小数）'"
            :prop="['work_locations', String(index), 'quantity_scaled']"
            :rules="[
              { required: true, message: '请填写实际数量' },
              { type: 'number', min: 1, message: '实际数量必须大于0' },
            ]"
            required
            ><FieldControl
              v-model="loc.quantity_scaled"
              :field="{ type: 'quantity', quantityPrecision: workQuantityPrecision }" /></ElFormItem
          ><ElFormItem label="作业方式"
            ><ElSelect v-model="loc.work_mode"
              ><ElOption label="未明确" value="unspecified" /><ElOption
                label="停电"
                value="outage" /><ElOption
                label="不停电"
                value="non_outage" /></ElSelect
          ></ElFormItem>
        </div>
        <SiteFeaturesEditor :operation="operation" :location="loc" />
        <ElButton
          type="danger"
          plain
          @click="removeLocation(Number(index))"
          >移除此位置</ElButton
        >
      </div>
      <ElButton :disabled="!operation" @click="addLocation">添加位置</ElButton>
      <h3 class="subheading">预计物资（可不填）</h3>
      <div v-for="(item, index) in form.materials" :key="index" class="toolbar">
        <FieldControl
          v-model="item.material_id"
          :field="{ type: 'ref', reference: 'materials' }"
        /><FieldControl
          v-model="item.quantity_scaled"
          :field="{ type: 'quantity' }"
        /><ElButton type="danger" @click="form.materials.splice(index, 1)"
          >移除</ElButton
        >
      </div>
      <ElButton @click="form.materials.push({ quantity_scaled: 10000 })"
        >添加预计物资</ElButton
      >
      <h3 class="subheading">来源依据</h3>
      <div
        v-for="(source, index) in form.sources"
        :key="index"
        class="form-grid"
      >
        <ElFormItem label="来源说明"
          ><ElInput v-model="source.description" /></ElFormItem
        ><ElFormItem label="发现日期"
          ><ElDatePicker
            v-model="source.discovered_on"
            value-format="YYYY-MM-DD"
        /></ElFormItem>
      </div>
      <ElButton @click="form.sources.push({ description: '' })"
        >补充来源</ElButton
      ></ElForm
    ><template #footer
      ><ElButton @click="closeEditor">取消</ElButton
      ><ElButton
        :disabled="!can('write')"
        type="primary"
        :loading="loading"
        @click="save"
        >保存需求版本</ElButton
      ></template
    ></ElDialog
  >
  <ElDialog v-model="projectPickerOpen" append-to-body title="选择子项目承接需求"
    width="min(840px, 94vw)" :close-on-click-modal="false">
    <p v-if="detail" class="muted">待承接：{{ detail.operation_snapshot }} · {{ detail.problem_description }}</p>
    <div class="toolbar">
      <ElInput v-model="projectSearch" clearable placeholder="搜索子项目名称或编号"
        @change="projectPage = 1; loadProjectCandidates()" @keyup.enter="projectPage = 1; loadProjectCandidates()" />
      <ElButton @click="projectPage = 1; loadProjectCandidates()">查找</ElButton>
      <ElButton :disabled="!can('write')" @click="createProjectAndLink">创建子项目并承接</ElButton>
    </div>
    <BusinessTable :rows="projectCandidates" :columns="projectPickerColumns"
      table-key="demand:project-picker" client-side :loading="projectLoading"
      :actions-width="100" max-height="400">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'status'">{{ statusText[row.status] || row.status }}</span>
        <span v-else>{{ row[column.key] || '—' }}</span>
      </template>
      <template #actions="{ row }">
        <ElButton size="small" :type="selectedProjectId === row.id ? 'primary' : undefined"
          @click="selectedProjectId = row.id">
          {{ selectedProjectId === row.id ? "已选中" : "选择" }}
        </ElButton>
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="projectPage" :page-size="20" :total="projectTotal"
      layout="prev, pager, next, total" @current-change="loadProjectCandidates" />
    <template #footer>
      <ElButton @click="projectPickerOpen = false">取消</ElButton>
      <ElButton type="primary" :loading="linking" :disabled="!selectedProjectId || !can('write')"
        @click="linkSelectedProject">承接该需求</ElButton>
    </template>
  </ElDialog>
  <PricingQuoteDialog
    v-if="detail"
    v-model="quoteOpen"
    :demand-id="detail.id"
    :expected-version="detail.current_version"
    @confirmed="load"
  />
  <ElDialog append-to-body
    :model-value="!!history"
    title="需求完整历史"
    width="900px"
    @close="history = null"
  >
    <BusinessHistory :value="history" />
  </ElDialog>
</template>

<style scoped>
.demand-technical-reference {font-size:12px;margin-top:6px}
.demand-next-action {border-color:var(--edge)}
.demand-next-action .toolbar {justify-content:space-between;flex-wrap:wrap;gap:12px}
.demand-next-action h2 {margin:0}
.demand-next-action p {margin:6px 0 0}
</style>
