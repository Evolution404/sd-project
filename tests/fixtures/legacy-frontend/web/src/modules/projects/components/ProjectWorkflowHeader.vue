<script setup lang="ts">
defineProps<{ message: string; label?: string; actionId?: string }>();
const emit = defineEmits<{ proceed: [] }>();
</script>

<template>
  <div class="panel project-next-step">
    <div>
      <h2 v-if="label">下一步</h2>
      <p>{{ message }}</p>
    </div>
    <ElButton v-if="label" type="primary" :data-guide-action="actionId" @click="emit('proceed')">{{ label }}</ElButton>
  </div>
</template>

<style scoped>
.project-next-step {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.project-next-step h2 {margin:0 0 4px;font-size:16px}
.project-next-step p {margin:0}
</style>
