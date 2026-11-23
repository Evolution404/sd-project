<script setup lang="ts">
import ExcelExportButton from "../exchange/ExcelExportButton.vue";
import HandlingReviewDialog from "../../shared/ui/HandlingReviewDialog.vue";
import { useHandlingReview } from "../../shared/composables/use-handling-review";
import { usePageSelection } from "../../shared/composables/use-page-selection";
import type { HandlingTarget } from "../../../../server/shared/types/handling-batch";
import { ordinaryLinkReason } from "../../../../server/shared/project-lifecycle";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useDescriptionColumns } from "../../shared/composables/use-description-columns";
const descriptionColumns = useDescriptionColumns();
import { useListRoute } from "../../shared/composables/use-list-route";
import BusinessNumber from "../../shared/ui/BusinessNumber.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
import { computed, ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { contextOrigin, createProjectForDemand, projectContext, setupContext } from "../../shared/navigation/business-context";
import { takeDemandDraft } from "../../shared/forms/demand-draft-handoff";
import { ElMessage, ElMessageBox } from "element-plus";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import PricingQuoteDialog from "../pricing/PricingQuoteDialog.vue";
import EvidencePanel from "../files/EvidencePanel.vue";
import ExchangePanel from "../exchange/ExchangePanel.vue";
import { api, quantity, statusText } from "../../shared/api/client";
import DemandEditor from "./components/DemandEditor.vue";
import BusinessWorkSurface from "../../shared/ui/BusinessWorkSurface.vue";
import { useWorkRoute } from "../../shared/navigation/use-work-route";
import { demandDisplayStatus } from "../../../../server/shared/demand-display-status";
import { formatVisibleDateTime } from "../../shared/utils/datetime";
import type { DemandRecord, DemandListItem, SourceRow, DemandStatus } from "../../../../server/shared/types/demands";
import type { OperationAttribute } from "../../../../server/shared/types/operation-attributes";
import type { Actor, Page } from "../../../../server/shared/types/contracts";
interface ProjectCandidate { id:string; name:string; code:string; status:string; display_status:string; }
const props = defineProps<{ user: Actor }>();
const route = useRoute(), router = useRouter();
const workRoute = useWorkRoute();
const editorRoute = computed(() => route.name === "demands" ? String(route.params.editMode || "") : "");
const editorError = ref("");
let editorRequest = 0;
const projectPickerOpen = ref(false), projectSearch = ref(""), projectPage = ref(1);
const projectCandidates = ref<ProjectCandidate[]>([]), projectTotal = ref(0);
const projectLoading = ref(false), linking = ref(false), selectedProjectId = ref("");
let projectSearchSequence = 0;
async function loadProjectCandidates() {
  const sequence = ++projectSearchSequence;
  selectedProjectId.value = "";
  projectLoading.value = true;
  try {
    const params = new URLSearchParams({
      page: String(projectPage.value), page_size: "20", q: projectSearch.value,
      deleted: "false",
    });
    const response = await api<{ items: ProjectCandidate[]; total: number }>("/projects?" + params);
    if (projectSearchSequence !== sequence) return;
    projectCandidates.value = response.items; // Do not filter a server-paginated page.
    projectTotal.value = response.total;
  } catch (error) {
    if (projectSearchSequence === sequence) ElMessage.error((error as Error).message);
  } finally {
    if (projectSearchSequence === sequence) projectLoading.value = false;
  }
}
function openProjectPicker() {
  if (!detail.value || detail.value.deleted || detail.value.status !== "active" || detail.value.binding) return;
  batchLinkItems.value = null;
  projectSearch.value = "";
  projectPage.value = 1;
  selectedProjectId.value = "";
  projectPickerOpen.value = true;
  void loadProjectCandidates();
}
async function linkSelectedProject() {
  if (!detail.value || detail.value.deleted || !selectedProjectId.value || linking.value || projectLoading.value) return;
  if (!projectCandidates.value.some(candidate => candidate.id === selectedProjectId.value && !ordinaryLinkReason(candidate))) {
    ElMessage.warning("请选择当前列表中可普通承接需求的子项目");
    return;
  }
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
    const origin = contextOrigin(router, route.query.returnTo, "projects");
    if (origin?.query.project === detail.value.binding.project_id) void workRoute.exit(origin.fullPath);
    else {
      const source = demandDetailsPath();
      void workRoute.enter(projectContext(detail.value.binding.project_id,
        "scope", { focus: "demand", record: detail.value.id }, source), source);
    }
  }
}
function demandDetailsPath() {
  return router.resolve({ path: route.path, query: { ...route.query, demand: detail.value?.id } }).fullPath;
}
function openAdoptedOperation() {
  if (!detail.value?.operation_id || !detail.value.operation_version) return;
  void router.push({
    name: "standards",
    params: { kind: "operations" },
    query: {
      record: detail.value.operation_id,
      adoptedVersion: String(detail.value.operation_version),
      returnTo: demandDetailsPath(),
    },
  });
}
function openLocationRecord(location: {location_kind:string;span_id?:string|null;physical_tower_id?:string|null;logical_tower_id?:string|null}) {
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
    query: { record: target.id, history: "true", returnTo: demandDetailsPath() },
  });
}
function createProjectAndLink() {
  if (!detail.value) return;
  void router.push(createProjectForDemand(detail.value.id));
}
function secondaryAction(action: string) {
  if (!detail.value) return;
  if (action === "edit") void edit(detail.value);
  if (action === "quote") quoteOpen.value = true;
  if (action === "return" && !detail.value.binding) void transition(detail.value, "returned");
  if (action === "cancel") void transition(detail.value, "cancelled");
  if (action === "delete") void remove(detail.value);
}
const rows = ref<DemandListItem[]>([]),
  listLoading = ref(false),
  listReadError = ref(""),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  sortKey = ref(""),
  sortDirection = ref("desc"),
  columnFilters = ref<Record<string, string>>({}),
  detail = ref<DemandRecord | null>(null),
  dialog = ref(false),
  editing = ref<DemandRecord | null>(null),
  history = ref(false),
  quoteOpen = ref(false),
  showDeleted = ref(false);

const selection = usePageSelection(rows, () => JSON.stringify([query.value, showDeleted.value, columnFilters.value]), "demands");
const { selected, selectedIds, eligibleIds } = selection;
const handling = useHandlingReview();


const batchLinkItems = ref<HandlingTarget[] | null>(null);
function selectedTargets() {
  return selected.value.map(row => ({ id: row.id, expected_version: row.current_version }));
}
async function finishBatch(ids: string[]) {
  selection.remove(ids);
  projectPickerOpen.value = false;
  batchLinkItems.value = null;
  await load();
}
function confirmSelectedDemands() {
  void handling.review({
    title: "核对批量确认", description: "确认需求成立。只有下方标为可办理的记录会提交。",
    targets: selectedTargets(), previewPath: "/demands/confirm-batch/preview",
    commitPath: "/demands/confirm-batch", complete: finishBatch,
  });
}
function openBatchProjectPicker() {
  batchLinkItems.value = selectedTargets();
  projectSearch.value = "";
  projectPage.value = 1;
  projectPickerOpen.value = true;
  void loadProjectCandidates();
}
function reviewBatchLink() {
  const targets = batchLinkItems.value;
  const project = projectCandidates.value.find(row => row.id === selectedProjectId.value && !ordinaryLinkReason(row));
  if (!targets || !project || projectLoading.value) return;
  const path = "/projects/" + encodeURIComponent(project.id) + "/link-batch";
  void handling.review({
    title: "核对批量关联", description: "目标项目：" + project.name + "。每条可办理需求均按全部位置和工作量承接。",
    targets, previewPath: path + "/preview", commitPath: path,
    payload: items => ({ links: items.map(row => ({ demand_id: row.id, expected_version: row.expected_version })) }),
    complete: finishBatch,
  });
}
const restoredDraft = ref<Record<string, unknown> | null>(null);
const detailAttributes = ref<OperationAttribute[]>([]);
const demandStatuses = ["待确认", "已退回", "待承接", "已承接", "已取消"] as const;
// The tabs and the visible '需求状态' column share one filter source.
// There is no longer a hidden handling_view column.
const processing = computed({
  get: () => demandStatuses.find(value => value === columnFilters.value.display_status) || "",
  set: value => {
    const next = {...columnFilters.value};
    if (value) next.display_status = value;
    else delete next.display_status;
    columnFilters.value = next;
    page.value = 1;
    void load();
  },
});
function displayStatus(row: Pick<DemandRecord, "status" | "binding">) {
  return demandDisplayStatus(row.status, Boolean(row.binding));
}
let attributeSequence = 0;
watch(() => detail.value?.operation_id + "/" + detail.value?.operation_version, async () => {
  const sequence = ++attributeSequence;
  detailAttributes.value = [];
  const current = detail.value;
  if (!current) return;
  try {
    const response = await api<{items: OperationAttribute[]}>(
      "/catalog/operations/" + current.operation_id + "/attributes?version=" + current.operation_version,
    );
    if (sequence === attributeSequence) detailAttributes.value = response.items;
  } catch (error) {
    if (sequence === attributeSequence) ElMessage.error("需求采用的操作属性读取失败：" + (error as Error).message);
  }
});
function valueAt(row:object,key:string):unknown {
  return formatVisibleDateTime((row as Record<string,unknown>)[key], key);
}
function attributeSummary(values: Record<string, unknown>) {
  return Object.entries(values || {}).map(([key,value]) => {
    const field=detailAttributes.value.find(item=>item.key===key);
    const display=field && "options" in field ? field.options.find(option=>option.value===value)?.label || String(value) : String(value);
    return (field?.label || "历史属性")+" · "+display;
  }).join(" / ") || "—";
}
function configureMissingOperation() {
  const listUrl = router.resolve({ name: "demands", params: { editMode: "", demandId: "" }, query: route.query }).fullPath;
  void router.push(setupContext({ fullPath: listUrl }, "operations"));
}
async function resumeDemandDraft() {
  if (route.query.resume !== "demand") return;
  const parked=takeDemandDraft();
  const {resume,...rest}=route.query;void resume;
  await router.replace({query:rest});
  if (parked) { restoredDraft.value = parked.form; await openEditorRoute(); }
}
const demandLocationColumns: TableColumn[] = [
  { key: "location_snapshot_json", label: "位置", minWidth: 230, sortable: false, filterable: false },
  { key: "quantity_scaled", label: "数量", minWidth: 135 },
  { key: "work_mode", label: "作业方式", minWidth: 130 },
  { key: "attributes", label: "附加属性", minWidth: 230, sortable: false, filterable: false },
];
const projectPickerColumns: TableColumn[] = [
  { key: "name", label: "项目名称", minWidth: 210 },
  { key: "code", label: "项目编号", minWidth: 150 },
  { key: "display_status", label: "项目状态", minWidth: 115 },
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
  { key: "problem_description", label: "问题描述", minWidth: 230, hideable: false },
  { key: "line_summary", label: "涉及线路", minWidth: 180 },
  { key: "display_status", filterable: false, label: "需求状态", minWidth: 130, hideable: false },
  { key: "expected_on", label: "预计解决时间", minWidth: 155 },
  { key: "quantity_scaled", label: "工作量" },
  { key: "unit_snapshot", label: "计量单位" },
  { key: "location_count", label: "位置数量" },
  { key: "operation_snapshot", label: "操作类型", minWidth: 160 },
  { key: "demand_no", label: "需求编号", minWidth: 150 },
  { key: "project_name", label: "承接项目", minWidth: 170 },
  { key: "last_handled_at", label: "最近办理时间", minWidth: 200 },
];
function sortTable(value: { key: string; order: string }) {
  sortKey.value = value.key;
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  load();
}
const pendingSearch = ref(query.value);
watch(query, (value) => { pendingSearch.value = value; }, { immediate: true });
function applySearch() {
  query.value = pendingSearch.value.trim();
  resetListPage();
}
function clearSearchAndColumns() {
  query.value = "";
  columnFilters.value = processing.value ? { display_status: processing.value } : {};
  page.value = 1;
  void load();
}
function filterTable(value: Record<string, string>) {
  columnFilters.value = value;
  page.value = 1;
  load();
}
const appliedQuery = ref("");
const exportQuery = computed(() => listLoading.value || listReadError.value ? "" : appliedQuery.value);
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  listLoading.value = true;
  listReadError.value = "";
  try {
    const parameters = new URLSearchParams({
      page: String(page.value), q: query.value, deleted: String(showDeleted.value),
      sort: sortKey.value || "created_at", direction: sortDirection.value,
      filters: JSON.stringify(columnFilters.value),
    });
    const result = await api<Page<DemandListItem>>(`/demands?${parameters}`);
    if (sequence !== loadSequence) return;
    appliedQuery.value = parameters.toString();
    rows.value = result.items;
    total.value = result.total;
    void workRoute.restoreScroll();
    const id = detail.value?.id;
    if (id) {
      const updated = await api<DemandRecord>("/demands/" + id + "?deleted=true");
      if (sequence === loadSequence && detail.value?.id === id) detail.value = updated;
    }
  } catch (error) {
    if (sequence === loadSequence) listReadError.value = (error as Error).message;
  } finally {
    if (sequence === loadSequence) listLoading.value = false;
  }
}
function openEditorRoute(row?: {id:string}) {
  return workRoute.enter({
    name: "demands",
    params: { editMode: row ? "edit" : "new", demandId: row?.id || "" },
    query: route.query,
  });
}
function edit(row?: {id:string}) {
  restoredDraft.value = null;
  return openEditorRoute(row);
}
async function readEditor() {
  const request = ++editorRequest;
  editorError.value = "";
  dialog.value = false;
  if (!editorRoute.value) return;
  try {
    const id = route.params.demandId;
    if (editorRoute.value === "edit" && typeof id !== "string") throw new Error("缺少需求编号");
    const record = editorRoute.value === "edit" ? await api<DemandRecord>("/demands/" + id) : null;
    if (request !== editorRequest) return;
    if (!can("write") || record?.deleted) throw new Error("当前账号或需求状态无法办理修订");
    editing.value = record;
    dialog.value = true;
  } catch (error) {
    if (request === editorRequest) editorError.value = (error as Error).message;
  }
}
function leaveEditor() {
  return workRoute.exit({
    name: "demands", params: { editMode: "", demandId: "" }, query: route.query,
  });
}
async function saved(id:string) {
  await leaveEditor();
  ElMessage.success("需求版本已保存");
  await load();
  await detailDialog.open(id);
}
async function transition(row: DemandListItem | DemandRecord, status: DemandStatus) {
  if (status === "returned" && row.binding) {
    ElMessage.warning("需求已关联子项目，不能退回；请先办理正式修订或根据项目规则显式解绑");
    return;
  }
  try {
    await ElMessageBox.confirm(
      status === "active" ? "确认本需求成立并进入待承接状态？随后可关联子项目。" :
        status === "returned" ? "确认退回未关联项目的需求？退回后需再次审核确认，才能重新办理承接。" :
        "确认取消该需求？取消后不能重新激活；若已关联子项目，请先显式解绑。",
      statusText[status],
    );
    const timeline = await api<{events:{event_seq:number}[]}>("/demands/" + row.id + "/history");
    await api("/demands/" + row.id + "/status", "POST", {
      status,
      expected_version: row.current_version,
      expected_event_seq: timeline.events.at(-1)!.event_seq,
    });
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function removeSource(source: SourceRow) {
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
function showHistory() { history.value = true; }
async function remove(row: DemandListItem | DemandRecord) {
  try {
    await ElMessageBox.confirm(
      "删除后从正常列表移除，正式历史继续可查。须先取消需求并解除当前关联。",
      "删除需求",
    );
    await api("/demands/" + row.id, "DELETE", {
      expected_version: row.current_version,
    });
    closeDetails();
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
useListRoute({ q: query, page, deleted: showDeleted, sort: sortKey, direction: sortDirection, filters: columnFilters }, load, () => route.name === "demands" && !editorRoute.value);
const detailDialog = useEntityDialog(detail, id => api('/demands/' + id + '?deleted=true'), () => { dialog.value = false; history.value = false; quoteOpen.value = false; });
function closeDetails() {
  const origin = contextOrigin(router, route.query.returnTo, "projects", "dashboard");
  if (origin && (origin.name === "dashboard" || typeof origin.query.project === "string")) {
    void workRoute.exit(origin.fullPath);
    return;
  }
  detailDialog.close();
  if (typeof route.query.demand === "string") {
    const query = { ...route.query };
    delete query.demand;
    delete query.returnTo;
    void router.replace({ query });
  }
}
watch(() => route.query.demand, demandId => {
  if (!editorRoute.value && typeof demandId === "string" && demandId && demandId !== detail.value?.id)
    void detailDialog.open(demandId);
}, { immediate: true });
const { isOpen: detailOpen, loading: detailLoading, error: detailError } = detailDialog;
watch([editorRoute, () => route.params.demandId], readEditor, { immediate: true });
onMounted(async () => {
  await load();
  await resumeDemandDraft();
});
</script>
<template>
  <div v-show="!editorRoute">
  <div class="page-heading">
      <div>
        <h1>专业需求</h1>
      </div>

    </div>
    <ElTabs v-model="processing" aria-label="按需求状态筛选">
      <ElTabPane label="全部需求" name="" />
      <ElTabPane v-for="state in demandStatuses" :key="state" :label="state" :name="state" />
    </ElTabs>
    <div class="panel">
      <ElAlert v-if="listReadError" :title="listReadError" type="error" :closable="false">
        <p v-if="rows.length">当前显示上次成功读取的结果。</p>
        <ElButton link type="primary" @click="load">重试</ElButton>
      </ElAlert>
      <BusinessTable :search-active="!!query" @clear-search="clearSearchAndColumns" :fixed-filter-keys="['display_status']" :loading="listLoading" :rows="rows" :columns="demandColumns" table-key="demand:list" selectable :filter-state="columnFilters"
        :sort-state="{ prop: sortKey, order: sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
        @selection-change="selection.updatePage" :selected-ids="selectedIds" @sort-change="sortTable" @filter-change="filterTable">
        <template #toolbar="{ openSettings, clearFilters, hasActiveFilters, appliedFilters }">
      <div v-if="selected.length" class="toolbar selection-toolbar" aria-label="专业需求批量操作">
        <span role="status">已选 {{ selected.length }} 条</span>
        <span class="muted">共 {{ total }} 条</span>
        <ExcelExportButton kind="demands" guide-action="demands.export-selection" :selected-ids="eligibleIds"
          :disabled="!exportQuery || eligibleIds.length !== selected.length" />
        <ExchangePanel v-if="eligibleIds.length === selected.length" kind="demands" :selected-ids="eligibleIds"
          :applied-query="exportQuery" @changed="load" @inspect="detailDialog.open($event)" />
        <span v-if="selected.some(row => row.display_status !== '待确认' || row.deleted) &&
          selected.some(row => row.display_status === '待确认' && !row.deleted) && can('demand.activate')" class="muted">
          批量确认仅处理已选中的待确认需求
        </span>
        <span v-if="selected.some(row => row.display_status !== '待承接' || row.deleted) &&
          selected.some(row => row.display_status === '待承接' && !row.deleted) && can('write')" class="muted">
          批量关联仅处理已选中的待承接需求
        </span>
        <ElButton data-guide-action="demands.batch-confirm" v-if="selected.some(row => row.display_status === '待确认' && !row.deleted) && can('demand.activate')" type="primary" :disabled="selected.length > 100" @click="confirmSelectedDemands">批量确认</ElButton>
        <ElButton data-guide-action="demands.batch-link" v-if="selected.some(row => row.display_status === '待承接' && !row.deleted) && can('write')" type="primary" :disabled="selected.length > 100" @click="openBatchProjectPicker">批量关联子项目</ElButton>
        <ElButton link @click="selection.clear">清空选择</ElButton>
        <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
        <span v-if="selected.length > 100" class="muted">每次批量办理最多 100 条</span>
        <span v-else-if="eligibleIds.length !== selected.length" class="muted">导出前请取消勾选已删除记录</span>
      </div>
          <div v-else class="unified-list-tools">
            <div class="toolbar">
        <ElInput
          v-model="pendingSearch"
          placeholder="需求编号、问题或位置"
          clearable
          @change="applySearch" @keyup.enter="applySearch"
        />
            <ElCheckbox data-guide-action="demands.show-deleted" v-model="showDeleted" @change="resetListPage"
          >包含已删除</ElCheckbox
        >
              <span role="status" class="muted">共 {{ total }} 条</span>
              <ElTag v-for="condition in appliedFilters" :key="condition.label" effect="plain">{{ condition.label }} · {{ condition.value }}</ElTag>
              <ElButton v-if="hasActiveFilters" link type="primary" @click="clearFilters">清除检索与列筛选</ElButton>
            </div>
            <div class="toolbar page-heading-actions">
              <ElButton :loading="listLoading" @click="load">刷新</ElButton>
              <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>

        <ExcelExportButton kind="demands" :total="total" :applied-query="exportQuery" />
        <ExchangePanel kind="demands" :total="total" :applied-query="exportQuery"
          @changed="load" @inspect="detailDialog.open($event)"
        /><ElButton data-guide-action="demands.create" v-if="can('write')" type="primary" @click="edit()"
          >新增需求</ElButton
        >

            </div>
          </div>
        </template>
        <template #cell="{ row, column }">
          <ElButton v-if="column.key === 'problem_description'" link type="primary" class="cell-link"
            @click="detailDialog.open(row.id)">{{ row.problem_description }}</ElButton>
          <span v-else-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</span>
          <span v-else-if="column.key === 'work_locations'">{{ row.work_locations?.length || 0 }} 处</span>
          <span v-else-if="column.key === 'binding'">{{ row.binding ? '已关联子项目' : '未关联' }}</span>
          <template v-else-if="column.key === 'display_status'">
            <ElTag effect="plain" :type="row.display_status === '已承接' ? 'success' : row.display_status === '已取消' ? 'info' : row.display_status === '已退回' ? 'warning' : undefined">{{ row.display_status }}</ElTag>
            <ElTag v-if="row.deleted" type="danger" effect="plain">已删除</ElTag>
          </template>
          <span v-else>{{ valueAt(row,column.key) ?? '—' }}</span>
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
  </div>
  <BusinessDetailDialog :open="detailOpen && !editorRoute" title="需求详情" :loading="detailLoading" :error="detailError"
    @close="closeDetails" @retry="detailDialog.reload">
    <template v-if="detail"><div class="detail-header" :data-guide-record="'demand/' + detail.id">
      <div>
        <h1>{{ detail.operation_snapshot }} · {{ detail.problem_description }}</h1>
        <div class="muted demand-technical-reference">需求编号 <BusinessNumber :value="detail.demand_no" label="需求编号" /> · 正式定义第{{ detail.current_version }}版</div>
      </div>
      <ElTag :type="displayStatus(detail) === '已承接' ? 'success' : displayStatus(detail) === '已退回' ? 'warning' : 'info'">{{ displayStatus(detail) }}</ElTag>
    </div>
    <div class="panel demand-next-action">
      <div class="toolbar">
        <div>
          <h2>当前办理状态</h2>
          <p class="muted">
            {{ detail.status === 'pending' ? '需求尚未确认；确认后进入待承接。' :
              detail.status === 'returned' ? '需求已退回，须核对或修订后重新确认。' :
              detail.status === 'active' && !detail.binding ? '需求处于待承接状态，下一步可纳入子项目。' :
              detail.status === 'active' && detail.binding ? '需求已由子项目承接，可继续办理入库和批准。' :
              '需求已取消，正式定义及历史仍可追溯。' }}
          </p>
        </div>
        <ElButton v-if="['pending','returned'].includes(detail.status)"
          type="primary" :disabled="!can('demand.activate') || detail.deleted"
          :title="can('demand.activate') ? undefined : '需要需求确认权限，请交由审核人员办理'"
          data-guide-action="demands.confirm" @click="transition(detail,'active')">
          确认并待承接
        </ElButton>
        <ElButton v-else-if="detail.status === 'active' && !detail.binding"
          type="primary" :disabled="!can('write') || detail.deleted"
          :title="can('write') ? undefined : '关联子项目需要编辑权限'"
          data-guide-action="demands.link" @click="openProjectPicker">
          关联子项目
        </ElButton>
        <ElButton data-guide-action="demands.open-linked" v-else-if="detail.binding?.project_id" type="primary" @click="openLinkedProject">
          进入承接项目
        </ElButton>
        <ElButton data-guide-action="demands.edit" :disabled="!can('write') || detail.deleted || detail.status === 'cancelled'"
          :title="detail.status === 'cancelled' ? '需求已取消，只能查看正式历史' :
            can('write') ? undefined : '修订需求需要编辑权限'"
          @click="edit(detail)">修订需求</ElButton>
        <ElButton data-guide-action="demands.history" @click="showHistory">历史记录</ElButton>
        <ElDropdown trigger="click" @command="secondaryAction">
          <ElButton :data-guide-menu="[
            'demands.quote', 'demands.delete', detail.status === 'active' ? 'demands.return' : '',
            detail.status !== 'cancelled' ? 'demands.cancel' : '',
          ].join(' ')">更多操作</ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem data-guide-action="demands.quote" command="quote">参考价试算</ElDropdownItem>
              <ElDropdownItem v-if="detail.status === 'active'" data-guide-action="demands.return" command="return" :title="detail.binding ? '已承接的需求不能退回，请正式修订或先明确解绑' : undefined" :disabled="!can('demand.activate') || detail.deleted || !!detail.binding">退回</ElDropdownItem>
              <ElDropdownItem v-if="detail.status !== 'cancelled'" data-guide-action="demands.cancel" command="cancel" :title="detail.binding ? '需求已被子项目承接，请先办理显式解绑' : undefined" :disabled="!can('demand.activate') || detail.deleted || !!detail.binding" divided>取消需求</ElDropdownItem>
              <ElDropdownItem data-guide-action="demands.delete" command="delete" :title="detail.status !== 'cancelled' ? '需要先取消需求且解除项目关联' : undefined" :disabled="!can('admin') || detail.deleted || detail.status !== 'cancelled'">删除</ElDropdownItem>
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
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="预计解决时间">{{ detail.expected_on || "未填写" }}</ElDescriptionsItem></ElDescriptions
      >
    </div>
    <div class="panel" v-if="Object.keys(detail.attributes || {}).length">
      <h2>需求附加属性</h2><p>{{attributeSummary(detail.attributes)}}</p>
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
          <span v-else-if="column.key === 'attributes'">{{attributeSummary(row.attributes)}}</span>
          <span v-else>{{ valueAt(row,column.key) ?? '—' }}</span>
        </template>
      </BusinessTable>
    </div>
    <div class="panel">
      <h2>来源与预计物资</h2>
      <p v-for="source in detail.sources" :key="source.id">
        {{ source.description }}
        <span class="muted">{{ source.discovered_on }}</span
        ><ElButton data-guide-action="demands.source-correct" :disabled="!can('write') || detail.deleted" size="small" @click="edit(detail)"
          >更正</ElButton
        ><ElButton data-guide-action="demands.source-delete"
          :disabled="!can('admin') || detail.deleted"
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
          <span v-else>{{ valueAt(row,column.key) ?? '—' }}</span>
        </template>
      </BusinessTable>
    </div>
    <EvidencePanel
      :key="detail.id"
      owner-kind="demand_id"
      :owner-id="detail.id"
  /></template>
  </BusinessDetailDialog>
  <BusinessWorkSurface v-if="editorRoute && !dialog" title="专业需求办理" @back="leaveEditor">
    <ElAlert v-if="editorError" :title="editorError" type="error" :closable="false">
      <ElButton text @click="readEditor">重新读取</ElButton>
    </ElAlert>
    <ElSkeleton v-else :rows="5" animated />
  </BusinessWorkSurface>
  <DemandEditor :open="dialog && !!editorRoute" :editing="editing" :restored="restoredDraft"
    @update:open="!$event && leaveEditor()" @saved="saved" @configure="configureMissingOperation" />
  <ElDialog v-model="projectPickerOpen" append-to-body title="选择子项目承接需求"
    width="min(840px, 94vw)" :close-on-click-modal="false">
    <p v-if="batchLinkItems">已选 {{ batchLinkItems.length }} 条需求，请选择承接项目。</p>
    <p v-else-if="detail" class="muted">待承接：{{ detail.operation_snapshot }} · {{ detail.problem_description }}</p>
    <div class="toolbar">
      <ElInput v-model="projectSearch" clearable placeholder="搜索子项目名称或编号"
        @change="projectPage = 1; loadProjectCandidates()" @keyup.enter="projectPage = 1; loadProjectCandidates()" />
      <ElButton @click="projectPage = 1; loadProjectCandidates()">查找</ElButton>
      <ElButton v-if="!batchLinkItems" data-guide-action="demands.project-create" :disabled="!can('write')" @click="createProjectAndLink">创建子项目并承接</ElButton>
    </div>
    <BusinessTable :rows="projectCandidates" :columns="projectPickerColumns"
      table-key="demand:project-picker" client-side :loading="projectLoading"
      :actions-width="100" max-height="400">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'display_status'">{{ row.display_status }}</span>
        <span v-else>{{ valueAt(row,column.key) || '—' }}</span>
      </template>
      <template #actions="{ row }">
        <ElTooltip :content="ordinaryLinkReason(row)" :disabled="!ordinaryLinkReason(row)">
          <span><ElButton size="small" :type="selectedProjectId === row.id ? 'primary' : undefined"
            :disabled="projectLoading || !!ordinaryLinkReason(row)"
            @click="selectedProjectId = row.id">
            {{ ordinaryLinkReason(row) ? "不可选" : selectedProjectId === row.id ? "已选中" : "选择" }}
          </ElButton></span>
        </ElTooltip>
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="projectPage" :page-size="20" :total="projectTotal"
      layout="prev, pager, next, total" @current-change="loadProjectCandidates" />
    <template #footer>
      <ElButton @click="projectPickerOpen = false">取消</ElButton>
      <ElButton data-guide-action="demands.link-submit" type="primary" :loading="linking" :disabled="!selectedProjectId || !can('write') || linking || projectLoading"
        @click="batchLinkItems ? reviewBatchLink() : linkSelectedProject()">{{ batchLinkItems ? "核对承接清单" : "承接该需求" }}</ElButton>
    </template>
  </ElDialog>
  <HandlingReviewDialog :workflow="handling" />
  <PricingQuoteDialog
    v-if="detail"
    v-model="quoteOpen"
    :demand-id="detail.id"
    :expected-version="detail.current_version"
    @confirmed="load"
  />
  <ElDialog append-to-body
    :model-value="!!history"
    title="需求历史记录"
    width="min(1160px, 94vw)"
    destroy-on-close
    @close="history = false"
  >
    <BusinessHistory v-if="history && detail" record-kind="demands" :record-id="detail.id" />
  </ElDialog>
</template>

<style scoped>
.demand-technical-reference {font-size:12px;margin-top:6px}
.demand-next-action {border-color:var(--edge)}
.demand-next-action .toolbar {justify-content:space-between;flex-wrap:wrap;gap:12px}
.demand-next-action h2 {margin:0}
.demand-next-action p {margin:6px 0 0}
</style>
