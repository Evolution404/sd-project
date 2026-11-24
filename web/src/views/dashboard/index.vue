<template>
  <div class="dash">
    <section class="dash-header">
      <div class="card dash-header__card">
        <div class="dash-header__start">
          <div class="dash-avatar">
            <img v-if="userStore.userInfo.avatar" :src="userStore.userInfo.avatar" alt="" />
            <el-icon v-else :size="22"><User /></el-icon>
          </div>
          <div class="dash-header__text">
            <h1 class="dash-header__greeting">{{ greetings }}</h1>
            <p class="dash-header__date">{{ currentDateStr }}</p>
          </div>
        </div>
        <div class="dash-header__end" data-guide-action="dashboard.open">
          <RouterLink class="quick-link" to="/business/demands">
            <el-icon><Document /></el-icon><span>专业需求</span>
          </RouterLink>
          <RouterLink class="quick-link" to="/business/projects">
            <el-icon><Folder /></el-icon><span>子项目</span>
          </RouterLink>
          <RouterLink class="quick-link" to="/funding/finance">
            <el-icon><CircleCheck /></el-icon><span>费用与结算</span>
          </RouterLink>
        </div>
      </div>
    </section>
    <el-alert v-if="error" type="warning" :title="error" :closable="false" />
    <section class="dash-stats">
      <div class="stat-grid">
        <div v-for="metric in metrics" :key="metric.key" class="stat-card">
          <div class="stat-card__icon"><el-icon :size="18"><component :is="metric.icon" /></el-icon></div>
          <div class="stat-card__body">
            <span class="stat-card__label">{{ metric.label }}</span>
            <span class="stat-card__num">{{ metric.value }}</span>
          </div>
        </div>
      </div>
    </section>
    <section class="dash-chart">
      <div class="card dash-chart__trend">
        <div class="card__head">
          <h3 class="card__title">实际费用趋势</h3>
          <el-segmented data-guide-action="dashboard.filter" v-model="monthsRange" :options="monthRangeOptions" />
        </div>
        <div class="card__body card__body--chart">
          <el-skeleton v-if="loading" :rows="5" animated />
          <ECharts v-else :options="expenseChartOptions" height="240px" />
        </div>
      </div>
      <div class="card dash-chart__overview">
        <div class="card__head">
          <h3 class="card__title">业务概览</h3>
          <el-tag type="primary" size="small" effect="plain">
            {{ summary ? summary.pending_demands + summary.alerts.length : 0 }} 项需关注
          </el-tag>
        </div>
        <div class="card__body overview-card">
          <div class="overview-summary">
            <div v-for="item in overviewSummary" :key="item.label" class="overview-summary__item">
              <span class="overview-summary__label">{{ item.label }}</span>
              <strong class="overview-summary__value">{{ item.value }}</strong>
            </div>
          </div>
          <div class="overview-bars">
            <div
              v-for="item in overviewBars"
              :key="item.label"
              class="overview-bars__item"
              :style="{ '--overview-percent': item.percent + '%' }"
            >
              <div class="overview-bars__meta">
                <span class="overview-bars__label">{{ item.label }}</span>
                <span class="overview-bars__value">{{ item.value }} 项</span>
              </div>
              <span class="overview-bars__track"><span class="overview-bars__bar" /></span>
            </div>
          </div>
        </div>
      </div>
    </section>
    <SettlementTasks />
    <section class="dash-bottom">
      <div class="card">
        <div class="card__head">
          <h3 class="card__title" data-guide-action="dashboard.alert">需要关注</h3>
          <span class="card__count">{{ summary?.alerts.length ?? 0 }} 项</span>
        </div>
        <div class="card__body">
          <el-empty v-if="!loading && !alerts.length" description="暂无项目风险预警" :image-size="48" />
          <div v-for="alert in alerts" :key="alert.id" class="todo-row">
            <el-icon class="todo-row__icon--pending" :size="16"><Warning /></el-icon>
            <span class="todo-row__title">{{ alert.title }}</span>
            <span class="todo-row__tag">{{ alert.kind }}</span>
            <span class="todo-row__time">{{ alert.date }}</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card__head">
          <h3 class="card__title">项目动态</h3>
          <span class="card__count">{{ summary?.projects ?? 0 }} 个项目</span>
        </div>
        <div class="card__body card__body--scroll">
          <el-empty v-if="!loading && !recentProjects.length" description="暂无项目数据" :image-size="48" />
          <div class="feed">
            <div v-for="project in recentProjects" :key="project.id" class="feed__item">
              <span class="feed__dot" />
              <span class="feed__text">{{ project.name }}</span>
              <span class="feed__time">{{ project.display_status }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: "Dashboard", inheritAttrs: false });

import { computed, onMounted, ref } from "vue";
import { User, Document, Folder, CircleCheck, Warning, Monitor } from "@element-plus/icons-vue";
import { useUserStore } from "@/stores/user";
import { useSettingsStore } from "@/stores/settings";
import SettlementTasks from "./SettlementTasks.vue";

interface DashboardProject {
  id: string;
  name: string;
  display_status: string;
  actual_cost_fen: number;
  settlement_fen: number;
}
interface DashboardAlert {
  project_id: string;
  project: string;
  kind: string;
  planned_end_on?: string;
}
interface DashboardSummary {
  demands: number;
  pending_demands: number;
  projects: number;
  active_projects: number;
  portfolio: DashboardProject[];
  months: Array<{ month: string; actual_cost_fen: number }>;
  alerts: DashboardAlert[];
  as_of: string;
}

const userStore = useUserStore();
const settingsStore = useSettingsStore();
const summary = ref<DashboardSummary | null>(null);
const loading = ref(true);
const error = ref("");
const monthsRange = ref(6);
const monthRangeOptions = [
  { label: "近6个月", value: 6 },
  { label: "近12个月", value: 12 },
];

const greetings = computed(() => {
  const hour = new Date().getHours();
  const name = userStore.userInfo.nickname || userStore.userInfo.username || "用户";
  if (hour >= 6 && hour < 12) return `上午好，${name}`;
  if (hour >= 12 && hour < 18) return `下午好，${name}`;
  if (hour >= 18) return `晚上好，${name}`;
  return `早安，${name}`;
});
const currentDateStr = computed(() => {
  const d = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week[d.getDay()]}`;
});
const metrics = computed(() => [
  { key: "demands", label: "专业需求", icon: Document, value: summary.value?.demands ?? "—" },
  { key: "pending", label: "待确认需求", icon: Warning, value: summary.value?.pending_demands ?? "—" },
  { key: "projects", label: "子项目", icon: Folder, value: summary.value?.projects ?? "—" },
  { key: "active", label: "在办项目", icon: Monitor, value: summary.value?.active_projects ?? "—" },
]);
const overviewSummary = computed(() => [
  { label: "专业需求", value: summary.value?.demands ?? "—" },
  { label: "子项目", value: summary.value?.projects ?? "—" },
  { label: "风险预警", value: summary.value?.alerts.length ?? "—" },
]);
const overviewBars = computed(() => {
  const data = summary.value;
  const items = [
    { label: "待确认需求", value: data?.pending_demands ?? 0 },
    { label: "在办项目", value: data?.active_projects ?? 0 },
    { label: "风险预警", value: data?.alerts.length ?? 0 },
  ];
  const max = Math.max(1, ...items.map(item => item.value));
  return items.map(item => ({ ...item, percent: Math.round(item.value * 100 / max) }));
});
const alerts = computed(() => (summary.value?.alerts ?? []).slice(0, 6).map((item, index) => ({
  id: `${item.project_id}/${item.kind}/${index}`,
  title: item.project,
  kind: item.kind,
  date: item.planned_end_on || "",
})));
const recentProjects = computed(() => (summary.value?.portfolio ?? []).slice(0, 6));
const expenseChartOptions = computed(() => {
  // The original upstream ECharts component and dashboard layout remain intact.
  // All series are derived exclusively from the /api/dashboard portfolio cost ledger.
  void settingsStore.resolvedTheme;
  const actual = summary.value?.months ?? [];
  const months = new Map(actual.map(item => [item.month, item.actual_cost_fen]));
  const anchor = summary.value?.as_of?.slice(0, 7) || new Date().toISOString().slice(0, 7);
  const [year, month] = anchor.split("-").map(Number);
  const labels: string[] = [];
  const values: number[] = [];
  for (let offset = monthsRange.value - 1; offset >= 0; offset--) {
    const d = new Date(Date.UTC(year, month - 1 - offset, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    labels.push(key);
    values.push((months.get(key) || 0) / 100);
  }
  const css = (name: string, fallback: string) =>
    typeof document !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
      : fallback;
  const primary = css("--chart-1", "#165dff");
  const muted = css("--el-text-color-secondary", "#909399");
  return {
    tooltip: { trigger: "axis", valueFormatter: (v: unknown) =>
      `¥${Number(v ?? 0).toFixed(2)}` },
    legend: { data: ["实际费用（元）"], bottom: 0 },
    grid: { left: "1%", right: "4%", top: "5%", bottom: "16%", containLabel: true },
    xAxis: { type: "category", data: labels, axisLabel: { color: muted } },
    yAxis: { type: "value", axisLabel: { color: muted } },
    series: [{
      name: "实际费用（元）", type: "line", smooth: true, showSymbol: true,
      data: values, lineStyle: { color: primary, width: 2.2 },
      itemStyle: { color: primary },
      areaStyle: { opacity: 0.08, color: primary },
    }],
  };
});
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/dashboard", { credentials: "same-origin" });
    if (!response.ok) throw Error(`读取业务工作台失败（HTTP ${response.status}）`);
    summary.value = await response.json() as DashboardSummary;
  } catch (cause) {
    summary.value = null;
    error.value = (cause as Error).message;
  } finally { loading.value = false; }
}
onMounted(() => void load());
</script>

<style lang="scss" scoped>
// Tokens
$gap: 16px;
$pad: var(--page-padding);
%card {
  overflow: hidden;
  background: var(--content-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

// Page
.dash {
  display: flex;
  flex-direction: column;
  gap: $gap;
  padding: $pad;
  background: var(--page-bg);

  // 入场节奏：区块与统计卡依次浮现
  > section {
    animation: dash-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards;

    &:nth-child(2) {
      animation-delay: 0.06s;
    }

    &:nth-child(3) {
      animation-delay: 0.12s;
    }

    &:nth-child(4) {
      animation-delay: 0.18s;
    }
  }
}

@keyframes dash-rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dash > section {
    animation: none;
  }
}

// Header
.dash-header {
  &__card {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    align-items: center;
    justify-content: space-between;
    min-height: 96px;
    padding: 24px 28px;
    background:
      radial-gradient(
        560px 220px at 88% -60%,
        color-mix(in srgb, var(--el-color-primary) 12%, transparent),
        transparent 70%
      ),
      radial-gradient(
        420px 180px at 4% 140%,
        color-mix(in srgb, var(--chart-2) 10%, transparent),
        transparent 72%
      ),
      var(--content-bg);

    // 细网格纹理：向右上晕染处淡出
    &::before {
      position: absolute;
      inset: 0;
      pointer-events: none;
      content: "";
      background-image:
        linear-gradient(
          to right,
          color-mix(in srgb, var(--el-color-primary) 7%, transparent) 1px,
          transparent 1px
        ),
        linear-gradient(
          to bottom,
          color-mix(in srgb, var(--el-color-primary) 7%, transparent) 1px,
          transparent 1px
        );
      background-size: 28px 28px;
      mask-image: radial-gradient(420px 160px at 85% 0%, #000 0%, transparent 75%);
    }
  }

  &__start {
    position: relative;
    display: flex;
    flex: 1;
    gap: 12px;
    align-items: center;
    min-width: 260px;
  }

  &__text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__greeting {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--el-text-color-primary);
    letter-spacing: -0.015em;
  }

  &__date {
    margin: 0;
    font-size: var(--font-size-secondary);
    color: var(--el-text-color-secondary);
  }

  &__end {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }
}

.dash-avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  overflow: hidden;
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 14%, var(--content-bg));
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 18%, transparent);
  border-radius: 50%;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

// Quick links
.quick-link {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 14px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-decoration: none;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  transition:
    color 0.15s,
    background-color 0.15s,
    border-color 0.15s,
    transform 0.15s;

  .el-icon,
  [class^="i-svg:"] {
    width: 15px;
    height: 15px;
    font-size: 15px;
    color: currentcolor;
  }

  &:hover {
    color: var(--el-color-primary);
    background: color-mix(in srgb, var(--el-color-primary) 6%, transparent);
    border-color: color-mix(in srgb, var(--el-color-primary) 35%, transparent);
    transform: translateY(-1px);
  }
}

// Stat cards：图标 + 指标 + 状态，单行结构
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: $gap;
}

.stat-card {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 76px;
  padding: 16px 18px;
  @extend %card;

  &__icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    color: var(--el-color-primary);
    background: color-mix(in srgb, var(--el-color-primary) 9%, var(--content-bg));
    border-radius: 8px;
  }

  &__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  &__label {
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
  }

  &__num {
    font-size: 24px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
    color: var(--el-text-color-regular);
  }

  &__badge {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--el-text-color-secondary);

    &--on {
      color: var(--el-color-success);
    }

    &--off {
      color: var(--el-text-color-secondary);
    }
  }

  &__trend {
    display: inline-flex;
    flex-shrink: 0;
    gap: 3px;
    align-items: center;
    font-size: 12px;
    font-weight: 600;
    color: var(--el-text-color-secondary);

    &--success {
      color: var(--el-color-success);
    }

    &--danger {
      color: var(--el-color-danger);
    }
  }
}

// Generic card
.card {
  display: flex;
  flex-direction: column;
  @extend %card;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--card-border);
  }

  &__title {
    margin: 0;
    font-size: var(--font-size-card-title);
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__count {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__body {
    padding: 18px 20px 20px;

    &--chart {
      padding: 14px 20px 16px;
    }

    &--scroll {
      flex: 1;
      padding: 0;
      overflow-y: auto;
    }
  }
}

.dash-header__card {
  flex-direction: row;
}

// Chart & bottom grids
.dash-chart {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(280px, 1fr);
  gap: $gap;
}

.dash-chart__trend,
.dash-chart__overview {
  min-width: 0;
}

.overview-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
}

.overview-bars {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
  min-height: 142px;
  padding: 0;

  &__item {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  &__meta {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
  }

  &__label,
  &__value {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__value {
    flex-shrink: 0;
    text-align: right;
  }

  &__label {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }

  &__track {
    height: 5px;
    overflow: hidden;
    background: color-mix(in srgb, var(--el-color-primary) 10%, var(--el-fill-color-light));
    border-radius: 999px;
  }

  &__bar {
    display: block;
    width: var(--overview-percent);
    height: 100%;
    background: linear-gradient(90deg, var(--el-color-primary), var(--el-color-primary-light-3));
    border-radius: inherit;
  }
}

.overview-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);

  &__item {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    min-height: 56px;
    padding: 8px 12px;

    &:first-child {
      padding-left: 0;
    }

    &:last-child {
      padding-right: 0;
    }

    & + & {
      border-left: 1px solid var(--border-color);
    }

    &:nth-child(2) .overview-summary__value {
      color: var(--el-color-warning);
    }

    &:nth-child(3) .overview-summary__value {
      color: var(--el-color-success);
    }
  }

  &__label {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
  }

  &__value {
    flex-shrink: 0;
    margin-top: 4px;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.1;
    color: var(--el-color-primary);
  }
}

.dash-bottom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: $gap;
}

// Todo rows
.todo-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 11px 0;

  & + & {
    border-top: 1px solid var(--el-border-color-lighter);
  }

  &--done {
    .todo-row__title {
      color: var(--el-text-color-placeholder);
      text-decoration: line-through;
    }
  }

  &__icon--pending {
    flex-shrink: 0;
    color: var(--el-color-primary);
  }
  &__icon--done {
    flex-shrink: 0;
    color: var(--el-color-success);
  }

  &__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
    color: var(--el-text-color-regular);
    white-space: nowrap;
  }

  &__tag {
    flex-shrink: 0;
    padding: 1px 8px;
    font-size: 11px;
    line-height: 18px;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-light);
    border-radius: var(--radius-pill);
  }

  &__time {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

// Activity feed
.feed {
  display: flex;
  flex-direction: column;
  padding: 10px 20px 16px;

  &__item {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
    padding: 10px 0 10px 16px;

    &::before {
      position: absolute;
      top: 22px;
      bottom: -4px;
      left: 3px;
      width: 1px;
      content: "";
      background: var(--el-border-color-lighter);
    }

    &:last-child::before {
      display: none;
    }
  }

  &__dot {
    position: absolute;
    top: 12px;
    left: 0;
    width: 7px;
    height: 7px;
    background: var(--el-color-primary);
    border: 2px solid var(--el-color-primary-light-8);
    border-radius: 50%;
  }

  &__text {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--el-text-color-regular);
  }

  &__time {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

// Responsive
@media (max-width: 1200px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .dash-header__card {
    flex-direction: column;
    align-items: flex-start;
  }

  .dash-header__end {
    justify-content: flex-start;
  }
}

@media (max-width: 992px) {
  .dash-chart {
    grid-template-columns: 1fr;
  }

  .dash-bottom {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .dash {
    gap: 12px;
    padding: 12px;
  }

  .stat-grid {
    grid-template-columns: 1fr;
  }
}
</style>
