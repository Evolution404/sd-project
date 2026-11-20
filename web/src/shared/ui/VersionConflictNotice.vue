<script setup lang="ts">
import { ref, watch } from "vue";
type Comparison = { label: string; draft: string; current: string };
const props = defineProps<{
  message: string;
  readCurrent: () => Promise<Comparison[]>;
  applyCurrent?: () => void;
}>();
const comparison = ref<Comparison[]>([]);
const loading = ref(false);
const error = ref("");
let sequence = 0;

watch(() => props.message, () => {
  sequence++;
  comparison.value = [];
  loading.value = false;
  error.value = "";
});
async function compare() {
  const request = ++sequence;
  loading.value = true;
  error.value = "";
  try {
    const facts = await props.readCurrent();
    if (request === sequence) comparison.value = facts;
  } catch (failure) {
    if (request === sequence) error.value = (failure as Error).message;
  } finally {
    if (request === sequence) loading.value = false;
  }
}
</script>

<template>
  <div v-if="message" class="version-conflict">
    <ElAlert :title="message" type="warning" :closable="false">
      <p>本次修改已保留。可以读取当前记录并核对差异。</p>
      <ElButton link type="primary" :loading="loading" @click="compare">读取当前版本并对比</ElButton>
    </ElAlert>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElDescriptions v-if="comparison.length" border :column="1">
      <ElDescriptionsItem v-for="field in comparison" :key="field.label" :label="field.label">
        <div>本次填写 · {{ field.draft }}</div>
        <div>当前记录 · {{ field.current }}</div>
      </ElDescriptionsItem>
    </ElDescriptions>
    <ElButton v-if="comparison.length && applyCurrent" :disabled="loading || !!error" @click="applyCurrent">
      以此版本继续编辑
    </ElButton>
  </div>
</template>

<style scoped>
.version-conflict { display: grid; gap: 8px; margin-bottom: 16px; }
</style>
