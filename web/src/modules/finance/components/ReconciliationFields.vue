<script setup lang="ts">
import type { ReconciliationInput, ReconciliationSettlementChoice } from "../../../../../server/shared/types/finance-workflows";
import FieldControl from "../../../shared/ui/FieldControl.vue";
import { money } from "../../../shared/api/client";

const form = defineModel<ReconciliationInput>({ required: true });
defineProps<{
  costChoices: ReadonlyArray<{ id: string; title: string; amount_fen: number }>;
  billChoices: ReconciliationSettlementChoice[];
  costsLoading: boolean;
  billsLoading: boolean;
}>();
const emit = defineEmits<{ searchCosts: [term: string]; searchBills: [term: string] }>();
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
      ><ElOption
        v-for="cost in costChoices"
        :key="cost.id"
        :value="cost.id"
        :label="
          cost.title + ' ¥' + money(cost.amount_fen)
        " /></ElSelect></ElFormItem>
  <ElFormItem
    label="已批准结算明细"
    prop="settlement_item_version_id"
    :rules="[{ required: true, message: '请填写已批准结算明细' }]"
    required
    ><ElSelect v-model="form.settlement_item_version_id" filterable remote
      :remote-method="term => emit('searchBills', term)"
      :loading="billsLoading" placeholder="搜索已批准结算编号后选择"
      no-match-text="未找到已批准结算，请更换编号"
      ><ElOption
        v-for="item in billChoices" :key="item.id" :value="item.id"
        :label="item.number + ' ¥' + money(item.amount_fen) + ' · ' + item.cost_node_name +
          (item.demand_no ? ' · ' + item.demand_no : '')" /></ElSelect></ElFormItem>
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
