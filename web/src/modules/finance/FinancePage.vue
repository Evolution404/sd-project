<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, money, statusText, type Row } from "../../shared/api/client";
import type { Page } from "../../../../server/shared/types/contracts";
import type { FinanceListItem } from "../../../../server/shared/types/finance";
import { useListRoute } from "../../shared/composables/use-list-route";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import FinancePanel from "./FinancePanel.vue";

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
  get: () => String(route.params.kind || "costs"),
  set: value => { void router.push({ name: "finance", params: { kind: value }, query: {} }); },
});
const rows = ref<FinanceListItem[]>([]), total = ref(0), page = ref(1), query = ref("");
const sort = ref(""), direction = ref("desc"), filters = ref<Record<string, string>>({});
const deleted = ref(false), loading = ref(false), error = ref("");
const project = ref<Row | null>(null);
const detailDialog = useEntityDialog(project, id => api("/projects/" + id + "?deleted=true"), () => {});
const { isOpen, loading: detailLoading, error: detailError } = detailDialog;
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
    const value = await api("/projects/" + id + "?deleted=true");
    if (project.value?.id === id) project.value = value;
  }
  void load();
}
useListRoute({ page, q: query, sort, direction, filters, deleted }, load);
watch(kind, () => { page.value = 1; query.value = ""; sort.value = ""; filters.value = {}; deleted.value = false; void load(); });
onMounted(() => { void load(); });
</script>
<template>
  <div class="page-heading"><div><div class="section-caption">资金与结算</div><h1>费用与结算</h1><p>查询真实费用、独立结算和正式核对，进入子项目办理。</p></div><div class="page-heading-actions" /></div>
  <ElTabs v-model="kind">
    <ElTabPane name="costs" label="真实费用" /><ElTabPane name="settlements" label="结算单" />
    <ElTabPane name="reconciliations" label="费用核对" /><ElTabPane name="projects" label="项目办理" />
  </ElTabs>
  <div class="panel">
    <div class="toolbar"><ElInput v-model="query" clearable placeholder="搜索子项目、编号或费用事项" @change="reset" />
      <ElCheckbox v-model="deleted" @change="reset">包含已删除</ElCheckbox><ElButton @click="load">刷新</ElButton></div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false"><ElButton text @click="load">重试</ElButton></ElAlert>
    <BusinessTable :table-key="'finance:cross:' + kind" :rows="rows" :columns="columns" :loading="loading" :filter-state="filters"
      :sort-state="{ prop: sort, order: sort ? (direction === 'asc' ? 'ascending' : 'descending') : null }"
      @sort-change="value => { sort = value.key; direction = value.order === 'ascending' ? 'asc' : 'desc'; reset(); }"
      @filter-change="value => { filters = value; reset(); }">
      <template #cell="{ row, column }"><ElTag v-if="column.key === 'status'" effect="plain">{{ row.deleted ? '已删除' : statusText[row.status] || row.status }}</ElTag><span v-else-if="column.key === 'amount_fen'">{{ money(row.amount_fen) }}</span><span v-else>{{ row[column.key] ?? '—' }}</span></template>
      <template #actions="{ row }"><ElButton size="small" @click="detailDialog.open(row.project_id)">进入项目</ElButton></template>
    </BusinessTable>
    <ElPagination v-model:current-page="page" :total="total" :page-size="30" layout="prev,pager,next,total" @current-change="load" />
  </div>
  <BusinessDetailDialog :open="isOpen" title="费用与结算" :loading="detailLoading" :error="detailError" @close="detailDialog.close" @retry="detailDialog.reload">
    <template v-if="project"><div class="detail-header"><h1>{{ project.name }}</h1><ElTag>{{ statusText[project.status] }}</ElTag></div>
      <ElTabs model-value="finance"><ElTabPane name="finance" label="费用与结算"><FinancePanel :project="project" @changed="refreshProject" /></ElTabPane></ElTabs>
    </template>
  </BusinessDetailDialog>
</template>
