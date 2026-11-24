<template>
  <el-select :model-value="modelValue" aria-label="执行协议" filterable clearable :loading="loading" :disabled="!frameworkId"
    placeholder="直接归属年度框架" @update:model-value="value => emit('update:modelValue', value || null)">
    <el-option v-for="option in options" :key="option.id" :value="option.id"
      :label="option.name" :disabled="!option.eligible" />
  </el-select>
  <el-alert v-if="error" class="mt-2" type="error" :title="error" :closable="false" />
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { eligibleProjectAgreements } from "@/api/business/projects";

const props = defineProps<{ frameworkId?: string; modelValue?: string | null }>();
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();
const options = ref<Awaited<ReturnType<typeof eligibleProjectAgreements>>["options"]>([]);
const loading = ref(false);
const error = ref("");

watch(() => props.frameworkId, async (frameworkId, previous, onCleanup) => {
  let valid = true;
  onCleanup(() => { valid = false; });
  options.value = [];
  error.value = "";
  loading.value = Boolean(frameworkId);
  if (previous && frameworkId !== previous) emit("update:modelValue", null);
  if (!frameworkId) return;
  try {
    const selected = previous && frameworkId !== previous ? null : props.modelValue;
    const result = await eligibleProjectAgreements(frameworkId, selected);
    if (valid) options.value = result.options;
  } catch (cause) {
    if (valid) error.value = (cause as Error).message;
  } finally {
    if (valid) loading.value = false;
  }
}, { immediate: true });
</script>
