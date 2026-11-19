<script setup lang="ts">
import BusinessWorkSurface from "./BusinessWorkSurface.vue";
defineProps<{
  open: boolean;
  page?: boolean;
  title: string;
  subtitle?: string;
  width: string;
  busy?: boolean;
  beforeClose?: (done: () => void) => void;
}>();
defineOptions({ inheritAttrs: false });
defineEmits<{ close: [] }>();
</script>
<template>
  <BusinessWorkSurface v-if="page && open"
    v-bind="$attrs" :title="title" :subtitle="subtitle" :busy="busy" @back="$emit('close')">
    <slot />
    <template #footer><slot name="footer" /></template>
  </BusinessWorkSurface>
  <ElDialog v-else-if="!page" v-bind="$attrs" :model-value="open" :title="title" :width="width"
    append-to-body :close-on-click-modal="false" :before-close="beforeClose"
    @update:model-value="open && !$event && $emit('close')">
    <slot />
    <template #footer><slot name="footer" /></template>
  </ElDialog>
</template>
