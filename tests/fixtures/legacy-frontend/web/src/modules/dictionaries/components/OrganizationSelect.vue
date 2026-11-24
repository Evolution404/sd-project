<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  OrganizationNode,
  OrganizationDetail,
} from "../../../../../server/shared/types/trees";
import { api } from "../../../shared/api/client";
import BusinessTreeSelect from "../../../shared/ui/BusinessTreeSelect.vue";
const props = defineProps<{
  modelValue: string | null | undefined;
  disabled?: boolean;
  historicalLabel?: string;
  historicalVersionId?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();
const adoptedId = ref<string | null>(null),
  adoptedPath = ref("");
const nodes = ref<OrganizationNode[]>([]),
  loading = ref(true),
  error = ref("");
let sequence = 0;
async function load() {
  const current = ++sequence;
  loading.value = true;
  try {
    const rows = await api<OrganizationNode[]>("/organizations");
    let path = "",
      owner: string | null = null;
    if (props.historicalVersionId && props.modelValue) {
      const history = await api<OrganizationDetail>(
        "/organizations/" + props.modelValue,
      );
      const version = history.versions.find(
        (item) => item.id === props.historicalVersionId,
      );
      if (version) {
        owner = props.modelValue;
        path =
          (version.path_complete ? "" : "历史上级待核对 / ") +
          (version.historical_path || version.name);
      }
    }
    if (current === sequence) {
      nodes.value = rows;
      adoptedId.value = owner;
      adoptedPath.value = path;
      error.value = "";
    }
  } catch (failure) {
    if (current === sequence) error.value = (failure as Error).message;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
watch(() => props.historicalVersionId, load, { immediate: true });
const selectedHistory = computed(() =>
  props.modelValue === adoptedId.value
    ? adoptedPath.value || props.historicalLabel
    : undefined,
);
const choices = computed(() =>
  nodes.value.map((node) => ({ ...node, disabled: !node.selectable })),
);
</script>
<template>
  <ElSkeleton v-if="loading" :rows="1" animated /><template v-else
    ><BusinessTreeSelect
      :model-value="modelValue"
      :nodes="choices"
      :disabled="disabled || !!error"
      :historical-label="selectedHistory"
      @update:model-value="(value) => emit('update:modelValue', value)"
    /><ElAlert v-if="error" :title="error" type="error" :closable="false"
      ><ElButton text @click="load">重试</ElButton></ElAlert
    ></template
  >
</template>
