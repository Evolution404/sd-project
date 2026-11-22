<script setup lang="ts">
import { projectStatusTag } from "../../shared/utils/project-status";
import { settlementStatusLabels, type SettlementWorkflow } from "../../../../server/shared/types/finance-workflows";
import { projectDisplayStatuses } from "../../../../server/shared/project-display-status";
import { computed, ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, money, statusText } from "../../shared/api/client";
import type { Page } from "../../../../server/shared/types/contracts";
import type { FinanceListKind, FinanceListItem, FinanceRecordDetail } from "../../../../server/shared/types/finance";
import { useListRoute } from "../../shared/composables/use-list-route";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import BusinessNumber from "../../shared/ui/BusinessNumber.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import { projectFinanceContext, type BusinessFocus } from "../../shared/navigation/business-context";
import { costStatusOptions, filterOptions, reconciliationStatusOptions } from "../../shared/utils/filter-options";

interface ProjectListItem {
  id: string;
  name: string;
  code: string;
  status: string;
  display_status: string;
  profile_version: number;
  approval: { approved_budget_fen: number } | null;
  deleted: boolean;
}
const route = useRoute(), router = useRouter();
const kind = computed({
  get: () => String(route.params.kind || "projects"),
  set: value => { void router.push({ name: "finance", params: { kind: value }, query: {} }); },
});
const mode = computed({
  get: () => kind.value === "projects" ? "projects" : "cross",
  set: (value: string) => { kind.value = value === "projects" ? "projects" : "costs"; },
});
const crossKind = computed({
  get: () => kind.value === "projects" ? "costs" : kind.value,
  set: (value: string) => { kind.value = value; },
});
const selectedRecord = ref<FinanceListItem | null>(null);
const recordContent = ref<FinanceRecordDetail | FinanceRecordDetail[] | SettlementWorkflow | null>(null);
const recordOpen = ref(false), recordLoading = ref(false), recordError = ref("");
let recordSequence = 0;
const recordTitle = computed(() => kind.value === "costs" ? "真实费用记录" :
  kind.value === "settlements" ? "独立结算单" : "正式费用核对记录");
const currentBill = computed(() => recordContent.value && "draft" in recordContent.value ? recordContent.value : null);
const settlementItems = computed(() => currentBill.value?.draft?.document.items ?? currentBill.value?.items ?? []);
const settlementResolutions = computed(() => currentBill.value?.draft?.document.resolutions ?? currentBill.value?.resolutions ?? []);
const currentRecord = computed<FinanceRecordDetail | null>(() => {
  if (!recordContent.value || "draft" in recordContent.value) return null;
  if (Array.isArray(recordContent.value))
    return [...recordContent.value].sort((a, b) => (b.version_no ?? 0) - (a.version_no ?? 0))[0] || null;
  return recordContent.value;
});
const recordHistoryOpen = ref(false);
async function viewRecord(row: FinanceListItem) {
  const sequence = ++recordSequence;
  selectedRecord.value = row; recordOpen.value = true; recordHistoryOpen.value = false;
  recordLoading.value = true; recordContent.value = null; recordError.value = "";
  const path = kind.value === "costs"
    ? `/projects/${row.project_id}/costs/${row.id}`
    : kind.value === "settlements" ? `/settlements/${row.id}`
    : `/reconciliations/${row.id}`;
  try {
    const result = await api<FinanceRecordDetail | FinanceRecordDetail[] | SettlementWorkflow>(path);
    if (sequence === recordSequence) recordContent.value = result;
  } catch (failure) {
    if (sequence === recordSequence) recordError.value = (failure as Error).message;
  } finally {
    if (sequence === recordSequence) recordLoading.value = false;
  }
}
async function restoreRecord(id: string) {
  if (kind.value === "projects") return;
  const sequence = ++recordSequence;
  recordOpen.value = true; recordLoading.value = true; recordError.value = "";
  selectedRecord.value = null; recordContent.value = null;
  const query = new URLSearchParams({ filters: JSON.stringify({ id }), deleted: "true", page_size: "1" });
  try {
    const result = await api<Page<FinanceListItem>>("/finance/" + kind.value + "?" + query);
    if (sequence !== recordSequence) return;
    const record = result.items.find(row => row.id === id);
    if (record) await viewRecord(record);
    else recordError.value = "找不到这条财务记录。";
  } catch (failure) {
    if (sequence === recordSequence) recordError.value = (failure as Error).message;
  } finally {
    if (sequence === recordSequence) recordLoading.value = false;
  }
}
function closeRecord() {
  recordSequence++;
  recordOpen.value = false;
  recordContent.value = null;
  if (typeof route.query.record === "string") {
    const { record: _, ...query } = route.query;
    void router.replace({ query });
  }
}
function retryRecord() {
  if (selectedRecord.value) void viewRecord(selectedRecord.value);
  else if (typeof route.query.record === "string") void restoreRecord(route.query.record);
}
function openProjectForRecord(record: FinanceListItem) {
  const focus: BusinessFocus = kind.value === "costs" ? "cost" :
    kind.value === "settlements" ? "settlement" : "reconciliation";
  const origin = router.resolve({ path: route.path, query: { ...route.query, record: record.id } }).fullPath;
  void router.push(projectFinanceContext(record.project_id, origin, { kind: focus, id: record.id }));
}
const rows = ref<FinanceListItem[]>([]), total = ref(0), page = ref(1), query = ref("");
const sort = ref(""), direction = ref("desc"), filters = ref<Record<string, string>>({});
const deleted = ref(false), loading = ref(false), error = ref("");
function openProjectFinance(projectId: string) {
  void router.push(projectFinanceContext(projectId, route.fullPath));
}
function recordStatus(status: string) {
  return statusOptionsForList.value.find(option => option.value === status)?.label ?? statusText[status] ?? status;
}
const projectStatusOptions = projectDisplayStatuses.map(label => ({ value: label, label }));
const settlementOptions = filterOptions(settlementStatusLabels);
const statusOptionsForList = computed(() => kind.value === "projects" ? projectStatusOptions
  : kind.value === "costs" ? costStatusOptions
    : kind.value === "settlements" ? settlementOptions : reconciliationStatusOptions);
const shownRecordStatus = computed(() => selectedRecord.value?.deleted ? "已删除"
  : recordStatus(selectedRecord.value?.status ?? ""));
const settlementItemColumns: TableColumn[] = [
  { key: "amount_fen", label: "费用金额", minWidth: 150 },
  { key: "quantity_scaled", label: "费用计量数量", minWidth: 145 },
  { key: "evidence", label: "结算依据", minWidth: 200 },
];
const columns = computed<TableColumn[]>(() => [
  { key: "project_name", label: "子项目", minWidth: 245, hideable: kind.value !== "projects" },
  { key: "label", label: kind.value === "projects" ? "项目编号" : kind.value === "settlements" ? "结算编号" : "费用事项", minWidth: 190, hideable: kind.value === "projects" },
  { key: "amount_fen", label: kind.value === "projects" ? "批准预算" : kind.value === "costs" ? "实际金额" : kind.value === "settlements" ? "本次金额" : "核对结算金额", minWidth: 140, sortable: kind.value !== "projects", filterable: kind.value !== "projects" },
  ...(kind.value === "settlements" ? [{ key: "effective_amount_fen", label: "当前生效", minWidth: 130, sortable: false, filterable: false }] : []),
  { key: "status", label: kind.value === "projects" ? "项目状态" : "状态", minWidth: 110, filterOptions: statusOptionsForList.value },
  ...(kind.value === "projects" ? [] : [{ key: "occurred_on", label: "业务日期", minWidth: 130 }]),
]);
let sequence = 0;
function projectKey(key: string): string {
  return key === "project_name" ? "name" : key === "label" ? "code"
    : key === "status" ? "display_status" : key;
}
async function load() {
  const current = ++sequence;
  loading.value = true; error.value = "";
  const isProjects = kind.value === "projects";
  const parameters = new URLSearchParams({ page: String(page.value), q: query.value,
    deleted: String(deleted.value), sort: (isProjects ? projectKey(sort.value) : sort.value) || "created_at",
    direction: direction.value, filters: JSON.stringify(isProjects
      ? Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [projectKey(key), value])) : filters.value) });
  try {
    if (isProjects) {
      const result = await api<Page<ProjectListItem>>("/projects?" + parameters);
      if (current !== sequence) return;
      rows.value = result.items.map(item => ({ id: item.id, project_id: item.id, project_name: item.name,
        project_code: item.code, label: item.code, amount_fen: item.approval?.approved_budget_fen ?? null,
        status: item.display_status, version_no: item.profile_version, occurred_on: null, deleted: item.deleted }));
      total.value = result.total;
    } else {
      const result = await api<Page<FinanceListItem>>("/finance/" + kind.value + "?" + parameters);
      if (current !== sequence) return;
      rows.value = result.items; total.value = result.total;
    }
  } catch (failure) {
    if (current === sequence) {
      error.value = (failure as Error).message;
    }
  } finally { if (current === sequence) loading.value = false; }
}
function reset() { page.value = 1; void load(); }
useListRoute({ page, q: query, sort, direction, filters, deleted }, load);
watch(kind, () => {
  recordSequence++;
  rows.value = []; total.value = 0; error.value = ""; recordOpen.value = false; recordContent.value = null;
  void load();
});
watch(() => route.query.record, id => {
  if (typeof id === "string" && id) void restoreRecord(id);
}, { immediate: true, flush: "post" });
onMounted(() => { void load(); });
</script>
<template>
  <div class="page-heading">
    <div><h1>费用与结算</h1></div>
  </div>
  <div class="toolbar finance-work-mode">
    <ElRadioGroup v-model="mode">
      <ElRadioButton value="projects" data-guide-action="finance.project-mode">按项目办理</ElRadioButton>
      <ElRadioButton value="cross" data-guide-action="finance.cross">跨项目查询</ElRadioButton>
    </ElRadioGroup>
  </div>
  <div v-if="mode === 'cross'" class="finance-record-kinds">
    <ElTabs v-model="crossKind">
      <ElTabPane name="costs" label="真实费用" />
      <ElTabPane name="settlements" label="结算单" />
      <ElTabPane name="reconciliations" label="费用核对" />
    </ElTabs>
  </div>
  <div class="panel">
    <ElAlert v-if="error" title="财务列表读取失败" type="error" :closable="false" show-icon>
      <p>{{ error }}{{ rows.length ? '。当前显示上次结果。' : '' }}</p>
      <ElButton link type="primary" @click="load">重试</ElButton>
    </ElAlert>
    <BusinessTable :search-active="!!query" @clear-search="query = ''; filters = {}; page = 1; load()" :table-key="'finance:cross:' + kind" :rows="rows" :columns="columns" :loading="loading" :filter-state="filters"
      :sort-state="{ prop: sort, order: sort ? (direction === 'asc' ? 'ascending' : 'descending') : null }"
      @sort-change="value => { sort = value.key; direction = value.order === 'ascending' ? 'asc' : 'desc'; reset(); }"
      @filter-change="value => { filters = value; reset(); }">
      <template #toolbar="{ openSettings, clearFilters, hasActiveFilters, appliedFilters }">
        <div class="unified-list-tools">
          <div class="toolbar">
            <ElInput v-model="query" clearable :placeholder="kind === 'projects' ? '搜索项目名称或编号' : '搜索子项目、编号或费用事项'"
              @change="reset" @keyup.enter="reset" />
            <ElCheckbox v-model="deleted" @change="reset" data-guide-action="finance.show-deleted">包含已删除</ElCheckbox>
            <ElTag v-for="condition in appliedFilters" :key="condition.label" effect="plain">{{ condition.label }} · {{ condition.value }}</ElTag>
            <ElButton v-if="hasActiveFilters" link type="primary" @click="clearFilters">清除检索与列筛选</ElButton>
          </div>
          <div class="toolbar">
            <ElButton :loading="loading" @click="load">刷新</ElButton>
            <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
          </div>
        </div>
      </template>
      <template #cell="{ row, column, value }">
        <ElButton v-if="kind === 'projects' && column.key === 'project_name'" link type="primary" class="cell-link"
          @click="openProjectFinance(row.project_id)">{{ row.project_name }}</ElButton>
        <ElButton v-else-if="kind !== 'projects' && column.key === 'label'" link type="primary" class="cell-link"
          @click="viewRecord(row)">{{ row.label }}</ElButton>
        <ElTag v-else-if="column.key === 'status'" effect="plain" :type="row.deleted ? 'danger'
          : kind === 'projects' ? projectStatusTag(row.status) : undefined">{{ row.deleted ? '已删除' : recordStatus(row.status) }}</ElTag>
        <span v-else-if="['amount_fen', 'effective_amount_fen'].includes(column.key)">
          {{ value == null ? (kind === 'projects' ? '尚未批准' : '—') : '¥' + money(Number(value)) }}
        </span>
        <span v-else>{{ value ?? '—' }}</span>
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="page" :total="total" :page-size="30" layout="prev,pager,next,total" @current-change="load" />
  </div>
  <BusinessDetailDialog :open="recordOpen" :title="recordTitle"
    :loading="recordLoading" :error="recordError"
    @close="closeRecord"
    @retry="retryRecord">
    <template v-if="selectedRecord && recordContent">
      <div class="detail-header">
        <h1>{{ selectedRecord.label }}</h1>
        <ElTag effect="plain">{{ shownRecordStatus }}</ElTag>
      </div>
      <div class="toolbar">
        <ElButton type="primary" plain @click="openProjectForRecord(selectedRecord)">
          查看所属项目：{{ selectedRecord.project_name }}
        </ElButton>
      </div>
      <div class="panel">
        <h2>{{ currentBill?.draft ? '当前草稿' : '当前正式事实' }}</h2>
        <ElDescriptions :column="2" border>
          <ElDescriptionsItem label="所属子项目">{{ selectedRecord.project_name }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="kind === 'settlements'" label="结算编号">
            <BusinessNumber :value="selectedRecord.label" label="结算编号" />
          </ElDescriptionsItem>
          <ElDescriptionsItem v-else label="记录事项">{{ selectedRecord.label }}</ElDescriptionsItem>
          <ElDescriptionsItem label="业务状态">{{ shownRecordStatus }}</ElDescriptionsItem>
          <ElDescriptionsItem label="业务日期">{{ selectedRecord.occurred_on || "—" }}</ElDescriptionsItem>
          <ElDescriptionsItem :label="kind === 'costs' ? '真实费用' : kind === 'settlements' ? '本次结算金额' : '核定结算金额'">
            {{ selectedRecord.amount_fen == null ? '未核定' : '¥' + money(selectedRecord.amount_fen) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem v-if="kind === 'costs'" label="凭据">{{ currentRecord?.evidence || '—' }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="kind === 'reconciliations'" label="实际费用份额">
            {{ currentRecord?.reconciled_cost_fen == null ? '—' : '¥' + money(currentRecord.reconciled_cost_fen) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem v-if="kind === 'reconciliations'" label="核对依据">{{ currentRecord?.evidence || '—' }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="kind === 'settlements'" label="当前生效金额">
            {{ selectedRecord.effective_amount_fen == null ? '尚无批准' : '¥' + money(selectedRecord.effective_amount_fen) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem v-if="currentBill?.review" label="最近一次审核">
            {{ settlementStatusLabels[currentBill.review.action] }}
          </ElDescriptionsItem>
          <ElDescriptionsItem v-if="currentBill?.review?.action === 'return'" label="退回原因">
            {{ currentBill.review.reason || '—' }}
          </ElDescriptionsItem>
        </ElDescriptions>
      </div>
      <div v-if="settlementItems.length" class="panel">
        <h2>{{ currentBill?.draft ? '草稿结算明细' : '本次结算明细' }}</h2>
        <BusinessTable :rows="settlementItems" :columns="settlementItemColumns"
          table-key="finance:cross:settlement-items" client-side>
          <template #cell="{ row, column }">
            <span v-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</span>
            <span v-else-if="column.key === 'quantity_scaled'">{{ row.quantity_scaled == null ? '—' : row.quantity_scaled / 10000 }}</span>
            <span v-else>{{ column.key === 'evidence' ? (row.evidence || '—') : '—' }}</span>
          </template>
        </BusinessTable>
      </div>
      <div v-if="settlementResolutions.length" class="panel">
        <h2>{{ currentBill?.draft ? '草稿需求解决量' : '最近提交的需求解决量' }}</h2>
        <BusinessTable :rows="settlementResolutions" :columns="[
          { key: 'resolved_quantity_scaled', label: '本次解决数量', minWidth: 150 },
          { key: 'evidence', label: '解决依据', minWidth: 200 },
        ]" table-key="finance:cross:settlement-resolutions" client-side>
          <template #cell="{ row, column }">
            {{ column.key === 'resolved_quantity_scaled' ? row.resolved_quantity_scaled / 10000 : (row.evidence || '—') }}
          </template>
        </BusinessTable>
      </div>
      <ElButton @click="recordHistoryOpen = !recordHistoryOpen">历史记录</ElButton>
      <BusinessHistory reveal v-if="recordHistoryOpen" :record-kind="crossKind as FinanceListKind"
        :record-id="selectedRecord.id" :project-id="selectedRecord.project_id" />
    </template>
  </BusinessDetailDialog>
</template>
