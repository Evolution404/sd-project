<script setup lang="ts">
import { useAccess } from "../services/access";
const can = useAccess();
import { ref, watch } from "vue";
import { ElMessage } from "element-plus";
import FieldControl from "./FieldControl.vue";
import BusinessTable, { type TableColumn } from "./BusinessTable.vue";
import { api, today, type Row, money, quantity } from "../services/api";
const props = defineProps<{
  modelValue: boolean;
  demandId: string;
  expectedVersion: number;
  scopeId?: string;
}>();
const emit = defineEmits(["update:modelValue", "confirmed"]);
const priceColumns: TableColumn[] = [
  { key: "location_item_no", label: "位置序号", minWidth: 130 },
  { key: "quantity_scaled", label: "计价数量", minWidth: 150 },
  { key: "amount_fen", label: "金额", minWidth: 160 },
];
const quote = ref<Row | null>(null),
  busy = ref(false),
  selections = ref<Row>({}),
  selectionBasis = ref<Row>({}),
  bases = ref<Row>({}),
  date = ref(today());
async function calculate(confirm = false) {
  busy.value = true;
  try {
    quote.value = await api("/demands/" + props.demandId + "/quote", "POST", {
      expected_version: props.expectedVersion,
      approval_scope_version_id: props.scopeId,
      pricing_date: date.value,
      confirm,
      selections: selections.value,
      selection_basis: selectionBasis.value,
      bases: bases.value,
    });
    for (const missing of quote.value!.missing)
      bases.value[missing.location_item_no] ||= {};
    if (confirm) {
      ElMessage.success("已保存正式参考报价");
      emit("confirmed");
    }
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    busy.value = false;
  }
}
watch(
  () => props.modelValue,
  (value) => {
    if (value) {
      quote.value = null;
      selections.value = {};
      selectionBasis.value = {};
      bases.value = {};
      calculate();
    }
  },
  { immediate: true },
);
</script>
<template>
  <ElDialog
    :model-value="modelValue"
    title="参考价格"
    width="900px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    ><ElForm label-position="top" novalidate
      ><ElFormItem label="价格适用日期"
        ><ElDatePicker v-model="date" value-format="YYYY-MM-DD" /></ElFormItem
      ><template v-if="quote"
        ><ElAlert
          :title="
            quote.complete
              ? '完整参考价 ¥' + money(quote.total_fen)
              : '未完整计价，已计价小计 ¥' + money(quote.subtotal_fen)
          "
          :type="quote.complete ? 'success' : 'warning'"
          :closable="false" /><BusinessTable client-side table-key="quote:locations" :rows="quote.lines || []"
            :columns="priceColumns" compact>
            <template #cell="{ row, column }">
              <span v-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</span>
              <span v-else-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</span>
              <span v-else>{{ row[column.key] ?? '—' }}</span>
            </template>
          </BusinessTable>
        <div
          v-for="missing in quote.missing"
          :key="missing.location_item_no"
          class="panel"
        >
          <p>位置 {{ missing.location_item_no }} · {{ missing.reason }}</p>
          <template v-if="missing.candidates?.length > 1"
            ><ElFormItem label="正式规则选择"
              ><ElSelect v-model="selections[missing.location_item_no]"
                ><ElOption
                  v-for="candidate in missing.candidates"
                  :key="candidate.id"
                  :value="candidate.id"
                  :label="candidate.title" /></ElSelect></ElFormItem
            ><ElFormItem label="选择依据" required
              ><ElInput
                v-model="
                  selectionBasis[missing.location_item_no]
                " /></ElFormItem
          ></template>
          <div v-if="missing.needs_basis" class="form-grid">
            <ElFormItem
              v-for="basis in [
                { key: 'labor', label: '人工费用基数（元）' },
                { key: 'materials', label: '材料费用基数（元）' },
                { key: 'machinery', label: '机械费用基数（元）' },
              ]"
              :key="basis.key"
              :label="basis.label"
              ><FieldControl
                v-model="bases[missing.location_item_no][basis.key]"
                :field="{ type: 'money' }" /></ElFormItem
            ><ElFormItem label="计费基数依据" required
              ><ElInput v-model="bases[missing.location_item_no].evidence"
            /></ElFormItem>
          </div></div></template></ElForm
    ><template #footer
      ><ElButton @click="emit('update:modelValue', false)">关闭报价</ElButton
      ><ElButton :loading="busy" @click="calculate()">重新试算</ElButton
      ><ElButton
        type="primary"
        :loading="busy"
        :disabled="!can('write') || !quote?.complete || !!quote?.id"
        @click="calculate(true)"
        >确认正式报价</ElButton
      ></template
    ></ElDialog
  >
</template>
