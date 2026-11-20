<script setup lang="ts">
import type { ActualCostInput } from "../../../../../server/shared/types/finance-workflows";
import type { CostCategoryNode } from "../../../../../server/shared/types/trees";
import FieldControl from "../../../shared/ui/FieldControl.vue";
import CostCategorySelect from "./CostCategorySelect.vue";

const form = defineModel<Partial<ActualCostInput>>({ required: true });
defineProps<{
  projectId: string;
  nodes: CostCategoryNode[];
  editing: boolean;
  historicalLabel?: string;
  historicalVersionId?: string;
}>();
</script>

<template>
  <ElFormItem
    label="费用事项"
    prop="title"
    :rules="[{ required: true, message: '请填写费用事项' }]"
    required
    ><ElInput v-model="form.title" /></ElFormItem>
  <ElFormItem
    label="末级费用科目"
    prop="cost_node_id"
    :rules="[{ required: true, message: '请填写末级费用科目' }]"
    required
    > <CostCategorySelect v-model="form.cost_node_id" :project-id="projectId" :nodes="nodes" :disabled="editing" :historical-label="historicalLabel" :historical-version-id="historicalVersionId" /></ElFormItem>
  <ElFormItem
    label="实际金额（元）"
    prop="amount_fen"
    :rules="[{ required: true, message: '请填写实际金额（元）' }]"
    required
    ><FieldControl
      v-model="form.amount_fen"
      :field="{ type: 'money' }" /></ElFormItem>
  <ElFormItem
    label="发生日期"
    prop="occurred_on"
    :rules="[{ required: true, message: '请填写发生日期' }]"
    required
    ><ElDatePicker
      v-model="form.occurred_on"
      value-format="YYYY-MM-DD" /></ElFormItem>
  <ElFormItem
    label="费用凭据"
    prop="evidence"
    :rules="[{ required: true, message: '请填写费用凭据' }]"
    required
    class="full-width"
    ><ElInput v-model="form.evidence" type="textarea" /></ElFormItem>
</template>
