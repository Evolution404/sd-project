<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { ElMessage } from "element-plus";
import BusinessTable, { type TableColumn } from "../components/BusinessTable.vue";
import { api, type Row, money, statusText } from "../services/api";

const dashboard = ref<Row>({
  portfolio: [], alerts: [], frameworks: [], months: [], quarters: [],
});
const loading = ref(true);
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
const alertRows = computed<Row[]>(() => (dashboard.value.alerts || []).map((item: Row, i: number) => ({
  ...item,
  id: item.id || "alert-" + i,
  difference: item.difference_fen == null ? item.planned_end_on : "¥" + money(item.difference_fen),
})));
function display(row: Row, col: TableColumn) {
  const value = row[col.key];
  if (value === undefined || value === null || value === "") return "—";
  if (col.key === "status") return statusText[value] || value;
  if (col.key.endsWith("_fen")) return "¥" + money(value);
  if (col.key === "target_percent") return value + "%";
  return value;
}
onMounted(async () => {
  try { dashboard.value = await api("/dashboard"); }
  catch (error) { ElMessage.error((error as Error).message); }
  finally { loading.value = false; }
});
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="section-caption">业务运行概览</div>
      <h1>工作台</h1>
      <p>专业需求、项目批准、实际费用与结算的当前情况。</p>
    </div>
  </div>
  <div class="metric-grid">
    <div v-for="metric in [
      { label: '专业需求', key: 'demands' },
      { label: '待确认需求', key: 'pending_demands' },
      { label: '子项目', key: 'projects' },
      { label: '在办项目', key: 'active_projects' },
    ]" :key="metric.key" class="metric">
      <span>{{ metric.label }}</span>
      <strong>{{ dashboard[metric.key] || 0 }}</strong>
    </div>
  </div>
  <div class="panel">
    <h2>项目费用与预算差异</h2>
    <BusinessTable client-side table-key="dashboard:portfolio" :loading="loading"
      :rows="dashboard.portfolio || []" :columns="portfolioColumns">
      <template #cell="{ row, column }">
        <ElTag v-if="column.key === 'status'" effect="plain">{{ display(row, column) }}</ElTag>
        <span v-else>{{ display(row, column) }}</span>
      </template>
    </BusinessTable>
  </div>
  <div class="panel">
    <h2>项目预警</h2>
    <BusinessTable client-side table-key="dashboard:alerts" :loading="loading"
      :rows="alertRows" :columns="alertColumns">
      <template #cell="{ row, column }">{{ display(row, column) }}</template>
    </BusinessTable>
  </div>
  <div class="panel">
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
  </div>
</template>
