<script setup lang="ts">
import type { SettlementDocumentDetails } from "../../../../../server/shared/types/finance-workflows";
import { money, quantity } from "../../../shared/api/client";
import BusinessTable, { type TableColumn } from "../../../shared/ui/BusinessTable.vue";

defineProps<{ document: SettlementDocumentDetails; draft?: boolean }>();
const itemColumns: TableColumn[] = [
  { key: "cost_node_name", label: "费用科目", minWidth: 145, wrap: true },
  { key: "demand", label: "对应需求", minWidth: 210, wrap: true },
  { key: "quantity_scaled", label: "工作量", minWidth: 100 },
  { key: "amount_fen", label: "结算金额", minWidth: 115 },
  { key: "evidence", label: "结算依据", minWidth: 155, wrap: true },
];
const resolutionColumns: TableColumn[] = [
  { key: "demand", label: "已解决需求", minWidth: 230, wrap: true },
  { key: "resolved_quantity_scaled", label: "本次解决量", minWidth: 110 },
  { key: "unit", label: "计量单位", minWidth: 90 },
  { key: "evidence", label: "解决依据", minWidth: 200, wrap: true },
];
</script>

<template>
  <section v-if="document.items.length" class="panel">
    <h2>{{ draft ? "草稿结算明细" : "结算明细" }}</h2>
    <BusinessTable table-key="finance:document-items" :rows="document.items" :columns="itemColumns"
      hide-toolbar sort-mode="off" filter-mode="off">
      <template #cell="{ row, column, value }">
        <span v-if="column.key === 'demand'">{{ row.demand ? row.demand.demand_no + ' · ' + row.demand.problem_description : '独立费用' }}</span>
        <span v-else-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</span>
        <span v-else-if="column.key === 'quantity_scaled'">{{ row.quantity_scaled == null ? '—' : quantity(row.quantity_scaled) }}</span>
        <span v-else>{{ value || '—' }}</span>
      </template>
    </BusinessTable>
  </section>
  <section v-if="document.resolutions.length" class="panel">
    <h2>{{ draft ? "草稿需求解决量" : "最近提交的需求解决量" }}</h2>
    <BusinessTable table-key="finance:document-resolutions" :rows="document.resolutions" :columns="resolutionColumns"
      hide-toolbar sort-mode="off" filter-mode="off">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'demand'">{{ row.demand.demand_no }} · {{ row.demand.problem_description }}</span>
        <span v-else-if="column.key === 'resolved_quantity_scaled'">{{ quantity(row.resolved_quantity_scaled) }}</span>
        <span v-else>{{ (column.key === 'unit' ? row.demand.unit : row.evidence) || '—' }}</span>
      </template>
    </BusinessTable>
  </section>
</template>
