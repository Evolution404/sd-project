<template>
  <el-text v-if="selectedName" class="mr-2">{{ selectedName }}</el-text>
  <el-button v-if="!readonly" :disabled="disabled" @click="open = true">选择费用科目</el-button>
  <CostCategoryPicker v-if="open" :nodes="nodes" @confirm="choose" @close="open = false" />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import CostCategoryPicker from "./CostCategoryPicker.vue";
import type { CostNode } from "@/api/business/finance";

const selected = defineModel<string>({ required: true });
const props = defineProps<{ nodes: CostNode[]; frozenName?: string; readonly?: boolean; disabled?: boolean }>();
const open = ref(false);
const byId = computed(() => new Map(props.nodes.map(node => [node.id, node])));
const selectedName = computed(() => props.frozenName || byId.value.get(selected.value)?.name || "");
function choose(id: string) {
  selected.value = id;
  open.value = false;
}
</script>
