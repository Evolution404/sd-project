<script setup lang="ts">
withDefaults(defineProps<{ open: boolean; title: string; loading?: boolean; error?: string }>(), { loading: false, error: "" });
defineEmits<{ (event: "close"): void; (event: "retry"): void }>();
</script>
<template>
  <ElDialog :model-value="open" :title="title" width="1280px" append-to-body destroy-on-close
    class="business-detail-dialog" modal-class="business-detail-overlay"
    :close-on-click-modal="false" @update:model-value="$emit('close')">
    <ElSkeleton v-if="loading" :rows="6" animated />
    <ElAlert v-else-if="error" :title="error" type="error" :closable="false">
      <ElButton text @click="$emit('retry')">重新加载</ElButton>
    </ElAlert>
    <slot v-else />
    <template #footer><ElButton @click="$emit('close')">关闭详情</ElButton></template>
  </ElDialog>
</template>
