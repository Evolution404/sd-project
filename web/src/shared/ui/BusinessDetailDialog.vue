<script setup lang="ts">
import { inject } from "vue";
import { guideCenterKey } from "../../guides/core/guide-center";
const openGuide = inject(guideCenterKey, null);
withDefaults(defineProps<{ open: boolean; title: string; loading?: boolean; error?: string }>(), { loading: false, error: "" });
defineEmits<{ (event: "close"): void; (event: "retry"): void }>();
</script>
<template>
  <ElDialog :model-value="open" :title="title" width="1280px" append-to-body destroy-on-close
    class="business-detail-dialog" modal-class="business-detail-overlay"
    :close-on-click-modal="false" @update:model-value="$emit('close')">
    <template #header>
      <div class="guide-dialog-heading">
        <strong>{{ title }}</strong>
        <ElButton v-if="openGuide" size="small" text data-guide-modal-help @click="openGuide">使用指引</ElButton>
      </div>
    </template>
    <ElSkeleton v-if="loading" :rows="6" animated />
    <ElAlert v-else-if="error" :title="error" type="error" :closable="false">
      <ElButton text @click="$emit('retry')">重新加载</ElButton>
    </ElAlert>
    <slot v-else />
    <template #footer><ElButton @click="$emit('close')">关闭详情</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.guide-dialog-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-right:32px}
.guide-dialog-heading strong{font-size:16px;font-weight:600}
</style>
