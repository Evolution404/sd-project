<script setup lang="ts">
import { settlementProgressText } from "../../../shared/utils/settlement-progress";
import { computed } from "vue";
import { money, quantity } from "../../../shared/api/client";
import BusinessTable, { type TableColumn } from "../../../shared/ui/BusinessTable.vue";

import type { ProjectFinanceSnapshot, ProjectCloseDemandFact } from "./types";
function closeCell(row: ProjectCloseDemandFact, key: string): string {
  if (key === "demand_no") return row.demand_no;
  if (key === "approved_quantity_scaled" ||
      key === "resolved_quantity_scaled" ||
      key === "remaining_quantity_scaled" ||
      key === "excess_quantity_scaled") return quantity(row[key]);
  return "—";
}
const props = defineProps<{
  open: boolean;
  approvedVersion?: number | null;
  summary: ProjectFinanceSnapshot | null;
  canClose: boolean;
}>();
const emit = defineEmits<{ "update:open": [open: boolean]; confirm: [] }>();
const model = computed({
  get: () => props.open,
  set: (next: boolean) => emit("update:open", next),
});
const columns: TableColumn[] = [
  { key: "demand_no", label: "需求编号", minWidth: 160 },
  { key: "approved_quantity_scaled", label: "批准工作量", minWidth: 145 },
  { key: "resolved_quantity_scaled", label: "已解决", minWidth: 130 },
  { key: "remaining_quantity_scaled", label: "未解决", minWidth: 130 },
  { key: "excess_quantity_scaled", label: "超出批准", minWidth: 130 },
];
</script>
<template>
  <ElDialog v-model="model" append-to-body title="结项前业务核对" width="min(820px, 94vw)"
    :close-on-click-modal="false">
    <template v-if="summary">
      <ElAlert type="warning" :closable="false"
        title="正式结项将保留当时全部差异事实及审核依据。存在差异不代表自动禁止结项，必须核对后作出正式决定。" />
      <ElDescriptions :column="2" border class="project-close-review">
        <ElDescriptionsItem label="当前批准范围">
          {{ approvedVersion ? '批准第' + approvedVersion + '版' : '无有效批准' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="待处理需求">
          {{ summary.demands?.filter(row => row.remaining_quantity_scaled > 0).length || 0 }} 项
        </ElDescriptionsItem>
        <ElDescriptionsItem label="真实费用">¥{{ money(summary.actual_cost_fen) }}</ElDescriptionsItem>
        <ElDescriptionsItem label="已批准结算">¥{{ money(summary.settlement_fen) }}</ElDescriptionsItem>
        <ElDescriptionsItem label="结算进度">{{ settlementProgressText(summary.settlement_progress_percent) }}</ElDescriptionsItem>
        <ElDescriptionsItem v-if="summary.unsettled_cost_fen" label="待结算">¥{{ money(summary.unsettled_cost_fen) }}</ElDescriptionsItem>
        <ElDescriptionsItem v-if="summary.excess_settlement_fen" label="超结算">¥{{ money(summary.excess_settlement_fen) }}</ElDescriptionsItem>
        <ElDescriptionsItem label="待核对费用">¥{{ money(summary.unreconciled_cost_fen) }}</ElDescriptionsItem>
        <ElDescriptionsItem label="实际与预算差额">
          {{ summary.budget_difference_fen == null ? '尚未批准' : '¥' + money(summary.budget_difference_fen) }}
        </ElDescriptionsItem>
      </ElDescriptions>
      <BusinessTable v-if="summary.demands?.length" client-side
        table-key="project:close-check" :rows="summary.demands" :columns="columns">
        <template #cell="{ row, column }">
          {{ closeCell(row, column.key) }}
        </template>
      </BusinessTable>
    </template>
    <ElSkeleton v-else :rows="5" animated />
    <template #footer>
      <ElButton data-guide-action="projects.close-review" @click="model = false">继续核对</ElButton>
      <ElButton data-guide-action="projects.close" type="primary" :disabled="!canClose || !summary || !approvedVersion"
        @click="emit('confirm')">已核对差异，正式结项</ElButton>
    </template>
  </ElDialog>
</template>
<style scoped>
.project-close-review {margin:16px 0}
</style>
