<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, money, statusText, type Row } from "../../shared/api/client";
import type { Page } from "../../../../server/shared/types/contracts";
import type { FinanceListItem, FinanceRecordDetail } from "../../../../server/shared/types/finance";
import { useListRoute } from "../../shared/composables/use-list-route";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import FinancePanel from "./FinancePanel.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import RowActions from "../../shared/ui/RowActions.vue";
import { projectContext, type BusinessFocus } from "../../shared/navigation/business-context";

interface ProjectListItem {
  id: string;
  name: string;
  code: string;
  status: string;
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
const recordContent = ref<FinanceRecordDetail | FinanceRecordDetail[] | null>(null);
const recordOpen = ref(false), recordLoading = ref(false), recordError = ref("");
let recordSequence = 0;
const recordTitle = computed(() => kind.value === "costs" ? "真实费用记录" :
  kind.value === "settlements" ? "独立结算单" : "正式费用核对记录");
const currentRecord = computed<FinanceRecordDetail | null>(() => {
  if (!recordContent.value) return null;
  if (Array.isArray(recordContent.value))
    return [...recordContent.value].sort((a, b) => (b.version_no ?? 0) - (a.version_no ?? 0))[0] || null;
  return recordContent.value;
});
const recordVersions = computed(() => Array.isArray(recordContent.value) ? recordContent.value : null);
async function viewRecord(row: FinanceListItem) {
  const sequence = ++recordSequence;
  selectedRecord.value = row; recordOpen.value = true;
  recordLoading.value = true; recordContent.value = null; recordError.value = "";
  const path = kind.value === "costs"
    ? `/projects/${row.project_id}/costs/${row.id}`
    : kind.value === "settlements" ? `/settlements/${row.id}`
    : `/reconciliations/${row.id}`;
  try {
    const result = await api<FinanceRecordDetail | FinanceRecordDetail[]>(path);
    if (sequence === recordSequence) recordContent.value = result;
  } catch (failure) {
    if (sequence === recordSequence) recordError.value = (failure as Error).message;
  } finally {
    if (sequence === recordSequence) recordLoading.value = false;
  }
}
function openProjectForRecord(record: FinanceListItem) {
  const focus: BusinessFocus = kind.value === "costs" ? "cost" :
    kind.value === "settlements" ? "settlement" : "reconciliation";
  void router.push(projectContext(record.project_id, "finance", { focus, record: record.id }));
}
const rows = ref<FinanceListItem[]>([]), total = ref(0), page = ref(1), query = ref("");
const sort = ref(""), direction = ref("desc"), filters = ref<Record<string, string>>({});
const deleted = ref(false), loading = ref(false), error = ref("");
const project = ref<Row | null>(null);
const detailDialog = useEntityDialog(project, id => api("/projects/" + id + "?deleted=true"), () => {});
const { isOpen, loading: detailLoading, error: detailError } = detailDialog;
const settlementItemColumns: TableColumn[] = [
  { key: "amount_fen", label: "费用金额", minWidth: 150 },
  { key: "quantity_scaled", label: "本次解决数量", minWidth: 145 },
  { key: "evidence", label: "结算依据", minWidth: 200 },
];
const columns = computed<TableColumn[]>(() => [
  { key: "project_name", label: "子项目", minWidth: 210 },
  { key: "label", label: kind.value === "projects" ? "项目编号" : kind.value === "settlements" ? "结算编号" : "费用事项", minWidth: 190 },
  { key: "amount_fen", label: kind.value === "projects" ? "批准预算" : kind.value === "costs" ? "实际金额" : kind.value === "settlements" ? "本次金额" : "核对结算金额", minWidth: 140, sortable: kind.value !== "projects", filterable: kind.value !== "projects" },
  { key: "status", label: "状态", minWidth: 110 },
  ...(kind.value === "projects" ? [] : [{ key: "occurred_on", label: "业务日期", minWidth: 130 }]),
]);
let sequence = 0;
function projectKey(key: string): string {
  return key === "project_name" ? "name" : key === "label" ? "code" : key;
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
        status: item.status, version_no: item.profile_version, occurred_on: null, deleted: item.deleted }));
      total.value = result.total;
    } else {
      const result = await api<Page<FinanceListItem>>("/finance/" + kind.value + "?" + parameters);
      if (current !== sequence) return;
      rows.value = result.items; total.value = result.total;
    }
  } catch (failure) {
    if (current === sequence) error.value = (failure as Error).message;
  } finally { if (current === sequence) loading.value = false; }
}
function reset() { page.value = 1; void load(); }
async function refreshProject() {
  const id = project.value?.id;
  if (id) {
    const value = await api<Row>("/projects/" + id + "?deleted=true");
    if (project.value?.id === id) project.value = value;
  }
  void load();
}
useListRoute({ page, q: query, sort, direction, filters, deleted }, load);
watch(kind, () => {
  rows.value = []; error.value = ""; recordOpen.value = false; recordContent.value = null;
  void load();
});
onMounted(() => { void load(); });
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="section-caption">财务业务办理</div>
      <h1>费用与结算</h1>
      <p>优先按子项目办理费用、分次结算与核对；跨项目记录可直接查看正式详情。</p>
    </div>
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
    <div class="toolbar"><ElInput v-model="query" clearable placeholder="搜索子项目、编号或费用事项" @change="reset" />
      <ElCheckbox data-guide-action="finance.show-deleted" v-model="deleted" @change="reset">包含已删除</ElCheckbox><ElButton @click="load">刷新</ElButton></div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false"><ElButton text @click="load">重试</ElButton></ElAlert>
    <BusinessTable :search-active="!!query" @clear-search="query = ''; filters = {}; page = 1; load()" :table-key="'finance:cross:' + kind" :rows="rows" :columns="columns" :loading="loading" :filter-state="filters"
      :sort-state="{ prop: sort, order: sort ? (direction === 'asc' ? 'ascending' : 'descending') : null }"
      @sort-change="value => { sort = value.key; direction = value.order === 'ascending' ? 'asc' : 'desc'; reset(); }"
      @filter-change="value => { filters = value; reset(); }">
      <template #cell="{ row, column, value }"><ElTag v-if="column.key === 'status'" effect="plain">{{ row.deleted ? '已删除' : statusText[row.status] || row.status }}</ElTag><span v-else-if="column.key === 'amount_fen'">{{ row.amount_fen == null ? (kind === 'projects' ? '尚未批准' : '—') : money(row.amount_fen) }}</span><span v-else>{{ value ?? '—' }}</span></template>
      <template #actions="{ row }">
        <RowActions :actions="kind === 'projects'
          ? [{ label: '进入项目办理', run: () => detailDialog.open(row.project_id) }]
          : [
            { label: '查看记录', run: () => viewRecord(row) },
            { label: '查看所属项目', run: () => openProjectForRecord(row) },
          ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="page" :total="total" :page-size="30" layout="prev,pager,next,total" @current-change="load" />
  </div>
  <BusinessDetailDialog :open="recordOpen" :title="recordTitle"
    :loading="recordLoading" :error="recordError"
    @close="recordOpen = false"
    @retry="selectedRecord && viewRecord(selectedRecord)">
    <template v-if="selectedRecord && recordContent">
      <div class="detail-header">
        <h1>{{ selectedRecord.label }}</h1>
        <ElTag effect="plain">{{ statusText[selectedRecord.status] || selectedRecord.status }}</ElTag>
      </div>
      <div class="toolbar">
        <ElButton type="primary" plain @click="openProjectForRecord(selectedRecord)">
          查看所属项目：{{ selectedRecord.project_name }}
        </ElButton>
      </div>
      <div class="panel">
        <h2>当前正式事实</h2>
        <ElDescriptions :column="2" border>
          <ElDescriptionsItem label="所属子项目">{{ selectedRecord.project_name }}</ElDescriptionsItem>
          <ElDescriptionsItem label="记录事项">{{ selectedRecord.label }}</ElDescriptionsItem>
          <ElDescriptionsItem label="业务状态">{{ statusText[selectedRecord.status] || selectedRecord.status }}</ElDescriptionsItem>
          <ElDescriptionsItem label="业务日期">{{ selectedRecord.occurred_on || "—" }}</ElDescriptionsItem>
          <ElDescriptionsItem :label="kind === 'costs' ? '真实费用' : kind === 'settlements' ? '本次结算金额' : '核定结算金额'">
            {{ selectedRecord.amount_fen == null ? '未核定' : '¥' + money(selectedRecord.amount_fen) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem v-if="kind === 'costs'" label="凭据">{{ currentRecord?.evidence || '—' }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="kind === 'reconciliations'" label="实际费用份额">
            {{ currentRecord?.reconciled_cost_fen == null ? '—' : '¥' + money(currentRecord.reconciled_cost_fen) }}
          </ElDescriptionsItem>
          <ElDescriptionsItem v-if="kind === 'reconciliations'" label="核对依据">{{ currentRecord?.evidence || '—' }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="kind === 'settlements'" label="审核结果">
            {{ statusText[currentRecord?.review?.action || ''] || currentRecord?.review?.action || '待审核' }}
          </ElDescriptionsItem>
        </ElDescriptions>
      </div>
      <div v-if="kind === 'settlements'" class="panel">
        <h2>本次结算明细</h2>
        <BusinessTable :rows="currentRecord?.items || []" :columns="settlementItemColumns"
          table-key="finance:cross:settlement-items" client-side>
          <template #cell="{ row, column }">
            <span v-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</span>
            <span v-else-if="column.key === 'quantity_scaled'">{{ row.quantity_scaled == null ? '—' : row.quantity_scaled / 10000 }}</span>
            <span v-else>{{ column.key === 'evidence' ? (row.evidence || '—') : '—' }}</span>
          </template>
        </BusinessTable>
      </div>
      <div class="panel">
        <h2>版本与正式历史</h2>
        <BusinessHistory :value="recordVersions || recordContent" />
      </div>
    </template>
  </BusinessDetailDialog>
  <BusinessDetailDialog :open="isOpen" title="费用与结算" :loading="detailLoading" :error="detailError" @close="detailDialog.close" @retry="detailDialog.reload">
    <template v-if="project"><div class="detail-header"><h1>{{ project.name }}</h1><ElTag>{{ statusText[project.status] }}</ElTag></div>
      <ElTabs model-value="finance"><ElTabPane name="finance" label="费用与结算"><FinancePanel :project="project" @changed="refreshProject" /></ElTabPane></ElTabs>
    </template>
  </BusinessDetailDialog>
</template>
