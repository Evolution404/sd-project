<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
  busy?: boolean;
  bare?: boolean;
}>();
defineEmits<{ back: [] }>();
</script>
<template>
  <section class="business-work-surface" :aria-label="title" :aria-busy="busy || undefined">
    <div class="page-heading">
      <div>
        <ElButton class="work-back" text size="small" :disabled="busy" @click="$emit('back')">← 返回</ElButton>
        <h1>{{ title }}</h1>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
    </div>
    <div class="work-body" :class="{ 'is-bare': bare }"><slot /></div>
    <div v-if="$slots.footer" class="work-footer"><slot name="footer" /></div>
  </section>
</template>
<style scoped>
.work-back { margin:0 0 8px -8px; color:var(--muted) }
.work-body { background:var(--surface); border:1px solid var(--edge); border-radius:var(--el-border-radius-base); padding:clamp(14px,2vw,24px) }
.work-body.is-bare { background:transparent; border:0; padding:0 }
.work-footer { position:sticky; bottom:0; z-index:4; display:flex; justify-content:flex-end; align-items:center; flex-wrap:wrap; gap:8px; background:var(--page-background); border-top:1px solid var(--edge); padding:12px 0; margin-top:12px }
.work-footer :deep(.el-button + .el-button) { margin-left:0 }
</style>
