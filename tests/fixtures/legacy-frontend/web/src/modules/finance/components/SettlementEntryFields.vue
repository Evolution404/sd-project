<script setup lang="ts">
import type { SettlementDraftInput } from "../../../../../server/shared/types/finance-workflows";
import FieldControl from "../../../shared/ui/FieldControl.vue";

const form = defineModel<Omit<SettlementDraftInput, "items" | "resolutions">>({ required: true });
defineProps<{
  approvalsError: string;
  approvalsLoading: boolean;
  approvalChoices: ReadonlyArray<{ id: string; version_no: number }>;
  editingVersion: boolean;
  itemized: boolean;
}>();
const emit = defineEmits<{ retry: []; "approval-change": [id: string] }>();
</script>

<template>
  <ElAlert v-if="approvalsError" :title="'批准历史读取失败：' + approvalsError" type="error" :closable="false">
    <ElButton :loading="approvalsLoading" @click="emit('retry')" data-guide-action="finance.reload-approvals">重新读取批准历史</ElButton>
  </ElAlert>
  <ElFormItem label="结算日期"
    ><ElDatePicker
      v-model="form.settlement_on"
      value-format="YYYY-MM-DD" /></ElFormItem>
  <ElFormItem v-if="form.change_type !== 'void'" label="结算方式">
    <ElRadioGroup v-model="form.mode">
      <ElRadioButton value="project_total">按项目总额</ElRadioButton>
      <ElRadioButton value="itemized">按子费用</ElRadioButton>
    </ElRadioGroup>
  </ElFormItem>
  <ElFormItem v-if="!itemized && form.change_type !== 'void'" label="本次金额（元）" prop="amount_fen"
    :rules="[{ required: true, type: 'number', min: 1, message: '请输入大于零的本次结算金额' }]" required>
    <FieldControl v-model="form.amount_fen" :field="{ type: 'money' }" />
  </ElFormItem>
  <ElFormItem
    label="采用批准版本"
    prop="approval_version_id"
    :rules="[{ required: true, message: '请填写采用批准版本' }]"
    required
    ><ElSelect :model-value="form.approval_version_id" @update:model-value="emit('approval-change', $event)" :loading="approvalsLoading" :disabled="approvalsLoading || !!approvalsError"
      ><ElOption
        v-for="ap in approvalChoices"
        :key="ap.id"
        :value="ap.id"
        :label="'批准第' + ap.version_no" /></ElSelect></ElFormItem>
  <ElFormItem label="结算依据"
    ><ElInput v-model="form.basis" /></ElFormItem>
  <ElFormItem v-if="editingVersion" label="修订动作"
    ><ElSelect v-model="form.change_type"
      ><ElOption label="完整修订" value="revision" /><ElOption
        label="正式注销"
        value="void" /></ElSelect></ElFormItem>
</template>
