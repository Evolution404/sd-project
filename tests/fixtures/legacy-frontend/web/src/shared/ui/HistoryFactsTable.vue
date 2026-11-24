<script setup lang="ts">
import { computed } from "vue";
import type { HistoryTable, HistoryValue } from "../../../../server/shared/types/history";
import BusinessTable from "./BusinessTable.vue";
import { historyValue } from "../utils/history-display";

const props = defineProps<{ table: HistoryTable; scope: string }>();
const columns = computed(() => props.table.columns.map((label, index) => ({
  key: String(index), label, hideable: false, minWidth: index === 0 ? 110 : index === 1 ? 160 : 116,
})));
const rows = computed(() => props.table.rows.map((row, index) => ({
  id: String(index), ...Object.fromEntries(row.map((value, column) => [String(column), value])),
})));
</script>

<template>
  <section v-if="rows.length" class="history-facts-table">
    <h4>{{ table.title }}</h4>
    <BusinessTable :table-key="'history:' + scope + ':' + table.title" :columns="columns"
      :rows="rows" :actions-width="0" sort-mode="off" filter-mode="off" :max-height="325" compact hide-toolbar>
      <template #cell="{ value }"><span class="history-table-value">{{ historyValue(value as HistoryValue) }}</span></template>
    </BusinessTable>
  </section>
</template>

<style scoped>
.history-facts-table { min-width: 0; }
h4 { margin: 0 0 10px; font-size: 14px; font-weight: 660; }
.history-table-value { display: block; white-space: normal; overflow-wrap: anywhere; line-height: 1.5; }
</style>
