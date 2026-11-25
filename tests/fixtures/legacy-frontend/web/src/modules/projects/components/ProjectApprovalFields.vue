<script setup lang="ts">
import FieldControl from "../../../shared/ui/FieldControl.vue";

const form = defineModel<{ approved_budget_fen?: number; basis?: string }>({ required: true });
</script>

<template>
  <ElFormItem
    label="批准预算（元）"
    prop="approved_budget_fen"
    :rules="[{ required: true, message: '请填写批准预算（元）' }]"
    required
    ><FieldControl
      v-model="form.approved_budget_fen"
      :field="{ type: 'money' }" /></ElFormItem>
  <ElFormItem label="批准依据"
    ><ElInput v-model="form.basis" /></ElFormItem>
</template>
