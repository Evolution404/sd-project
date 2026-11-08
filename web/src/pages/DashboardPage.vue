<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api, type Row, money, statusText } from "../services/api";
const dashboard = ref<Row>({ portfolio: [] });
onMounted(async () => (dashboard.value = await api("/dashboard")));
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="section-caption">Operations overview</div>
      <h1>工作台</h1>
      <p>专业需求、项目批准与真实费用的当前情况。</p>
    </div>
    <ElTag type="success">Schema 113</ElTag>
  </div>
  <div class="metric-grid">
    <div
      v-for="metric in [
        { label: '专业需求', key: 'demands' },
        { label: '待确认需求', key: 'pending_demands' },
        { label: '子项目', key: 'projects' },
        { label: '在办项目', key: 'active_projects' },
      ]"
      :key="metric.key"
      class="metric"
    >
      <span>{{ metric.label }}</span
      ><strong>{{ dashboard[metric.key] || 0 }}</strong>
    </div>
  </div>
  <div class="panel">
    <h2>项目费用与预算差异</h2>
    <ElTable :data="dashboard.portfolio"
      ><ElTableColumn prop="code" label="编码" min-width="120" /><ElTableColumn
        prop="name"
        label="子项目"
        min-width="180"
      /><ElTableColumn label="阶段"
        ><template #default="{ row }"
          ><ElTag>{{ statusText[row.status] }}</ElTag></template
        ></ElTableColumn
      ><ElTableColumn label="批准预算"
        ><template #default="{ row }">{{
          money(row.approved_budget_fen)
        }}</template></ElTableColumn
      ><ElTableColumn label="真实费用"
        ><template #default="{ row }">{{
          money(row.actual_cost_fen)
        }}</template></ElTableColumn
      ><ElTableColumn label="已批准结算"
        ><template #default="{ row }">{{
          money(row.settlement_fen)
        }}</template></ElTableColumn
      ><ElTableColumn label="待核对费用"
        ><template #default="{ row }">{{
          money(row.unreconciled_cost_fen)
        }}</template></ElTableColumn
      ></ElTable
    >
  </div>
  <div class="panel">
    <h2>项目预警</h2>
    <ElTable :data="dashboard.alerts"
      ><ElTableColumn prop="project" label="子项目" /><ElTableColumn
        prop="kind"
        label="需关注事项"
      /><ElTableColumn label="差异 / 日期"
        ><template #default="{ row }">{{
          row.difference_fen == null
            ? row.planned_end_on
            : "¥" + money(row.difference_fen)
        }}</template></ElTableColumn
      ></ElTable
    >
  </div>
  <div class="panel">
    <ElTabs
      ><ElTabPane label="年度框架"
        ><ElTable :data="dashboard.frameworks"
          ><ElTableColumn prop="name" label="框架" /><ElTableColumn label="额度"
            ><template #default="{ row }">{{
              money(row.limit_fen)
            }}</template></ElTableColumn
          ><ElTableColumn label="已批准预算"
            ><template #default="{ row }">{{
              money(row.approved_budget_fen)
            }}</template></ElTableColumn
          ><ElTableColumn label="实际费用"
            ><template #default="{ row }">{{
              money(row.actual_cost_fen)
            }}</template></ElTableColumn
          ></ElTable
        ></ElTabPane
      ><ElTabPane label="月度实际费用"
        ><ElTable :data="dashboard.months"
          ><ElTableColumn prop="month" label="月份" /><ElTableColumn
            label="实际费用"
            ><template #default="{ row }"
              >¥{{ money(row.actual_cost_fen) }}</template
            ></ElTableColumn
          ></ElTable
        ></ElTabPane
      ><ElTabPane label="季度进度"
        ><ElTable :data="dashboard.quarters"
          ><ElTableColumn prop="framework" label="框架" /><ElTableColumn
            prop="quarter"
            label="季度"
          /><ElTableColumn label="年度目标"
            ><template #default="{ row }"
              >{{ row.target_percent }}%</template
            ></ElTableColumn
          ><ElTableColumn label="累计实际费用"
            ><template #default="{ row }">{{
              money(row.cumulative_actual_fen)
            }}</template></ElTableColumn
          ><ElTableColumn label="年度额度"
            ><template #default="{ row }">{{
              money(row.annual_limit_fen)
            }}</template></ElTableColumn
          ></ElTable
        ></ElTabPane
      ></ElTabs
    >
  </div>
</template>
