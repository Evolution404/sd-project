<script setup lang="ts">
import BusinessTable from "./BusinessTable.vue";
import type { useHandlingReview } from "../composables/use-handling-review";
defineProps<{ workflow: ReturnType<typeof useHandlingReview> }>();
</script>

<template>
  <ElDialog :model-value="workflow.open.value" :title="workflow.request.value?.title || '批量办理核对'"
    append-to-body destroy-on-close width="min(760px, 94vw)" :close-on-click-modal="false"
    :close-on-press-escape="!workflow.saving.value" :show-close="!workflow.saving.value"
    @update:model-value="value => { if (!value) workflow.close(); }">
    <p>{{ workflow.request.value?.description }}</p>
    <ElAlert v-if="workflow.error.value" :title="workflow.error.value" type="error" :closable="false" />
    <div v-if="workflow.loading.value" role="status">正在核对所选记录…</div>
    <template v-else-if="workflow.rows.value.length">
      <p role="status">可办理 {{ workflow.ready.value.length }} 条，暂不可办理 {{ workflow.rows.value.length - workflow.ready.value.length }} 条。</p>
      <BusinessTable table-key="handling:preview" :rows="workflow.rows.value"
        :columns="[{ key: 'label', label: '记录', minWidth: 240 }, { key: 'reason', label: '核对结果', minWidth: 220 }]"
        sort-mode="off" filter-mode="off" compact max-height="380">
        <template #cell="{ row, column }">
          <span v-if="column.key === 'label'">{{ row.label }}</span>
          <ElTag v-else-if="!row.reason" type="success" effect="plain">可办理</ElTag>
          <span v-else>{{ row.reason }}</span>
        </template>
      </BusinessTable>
    </template>
    <template #footer>
      <ElButton :disabled="workflow.saving.value" @click="workflow.close">取消</ElButton>
      <ElButton type="primary" :loading="workflow.saving.value"
        :disabled="workflow.loading.value || !!workflow.error.value || !workflow.ready.value.length"
        @click="workflow.commit">确认办理 {{ workflow.ready.value.length }} 条</ElButton>
    </template>
  </ElDialog>
</template>
