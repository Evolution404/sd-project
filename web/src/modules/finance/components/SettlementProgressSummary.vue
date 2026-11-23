<script setup lang="ts">
import { computed } from "vue";
import { money } from "../../../shared/api/client";
import { settlementProgressText } from "../../../shared/utils/settlement-progress";
import type { FinanceSummary } from "../../../../../server/shared/types/finance-api";

const props = defineProps<{
  summary: Pick<FinanceSummary, "approved_budget_fen" | "settlement_fen" | "settlement_progress_percent" | "settlement_budget_difference_fen"> | null;
  loading?: boolean;
  error?: string;
}>();
defineEmits<{ retry: [] }>();

const difference = computed(() => props.summary?.settlement_budget_difference_fen ?? null);
const exceeded = computed(() => (difference.value ?? 0) > 0);
</script>

<template>
  <section class="panel settlement-summary" aria-label="项目结算总览" :aria-busy="loading || undefined">
    <div class="toolbar settlement-summary-title">
      <h2>结算总览</h2>
      <div v-if="$slots.actions" class="toolbar page-heading-actions"><slot name="actions" /></div>
    </div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false">
      <ElButton text @click="$emit('retry')">重新读取</ElButton>
    </ElAlert>
    <dl v-if="summary" class="settlement-metrics">
      <div class="settlement-progress">
        <dt>结算进度</dt>
        <dd :class="{ 'without-budget': summary.settlement_progress_percent == null }">
          {{ settlementProgressText(summary.settlement_progress_percent, summary.approved_budget_fen) }}
        </dd>
        <ElProgress v-if="summary.settlement_progress_percent != null" :percentage="Math.min(100, summary.settlement_progress_percent)"
          :status="exceeded ? 'warning' : undefined" :show-text="false" :stroke-width="5"
          :aria-label="'结算进度 ' + summary.settlement_progress_percent + '%'" />
      </div>
      <div><dt>累计已批准结算</dt><dd>¥{{ money(summary.settlement_fen) }}</dd></div>
      <div><dt>当前批准预算</dt><dd>{{ summary.approved_budget_fen == null ? '尚未批准' : '¥' + money(summary.approved_budget_fen) }}</dd></div>
      <div v-if="difference != null" :class="{ 'over-budget': exceeded }">
        <dt>{{ exceeded ? '结算超出预算' : '剩余批准预算' }}</dt>
        <dd>¥{{ money(Math.abs(difference)) }}</dd>
      </div>
    </dl>
    <ElSkeleton v-else-if="loading" :rows="2" animated />
  </section>
</template>

<style scoped>
.settlement-summary {container-type:inline-size}
.settlement-summary-title {justify-content:space-between;gap:8px 16px;margin-bottom:12px}
.settlement-summary-title h2 {margin:0;font-size:16px}
.settlement-metrics {display:grid;grid-template-columns:1.2fr 1.2fr 1fr 1fr;gap:16px;margin:0;align-items:center}
.settlement-metrics > div:not(:first-child) {border-inline-start:1px solid var(--edge);padding-inline-start:14px;min-width:0}
.settlement-metrics dt {font-size:13px;color:var(--muted)}
.settlement-metrics dd {margin:4px 0 0;font-size:clamp(16px,1.55vw,22px);font-weight:620;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.settlement-progress {background:var(--brand-soft);border-radius:8px;padding:10px 12px}
.settlement-progress dd {font-size:25px;color:var(--brand-primary);line-height:1.2;margin:3px 0 7px}
.settlement-progress dd.without-budget {font-size:15px;margin-bottom:0}
.settlement-progress :deep(.el-progress-bar__outer) {background:var(--surface)}
.over-budget dd {color:var(--el-color-warning)}
@container (max-width:580px) {
  .settlement-metrics {grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
}
</style>
