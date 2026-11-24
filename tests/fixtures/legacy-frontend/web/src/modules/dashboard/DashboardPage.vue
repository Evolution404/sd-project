<script setup lang="ts">
import { projectStatusTag } from "../../shared/utils/project-status";
import { settlementProgressText } from "../../shared/utils/settlement-progress";
import { computed, ref, onMounted } from "vue";
import { ArrowRight, Bell, CircleCheck, Document, FolderOpened, Refresh, Tickets } from "@element-plus/icons-vue";
import { useRoute, useRouter } from "vue-router";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import { useAccess } from "../../shared/composables/use-access";
import { useWorkRoute } from "../../shared/navigation/use-work-route";
import { api, money } from "../../shared/api/client";
import type { Dashboard } from "../../../../server/shared/types/reporting";
type DashboardRow = Dashboard["portfolio"][number] | Dashboard["alerts"][number] |
  Dashboard["frameworks"][number] | Dashboard["months"][number] | Dashboard["quarters"][number];

const dashboard = ref<Dashboard>({
  demands: 0, pending_demands: 0, projects: 0, active_projects: 0,
  as_of: "", portfolio: [], alerts: [], frameworks: [], months: [], quarters: [],
});
const metrics = [
  { label: "专业需求", key: "demands", icon: Document },
  { label: "待确认需求", key: "pending_demands", icon: Tickets },
  { label: "子项目", key: "projects", icon: FolderOpened },
  { label: "在办项目", key: "active_projects", icon: CircleCheck },
] as const;
const loadError = ref("");
const analysisTab = ref("portfolio");
const analysisPanel = ref<HTMLElement>();
function showAllAlerts() {
  analysisTab.value = "alerts";
  analysisPanel.value?.scrollIntoView({ block: "start" });
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
const visibleTasks = computed(() => queue.value.filter(task => queueErrors.value[task.key] || queueRows.value[task.key]?.total));
const taskCount = computed(() => Object.values(queueRows.value).reduce((sum, group) => sum + group.total, 0));
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
  const returnTo = route.fullPath;
  if (row.projectId) {
    const reviewing = task.action === "review";
    void workRoute.enter({ name: "projects", params: { projectId: row.projectId, work: reviewing ? "settlements" : "finance",
      recordId: reviewing ? row.id : "", recordAction: reviewing ? "review" : "" },
      query: { returnTo, ...(reviewing ? { source: "task" } : { focus: "settlement", record: row.id }) } });
  } else if (task.path === "/demands") {
    void workRoute.enter({ path: "/demands", query: { filters: taskFilters(task), demand: row.id, returnTo } });
  } else if (row.reason) {
    void workRoute.enter({ path: "/projects",
      query: { filters: taskFilters(task), project: row.id, tab: "scope", returnTo } });
  } else {
    void workRoute.enter({ name: "projects", params: {
      projectId: row.id, work: task.key === "compile" ? "compile" : "review", recordId: "", recordAction: "",
    }, query: { returnTo } });
  }
}
const router = useRouter();
const route = useRoute();
const workRoute = useWorkRoute();
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
  loadError.value = "";
  const [report] = await Promise.allSettled([api<Dashboard>("/dashboard"), loadQueue()]);
  if (report.status === "fulfilled") dashboard.value = report.value;
  else loadError.value = (report.reason as Error).message;
  loading.value = false;
  void workRoute.restoreScroll();
}
const portfolioColumns: TableColumn[] = [
  { key: "name", label: "子项目", minWidth: 250 },
  { key: "display_status", label: "项目状态", minWidth: 110 },
  { key: "approved_budget_fen", label: "批准预算", minWidth: 135 },
  { key: "actual_cost_fen", label: "真实费用", minWidth: 135 },
  { key: "settlement_fen", label: "已批准结算", minWidth: 140 },
  { key: "settlement_progress_percent", label: "结算进度", minWidth: 155 },
  { key: "unreconciled_cost_fen", label: "待核对费用", minWidth: 140 },
  { key: "code", label: "项目编号", minWidth: 150 },
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
  { key: "settlement_progress_percent", label: "有预算项目结算进度", minWidth: 178 },
  { key: "projects_without_budget_basis", label: "无可用批准预算的项目", minWidth: 145 },
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
  <div class="page-heading dashboard-heading">
    <div>
      <h1>工作台</h1>
      <p v-if="dashboard.as_of">业务日期 {{ dashboard.as_of }}</p>
    </div>
    <div class="page-heading-actions">
      <ElButton data-guide-action="dashboard.filter" :icon="Refresh" @click="refreshDashboard" :loading="loading">刷新工作台</ElButton>
    </div>
  </div>
  <ElAlert v-if="loadError" class="error-banner" type="error" show-icon :closable="false"
    title="业务概览读取失败" :description="(dashboard.as_of ? '当前保留上次结果。' : '') + loadError" />
  <div class="dashboard-flow" :class="{ 'without-queue': !queue.length }">
    <section v-if="queue.length" class="panel dashboard-panel task-queue" data-guide-action="dashboard.open" v-loading="loading">
      <div class="dashboard-section-heading">
        <h2>待办理</h2>
        <span v-if="!loading && !Object.keys(queueErrors).length" class="dashboard-count">{{ taskCount }} 项</span>
      </div>
      <div v-if="visibleTasks.length" class="queue-grid" :class="{ 'single-task': visibleTasks.length === 1 }">
        <article v-for="task in visibleTasks" :key="task.key" class="queue-card">
          <div class="queue-card-heading">
            <h3>{{ task.label }}</h3>
            <ElButton v-if="queueRows[task.key]?.total" text class="queue-all" :aria-label="'查看全部' + task.label"
              @click="openQueue(task)">查看全部 {{ queueRows[task.key]?.total }} 项<ElIcon><ArrowRight /></ElIcon></ElButton>
          </div>
          <p v-if="queueErrors[task.key]" class="queue-error">读取失败 · {{ queueErrors[task.key] }}</p>
          <ul v-else class="dashboard-records">
            <li v-for="record in queueRows[task.key]?.records" :key="record.id">
              <ElButton link class="dashboard-record" :title="record.label"
                @click="openTask(task, record)">{{ record.label }}</ElButton>
              <small v-if="record.reason" class="queue-reason">{{ record.reason }}</small>
            </li>
          </ul>
        </article>
      </div>
      <div v-else-if="!loading" class="dashboard-empty">
        <ElIcon><CircleCheck /></ElIcon><span>当前没有待办事项</span>
      </div>
    </section>
    <section class="panel dashboard-panel" data-guide-action="dashboard.alert" v-loading="loading">
      <div class="dashboard-section-heading">
        <h2>需要关注</h2>
        <span v-if="dashboard.as_of" class="dashboard-count">{{ alertRows.length }} 项</span>
      </div>
      <ul v-if="alertRows.length" class="dashboard-records alert-list">
        <li v-for="alert in alertRows.slice(0, 3)" :key="alert.id">
          <span class="dashboard-alert-kind">{{ alert.kind }}</span>
          <ElButton link class="dashboard-record" :title="alert.project"
            @click="openProject(alert.project_id)">{{ alert.project }}</ElButton>
          <small v-if="alert.difference" class="muted">{{ alert.difference }}</small>
        </li>
      </ul>
      <ElButton v-if="alertRows.length > 3" text type="primary" class="alert-all" @click="showAllAlerts">查看全部 {{ alertRows.length }} 项</ElButton>
      <div v-else-if="!alertRows.length && !loading" class="dashboard-empty">
        <ElIcon><Bell /></ElIcon><span>{{ loadError ? '项目预警读取失败' : '暂无项目预警' }}</span>
      </div>
    </section>
  </div>
  <div class="metric-grid dashboard-metrics" v-loading="loading">
    <ElButton v-for="metric in metrics" :key="metric.key" class="metric metric-action"
      :style="{backgroundColor:'var(--surface)',color:'var(--ink)',borderColor:'var(--edge)'}"
      :data-metric="metric.key" :aria-label="'查看' + metric.label" :disabled="loading" @click="openMetric(metric.key)">
      <span class="metric-icon"><ElIcon><component :is="metric.icon" /></ElIcon></span>
      <span class="metric-text">
        <span>{{ metric.label }}</span>
        <strong>{{ dashboard.as_of ? dashboard[metric.key] : '—' }}</strong>
      </span>
      <ElIcon class="metric-arrow"><ArrowRight /></ElIcon>
    </ElButton>
  </div>
  <div ref="analysisPanel" class="panel dashboard-analysis" v-loading="loading">
    <ElTabs v-model="analysisTab">
      <ElTabPane label="项目费用与预算差异" name="portfolio">
        <BusinessTable v-if="dashboard.portfolio.length" client-side table-key="dashboard:portfolio" :loading="loading"
          :rows="dashboard.portfolio" :columns="portfolioColumns" detail-column="name"
          @open-detail="openProject($event.id)">
          <template #cell="{ row, column }">
            <ElTag v-if="column.key === 'display_status'" :type="projectStatusTag(row.display_status)" effect="plain">{{ display(row, column) }}</ElTag>
            <span v-else>{{ display(row, column) }}</span>
          </template>
        </BusinessTable>
        <ElEmpty v-else-if="!loading && !loadError" description="暂无项目费用记录" :image-size="48" />
      </ElTabPane>
      <ElTabPane label="资金与进度分析" name="funding">
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
      <ElTabPane v-if="alertRows.length" label="项目预警" name="alerts">
        <BusinessTable client-side table-key="dashboard:alerts" :loading="loading"
          :rows="alertRows" :columns="alertColumns" detail-column="project"
          @open-detail="openProject($event.project_id)">
          <template #cell="{ row, column }">{{ display(row, column) }}</template>
        </BusinessTable>
      </ElTabPane>
    </ElTabs>
  </div>
</template>

<style scoped>
.dashboard-heading h1 { margin-bottom: 4px }
.dashboard-metrics { gap: 12px }
.dashboard-metrics .metric-action {
  border-radius: 10px;
  padding: 14px;
  transition: background-color .16s ease, border-color .16s ease;
}
.dashboard-metrics .metric-action:hover { transform: none; background: var(--surface-subtle) }
.dashboard-metrics .metric-action > :deep(span) {
  display: flex;
  align-items: center;
  gap: 12px;
}
.metric-icon {
  display: grid;
  place-items: center;
  flex: 0 0 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--brand-soft);
  color: var(--brand-primary);
}
.metric-icon .el-icon { font-size: 18px }
[data-metric="pending_demands"] .metric-icon {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
[data-metric="active_projects"] .metric-icon {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.metric-text { flex: 1; min-width: 0; line-height: 1.35 }
.metric-text strong { margin-top: 3px; color: var(--ink); line-height: 1.1 }
.metric-arrow { color: var(--muted); flex-shrink: 0 }
.dashboard-flow {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(230px, 1fr);
  align-items: stretch;
  gap: 14px;
  margin-top: 14px;
}
.dashboard-flow.without-queue { grid-template-columns: minmax(0, 1fr) }
.dashboard-panel { min-width: 0; margin: 0 }
.dashboard-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.dashboard-section-heading h2 { margin: 0 }
.dashboard-count { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums }
.queue-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 215px), 1fr));
  gap: 10px;
}
.queue-card {
  min-width: 0;
  padding: 10px 12px;
  background: var(--surface-subtle);
  border: 1px solid var(--edge);
  border-radius: 8px;
}
.queue-card-heading { display: flex; align-items: center; gap: 7px; min-height: 26px }
.queue-card h3 { font-size: 13px; margin: 0; line-height: 1.4 }
.queue-all.el-button { color: var(--muted); min-width: 0; height: 24px; margin-left: auto; padding: 0 3px }
.queue-all .el-icon { margin-left: 2px }
.dashboard-records { list-style: none; margin: 5px 0 0; padding: 0; display: grid; gap: 3px }
.single-task .dashboard-records { grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)) }
.dashboard-records li { min-width: 0; display: grid; justify-items: start }
.dashboard-record.el-button {
  justify-content: flex-start;
  min-width: 0;
  max-width: 100%;
  min-height: 27px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 500;
}
.dashboard-record :deep(> span) { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.dashboard-record:hover, .queue-all:hover { color: var(--brand-primary) }
.queue-reason, .queue-error { color: var(--el-color-warning); font-size: 12px; line-height: 1.45 }
.queue-reason { padding-bottom: 4px; overflow-wrap: anywhere }
.dashboard-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  background: var(--surface-subtle);
  font-size: 13px;
  color: var(--muted);
}
.alert-list li { padding: 7px 0 }
.alert-list li + li { border-top: 1px solid var(--edge) }
.dashboard-alert-kind { font-size: 12px; color: var(--el-color-warning) }
.alert-all.el-button { padding-left: 0; padding-right: 0 }
.dashboard-analysis { scroll-margin-top: 72px }
@media (max-width: 1100px) {
  .dashboard-flow { grid-template-columns: minmax(0, 2fr) minmax(210px, 1fr) }
}
@media (max-width: 850px) {
  .dashboard-flow { grid-template-columns: minmax(0, 1fr) }
}
@media (max-width: 400px) {
  .dashboard-metrics .metric-action { padding: 10px }
  .dashboard-metrics .metric-action > :deep(span) { gap: 8px }
  .metric-icon { flex-basis: 30px; height: 30px }
}
</style>
