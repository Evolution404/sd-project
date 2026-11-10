<script setup lang="ts">
import { computed } from "vue";
import { buildTree, treePath, type TreeRecord } from "../utils/tree";
interface SelectNode extends TreeRecord {
  disabled?: boolean;
  disabled_reason?: string;
}
const props = defineProps<{
  nodes: SelectNode[];
  modelValue: string | null | undefined;
  disabled?: boolean;
  placeholder?: string;
  historicalLabel?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();
const value = computed({
  get: () => props.modelValue || undefined,
  set: (selected) => emit("update:modelValue", selected || null),
});
const data = computed(() =>
  buildTree(
    props.nodes.map((node) => ({
      ...node,
      label:
        node.id === props.modelValue && props.historicalLabel
          ? props.historicalLabel + "（采用版本）"
          : treePath(props.nodes, node.id)
              .map((item) => item.name)
              .join(" / "),
    })),
  ),
);
function filterNode(text: string, node: { label?: string }) {
  return String(node.label || "").includes(text);
}
</script>
<template>
  <ElTreeSelect
    v-model="value"
    popper-class="business-tree-select-popper"
    :data="data"
    node-key="id"
    :props="{ label: 'label', children: 'children', disabled: 'disabled' }"
    :disabled="disabled"
    :placeholder="placeholder || '搜索并选择'"
    check-strictly
    filterable
    clearable
    :render-after-expand="false"
    :filter-node-method="filterNode"
  >
    <template #default="{ data: node }"
      ><ElTooltip
        :disabled="!node.disabled_reason"
        :content="node.disabled_reason"
        ><span>{{ node.name }}</span></ElTooltip
      ></template
    >
  </ElTreeSelect>
</template>
