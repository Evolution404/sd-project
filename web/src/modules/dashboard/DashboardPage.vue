<script setup lang="ts">
import { settlementProgressText } from "../../shared/utils/settlement-progress";
import { computed, ref, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { useRouter } from "vue-router";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import { useAccess } from "../../shared/composables/use-access";
import { api, money } from "../../shared/api/client";
import type { Dashboard } from "../../../../server/shared/types/reporting";
type DashboardRow = Dashboard["portfolio"][number] | Dashboard["alerts"][number] |
  Dashboard["frameworks"][number] | Dashboard["months"][number] | Dashboard["quarters"][number];

const dashboard = ref<Dashboard>({
  demands: 0, pending_demands: 0, projects: 0, active_projects: 0,
  as_of: "", portfolio: [], alerts: [], frameworks: [], months: [], quarters: [],
});
function metricValue(key: string): number {
  if (key === "demands" || key === "pending_demands" ||
      key === "projects" || key === "active_projects") return dashboard.value[key];
  return 0;
}
const can = useAccess();
const loading = ref(true);
type QueueRow = { id: string; label: string; projectId?: string; reason?: string };
type QueueTask = { key: string; label: string; path: string; state: string; action?: string };
const queueRows = ref<Record<string, { total: number; records: QueueRow[] }>>({});
const queueErrors = ref<Record<string, string>>({});
const queue = computed<QueueTask[]>(() => [
  ...(can("demand.activate") ? [{ key: "confirm", label: "确认专业需求", path: "/demands", state: "待确认" }] : []),
  ...(can("write") ? [{ key: "compile", label: "编制项目立项", path: "/projects", state: "已入库" }] : []),
  ...(can("project.approve") ? [{ key: "initial", label: "审核项目立项", path: "/projects", state: "立项中" }] : []),
  ...(can("change.approve") ? [{ key: "change", label: "审核项目变更", path: "/projects", state: "变更中" }] : []),
  ...(can("settlement.approve") ? [{ key: "review", label: "审核结算", path: "/finance/settlements", state: "submit", action: "review" }] : []),
  ...(can("write") ? [{ key: "returned", label: "处理退回结算", path: "/finance/settlements", state: "return" }] : []),
]);
function taskFilters(task: QueueTask) {
  return JSON.stringify(task.path === "/finance/settlements" ? { status: task.state } : { display_status: task.state });
}
async function loadQueue() {
  queueErrors.value = {};
  const entries = await Promise.all(queue.value.map(async task => {
    try {
      const parameters = new URLSearchParams({ page_size: "5", filters: taskFilters(task) });
      if (task.path === "/finance/settlements") {
        const result = await api<{ total: number; items: Array<{ id: string; label: string; project_name: string; project_id: string }> }>(
          "/finance/settlements?" + parameters);
        return [task.key, { total: result.total, records: result.items.map(row => ({
          id: row.id, projectId: row.project_id, label: row.project_name + " · " + row.label,
        })) }] as const;
      }
      const endpoint = task.path === "/projects" ? "/projects/handling" : task.path;
      if (task.path === "/projects") parameters.set("task", task.key);
      const result = await api<{ total: number; items: Array<{ id: string; name?: string; reason?: string;
        demand_no?: string; problem_description?: string }> }>(endpoint + "?" + parameters);
      const records = result.items.map(row => ({
        id: row.id, label: row.name || row.problem_description || row.demand_no || row.id, reason: row.reason,
      }));
      return [task.key, { total: result.total, records }] as const;
    } catch (error) {
      queueErrors.value[task.key] = (error as Error).message;
      return [task.key, { total: 0, records: [] }] as const;
    }
  }));
  queueRows.value = Object.fromEntries(entries);
}
function openQueue(task: QueueTask) {
  void router.push({ path: task.path, query: { filters: taskFilters(task) } });
}
function openTask(task: QueueTask, row: QueueRow) {
  if (row.projectId) {
    const reviewing = task.action === "review";
    void router.push({ name: "projects", params: { projectId: row.projectId, work: reviewing ? "settlements" : "finance",
      recordId: reviewing ? row.id : "", recordAction: reviewing ? "review" : "" },
      query: { returnTo: "/dashboard", ...(reviewing ? {} : { focus: "settlement", record: row.id }) } });
  } else if (task.path === "/demands") {
    void router.push({ path: "/demands", query: { filters: taskFilters(task), demand: row.id } });
  } else {
    void router.push({ path: "/projects", query: { filters: taskFilters(task), project: row.id,
      tab: row.reason ? "scope" : task.key === "compile" ? "overview" : "approval" } });
  }
}
const router = useRouter();
function openMetric(key: string) {
  if (key === "pending_demands")
    void router.push({ path: "/demands", query: {
      filters: JSON.stringify({ display_status: "待确认" }) } });
  else if (key === "active_projects")
    void router.push({ path: "/projects", query: {
      filters: JSON.stringify({ status: "approved" }) } });
  else void router.push(key === "demands" ? "/demands" : "/projects");
}
function openProject(projectId: string) {
  void router.push({ path: "/projects", query: { project: projectId } });
}
async function refreshDashboard() {
  loading.value = true;
  try { dashboard.value = await api<Dashboard>("/dashboard"); await loadQueue(); }
  catch (error) { ElMessage.error((error as Error).message); }
  finally { loading.value = false; }
}
const portfolioColumns: TableColumn[] = [
  { key: "code", label: "项目编号", minWidth: 150 },
  { key: "name", label: "子项目", minWidth: 180 },
  { key: "display_status", label: "项目状态", minWidth: 110 },
  { key: "approved_budget_fen", label: "批准预算", minWidth: 135 },
  { key: "actual_cost_fen", label: "真实费用", minWidth: 135 },
  { key: "settlement_fen", label: "已批准结算", minWidth: 140 },
  { key: "settlement_progress_percent", label: "结算进度", minWidth: 155 },
  { key: "unreconciled_cost_fen", label: "待核对费用", minWidth: 140 },
];
const alertColumns: TableColumn[] = [
  { key: "project", label: "子项目", minWidth: 170 },
  { key: "kind", label: "需关注事项", minWidth: 210 },
  { key: "difference", label: "差异或日期", minWidth: 145 },
];
const frameworkColumns: TableColumn[] = [
  { key: "name", label: "框架", minWidth: 190 },
  { key: "limit_fen", label: "额度", minWidth: 155 },
  { key: "approved_budget_fen", label: "已批准预算", minWidth: 155 },
  { key: "actual_cost_fen", label: "实际费用", minWidth: 155 },
  { key: "settlement_progress_percent", label: "有基数项目结算进度", minWidth: 178 },
  { key: "projects_without_cost_basis", label: "待核定基数项目", minWidth: 145 },
];
const monthColumns: TableColumn[] = [
  { key: "month", label: "月份", minWidth: 160 },
  { key: "actual_cost_fen", label: "实际费用", minWidth: 170 },
];
const quarterColumns: TableColumn[] = [
  { key: "framework", label: "框架", minWidth: 170 },
  { key: "quarter", label: "季度" },
  { key: "target_percent", label: "年度目标" },
  { key: "cumulative_actual_fen", label: "累计实际费用", minWidth: 155 },
  { key: "annual_limit_fen", label: "年度额度", minWidth: 155 },
];
const alertRows = computed(() => dashboard.value.alerts.map((item, i) => ({
  ...item,
  id: "alert-" + i,
  difference: item.difference_fen == null ? item.planned_end_on : "¥" + money(item.difference_fen),
})));
function display(row: DashboardRow, col: TableColumn): string {
  const value: unknown = Object.entries(row).find(([name]) => name === col.key)?.[1];
  if (col.key === "settlement_progress_percent") return settlementProgressText(typeof value === "number" ? value : null);
  if (value === undefined || value === null || value === "") return "—";
  if (col.key.endsWith("_fen") && typeof value === "number") return "¥" + money(value);
  if (col.key === "target_percent" && typeof value === "number") return value + "%";
  return String(value);
}
onMounted(refreshDashboard);
</script>
<template>
  <div class="page-heading">
    <div>
      <h1>工作台</h1>
    </div>
    <div class="page-heading-actions">
      <ElButton data-guide-action="dashboard.filter" size="small" @click="refreshDashboard" :loading="loading">刷新工作台</ElButton>
    </div>
  </div>
  <section v-if="queue.length" class="panel task-queue">
    <h2>待办理</h2>
    <div v-for="task in queue" :key="task.key" class="queue-group">
      <div class="toolbar"><strong>{{ task.label }}</strong>
        <ElButton v-if="queueRows[task.key]?.total" link type="primary" @click="openQueue(task)">查看全部 {{ queueRows[task.key].total }} 项</ElButton>
      </div>
      <p v-if="queueErrors[task.key]" class="muted">读取失败 · {{ queueErrors[task.key] }}</p>
      <p v-else-if="!loading && !queueRows[task.key]?.total" class="muted">暂无记录</p>
      <div v-for="record in queueRows[task.key]?.records" :key="record.id" class="queue-record">
        <ElButton link type="primary" @click="openTask(task, record)">{{ record.label }}</ElButton>
        <span v-if="record.reason" class="muted">{{ record.reason }}</span>
      </div>
    </div>
  </section>
  <div class="metric-grid">
    <ElButton v-for="metric in [
      { label: '专业需求', key: 'demands' },
      { label: '待确认需求', key: 'pending_demands' },
      { label: '子项目', key: 'projects' },
      { label: '在办项目', key: 'active_projects' },
    ]" :key="metric.key" class="metric metric-action" text
      data-guide-action="dashboard.open" :aria-label="'查看' + metric.label" @click="openMetric(metric.key)">
      <span>{{ metric.label }}</span>
      <strong>{{ metricValue(metric.key) }}</strong>
    </ElButton>
  </div>
  <div class="panel">
    <h2>需要关注</h2>
    <template v-if="alertRows.length">
      <BusinessTable client-side table-key="dashboard:alerts" :loading="loading"
        :rows="alertRows" :columns="alertColumns">
        <template #cell="{ row, column }">{{ display(row, column) }}</template>
        <template #actions="{ row }">
          <ElButton data-guide-action="dashboard.alert" size="small" @click="openProject(row.project_id)">处理预警</ElButton>
        </template>
      </BusinessTable>
    </template>
    <ElEmpty v-else description="暂无需要关注的项目预警" :image-size="48" />
  </div>
  <div class="panel">
    <ElTabs>
      <ElTabPane label="项目费用与预算差异">
        <BusinessTable v-if="(dashboard.portfolio || []).length" client-side table-key="dashboard:portfolio" :loading="loading"
          :rows="dashboard.portfolio || []" :columns="portfolioColumns">
          <template #cell="{ row, column }">
            <ElTag v-if="column.key === 'display_status'" effect="plain">{{ display(row, column) }}</ElTag>
            <span v-else>{{ display(row, column) }}</span>
          </template>
          <template #actions="{ row }">
            <ElButton data-guide-action="dashboard.open" size="small" @click="openProject(row.id)">进入办理</ElButton>
          </template>
        </BusinessTable>
        <ElEmpty v-else description="暂无项目费用记录" :image-size="48" />
      </ElTabPane>
      <ElTabPane label="资金与进度分析">
        <ElTabs>
      <ElTabPane label="年度框架">
        <BusinessTable client-side table-key="dashboard:frameworks"
          :rows="dashboard.frameworks || []" :columns="frameworkColumns">
          <template #cell="{ row, column }">{{ display(row, column) }}</template>
        </BusinessTable>
      </ElTabPane>
      <ElTabPane label="月度实际费用">
        <BusinessTable client-side table-key="dashboard:months"
          :rows="dashboard.months || []" :columns="monthColumns">
          <template #cell="{ row, column }">{{ display(row, column) }}</template>
        </BusinessTable>
      </ElTabPane>
      <ElTabPane label="季度进度">
        <BusinessTable client-side table-key="dashboard:quarters"
          :rows="dashboard.quarters || []" :columns="quarterColumns">
          <template #cell="{ row, column }">{{ display(row, column) }}</template>
        </BusinessTable>
      </ElTabPane>
    </ElTabs>
      </ElTabPane>
    </ElTabs>
  </div>
</template>

<style scoped>
.queue-group + .queue-group { margin-top: 14px }
.queue-record { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 4px 0 }
.task-queue h2 { margin:0 0 5px }
.task-queue-row { display:flex; width:100%; height:auto; min-height:48px; text-align:left; border-radius:0; border-bottom:1px solid var(--edge); padding:8px 2px; margin:0 }
.task-queue-row:last-child { border-bottom:0 }
.task-queue-row :deep(>span) { display:flex; align-items:center; gap:16px; flex:1; min-width:0 }
.queue-task { display:flex; flex-wrap:wrap; gap:4px 14px; align-items:baseline; flex:1; font-weight:650 }
.queue-task small { font-size:12px; color:var(--muted); font-weight:400 }
.task-queue-row strong { font-variant-numeric:tabular-nums; color:var(--brand-primary) }
</style>
