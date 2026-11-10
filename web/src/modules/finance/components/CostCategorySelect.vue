<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { CostCategoryNode } from "../../../../../server/shared/types/trees";
import { api } from "../../../shared/api/client";
import BusinessTreeSelect from "../../../shared/ui/BusinessTreeSelect.vue";
const props = defineProps<{
  projectId: string;
  modelValue: string | null | undefined;
  disabled?: boolean;
  nodes?: CostCategoryNode[];
  historicalLabel?: string;
  historicalVersionId?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();
const adoptedId = ref(props.modelValue);
watch(
  () => [props.historicalLabel, props.historicalVersionId],
  () => {
    adoptedId.value = props.modelValue;
  },
);
const selectedHistory = computed(() =>
  props.modelValue === adoptedId.value ? props.historicalLabel : undefined,
);
const nodes = ref<CostCategoryNode[]>([]),
  error = ref("");
let sequence = 0;
async function load() {
  const current = ++sequence;
  try {
    const value = await api<CostCategoryNode[]>(
      `/projects/${props.projectId}/cost-tree`,
    );
    if (sequence === current) {
      nodes.value = value;
      error.value = "";
    }
  } catch (failure) {
    if (sequence === current) error.value = (failure as Error).message;
  }
}
watch(
  () => [props.projectId, props.nodes] as const,
  () => {
    if (props.nodes) nodes.value = props.nodes;
    else void load();
  },
  { immediate: true },
);
const choices = computed(() =>
  nodes.value.map((node) => ({
    ...node,
    disabled: !node.selectable,
    disabled_reason:
      node.disabled_reason ||
      (!node.selectable ? "请选择有效末级费用科目" : ""),
  })),
);
</script>
<template>
  <BusinessTreeSelect
    :model-value="modelValue"
    :nodes="choices"
    :disabled="disabled || !!error"
    :historical-label="selectedHistory"
    @update:model-value="(value) => emit('update:modelValue', value)"
  /><ElAlert v-if="error" :title="error" type="error" :closable="false"
    ><ElButton text @click="load">重试</ElButton></ElAlert
  >
</template>
