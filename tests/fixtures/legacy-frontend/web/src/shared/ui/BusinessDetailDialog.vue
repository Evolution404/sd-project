<script setup lang="ts">
import { inject } from "vue";
import { ElDrawer } from "element-plus";
import BusinessWorkSurface from "./BusinessWorkSurface.vue";
import { guideCenterKey } from "../../guides/core/guide-center";
const openGuide = inject(guideCenterKey, null);
withDefaults(defineProps<{ open: boolean; title: string; loading?: boolean; error?: string; size?: string; page?: boolean; subtitle?: string; bare?: boolean }>(), { loading: false, error: "", size: "min(1080px, 94vw)" });
defineEmits<{ (event: "close"): void; (event: "retry"): void }>();
</script>
<template>
  <component v-if="!page || open" :is="page ? BusinessWorkSurface : ElDrawer"
    :title="title" :class="page ? 'business-detail-page' : 'business-detail-dialog'"
    v-bind="page ? { subtitle, bare } : { modelValue: open, size, appendToBody: true, destroyOnClose: true,
      modalClass: 'business-detail-overlay', closeOnClickModal: false }"
    @back="$emit('close')" @update:model-value="open && !$event && $emit('close')">
    <template v-if="!page" #header="{ titleId }">
      <div class="guide-dialog-heading">
        <strong :id="titleId">{{ title }}</strong>
        <ElButton v-if="openGuide" size="small" text data-guide-modal-help @click="openGuide">使用指引</ElButton>
      </div>
    </template>
    <ElSkeleton v-if="loading" :rows="6" animated />
    <ElAlert v-else-if="error" :title="error" type="error" :closable="false">
      <ElButton text @click="$emit('retry')">重新加载</ElButton>
    </ElAlert>
    <slot v-else />
    <template v-if="!page || $slots.footer" #footer>
      <slot v-if="page" name="footer" />
      <ElButton v-else @click="$emit('close')">关闭详情</ElButton>
    </template>
  </component>
</template>

<style scoped>
.guide-dialog-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-right:32px}
.guide-dialog-heading strong{font-size:16px;font-weight:600}
</style>
