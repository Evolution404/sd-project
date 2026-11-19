<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { useRouter } from "vue-router";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import { useAccess } from "../../shared/composables/use-access";
import { api, money, statusText } from "../../shared/api/client";
import type { ReportingService } from "../../../../server/modules/reporting/service";
type Dashboard = ReturnType<ReportingService["dashboard"]>;
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
const queueCounts = ref<Record<string, number | undefined>>({});
const queue = computed(() => [
  ...(can("demand.activate") ? [{ key: "pending_demands", label: "确认专业需求", hint: "核对现场事实与作业位置", path: "/demands", state: "待确认" }] : []),
  ...(can("write") ? [{ key: "stocked_projects", label: "编制项目立项", hint: "核对承接范围与预算", path: "/projects", state: "已入库" }] : []),
  ...(can("project.approve") ? [{ key: "initial_review", label: "审核项目立项", hint: "复核首版范围与预算", path: "/projects", state: "立项中" }] : []),
  ...(can("change.approve") ? [{ key: "change_review", label: "审核项目变更", hint: "复核与当前批准的差异", path: "/projects", state: "变更中" }] : []),
]);
async function loadQueue() {
  queueCounts.value = Object.fromEntries(await Promise.all(queue.value.map(async task => {
    if (task.key === "pending_demands") return [task.key, dashboard.value.pending_demands];
    try {
      const query = new URLSearchParams({ page_size: "1", filters: JSON.stringify({ display_status: task.state }) });
      const result = await api<{total: number}>(task.path + "?" + query);
      return [task.key, result.total];
    } catch {
      return [task.key, undefined];
    }
  })));
}
function openQueue(task: {path: string; state: string}) {
  void router.push({ path: task.path, query: { filters: JSON.stringify({ display_status: task.state }) } });
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
  { key: "status", label: "阶段", minWidth: 110 },
  { key: "approved_budget_fen", label: "批准预算", minWidth: 135 },
  { key: "actual_cost_fen", label: "真实费用", minWidth: 135 },
  { key: "settlement_fen", label: "已批准结算", minWidth: 140 },
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
  if (value === undefined || value === null || value === "") return "—";
  if (col.key === "status") return statusText[String(value)] || String(value);
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
    <ElButton v-for="task in queue" :key="task.key" class="task-queue-row" text @click="openQueue(task)">
      <span class="queue-task">{{ task.label }}<small>{{ task.hint }}</small></span>
      <strong v-if="queueCounts[task.key] !== undefined">{{ queueCounts[task.key] }}</strong>
      <span aria-hidden="true">→</span>
    </ElButton>
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
            <ElTag v-if="column.key === 'status'" effect="plain">{{ display(row, column) }}</ElTag>
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
.task-queue h2 { margin:0 0 5px }
.task-queue-row { display:flex; width:100%; height:auto; min-height:48px; text-align:left; border-radius:0; border-bottom:1px solid var(--edge); padding:8px 2px; margin:0 }
.task-queue-row:last-child { border-bottom:0 }
.task-queue-row :deep(>span) { display:flex; align-items:center; gap:16px; flex:1; min-width:0 }
.queue-task { display:flex; flex-wrap:wrap; gap:4px 14px; align-items:baseline; flex:1; font-weight:650 }
.queue-task small { font-size:12px; color:var(--muted); font-weight:400 }
.task-queue-row strong { font-variant-numeric:tabular-nums; color:var(--brand-primary) }
</style>
