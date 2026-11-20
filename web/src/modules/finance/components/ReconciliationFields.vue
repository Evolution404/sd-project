<script setup lang="ts">
import type { ReconciliationInput, ReconciliationSettlementChoice } from "../../../../../server/shared/types/finance-workflows";
import { computed, ref } from "vue";
import { choiceLabels } from "../../../shared/utils/choice-labels";
import FieldControl from "../../../shared/ui/FieldControl.vue";
import { money } from "../../../shared/api/client";

const form = defineModel<ReconciliationInput>({ required: true });
const props = defineProps<{
  costChoices: ReadonlyArray<{ id: string; title: string; amount_fen: number }>;
  billChoices: ReconciliationSettlementChoice[];
  costsLoading: boolean;
  billsLoading: boolean;
}>();
const emit = defineEmits<{ searchCosts: [term: string]; searchBills: [term: string] }>();
const billSearch = ref("");
const costLabels = computed(() => new Map(props.costChoices.map(item =>
  [item.id, item.title + " · ¥" + money(item.amount_fen)])));
const billLabels = computed(() => choiceLabels(props.billChoices,
  item => item.cost_node_name + " · ¥" + money(item.amount_fen), item => [item.number]));
function billLabel(id: string) {
  const item = props.billChoices.find(choice => choice.id === id);
  const label = billLabels.value.get(id) || "正在读取结算明细";
  const term = billSearch.value.trim().toUpperCase();
  return item && term && item.number.toUpperCase().includes(term) && !label.endsWith(item.number)
    ? label + " · " + item.number : label;
}
</script>

<template>
  <div class="full-width muted" role="note" style="margin-bottom:12px">从整个子项目检索费用和已批准结算明细，不受主列表分页限制；未显示的历史记录可输入事项或编号搜索。</div>
  <ElFormItem
    label="实际费用"
    prop="cost_version_id"
    :rules="[{ required: true, message: '请填写实际费用' }]"
    required
    ><ElSelect v-model="form.cost_version_id" filterable remote
      :remote-method="term => emit('searchCosts', term)"
      :loading="costsLoading" placeholder="搜索费用事项后选择"
      no-match-text="未找到匹配费用，请更换关键词"
      ><template #label>{{ costLabels.get(form.cost_version_id || '') || "正在读取费用事项" }}</template>
      <ElOption
        v-for="cost in costChoices"
        :key="cost.id"
        :value="cost.id"
        :label="costLabels.get(cost.id)!" /></ElSelect></ElFormItem>
  <ElFormItem
    label="已批准结算明细"
    prop="settlement_item_version_id"
    :rules="[{ required: true, message: '请填写已批准结算明细' }]"
    required
    ><ElSelect v-model="form.settlement_item_version_id" filterable remote
      :remote-method="term => { billSearch = term; emit('searchBills', term); }"
      :loading="billsLoading" placeholder="搜索费用科目或结算编号"
      no-match-text="未找到已批准结算，请更换关键词"
      ><template #label>{{ billLabel(form.settlement_item_version_id || '') }}</template>
      <ElOption
        v-for="item in billChoices" :key="item.id" :value="item.id"
        :label="billLabel(item.id)" /></ElSelect></ElFormItem>
  <ElFormItem
    label="费用份额（元）"
    prop="reconciled_cost_fen"
    :rules="[{ required: true, message: '请填写费用份额（元）' }]"
    required
    ><FieldControl
      v-model="form.reconciled_cost_fen"
      :field="{ type: 'money' }" /></ElFormItem>
  <ElFormItem
    label="核定结算额（元）"
    prop="reconciled_settlement_fen"
    :rules="[{ required: true, message: '请填写核定结算额（元）' }]"
    required
    ><FieldControl
      v-model="form.reconciled_settlement_fen"
      :field="{ type: 'money' }" /></ElFormItem>
  <ElFormItem label="核对依据"
    ><ElInput v-model="form.evidence" /></ElFormItem>
  <ElFormItem label="最终核对"
    ><ElSwitch v-model="form.is_final" /></ElFormItem>
</template>
