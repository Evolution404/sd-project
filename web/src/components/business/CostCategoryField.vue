<template>
  <el-text v-if="selectedName" class="mr-2">{{ selectedName }}</el-text>
  <el-button v-if="!readonly" :disabled="disabled" @click="open = true">选择费用科目</el-button>
  <NativeRecordPicker v-if="open" single title="选择费用科目" placeholder="搜索科目名称或上级科目"
    confirm-label="确认选择" :columns="columns" :loader="load" @confirm="choose" @close="open = false" />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import NativeRecordPicker from "./NativeRecordPicker.vue";
import type { CostNode } from "@/api/business/finance";

const selected = defineModel<string>({ required: true });
const props = defineProps<{ nodes: CostNode[]; frozenName?: string; readonly?: boolean; disabled?: boolean }>();
const open = ref(false);
const byId = computed(() => new Map(props.nodes.map(node => [node.id, node])));
const selectedName = computed(() => props.frozenName || byId.value.get(selected.value)?.name || "");
type Row = { id: string; name: string; parentName: string };
const columns: { key: keyof Row; label: string }[] = [
  { key: "name", label: "科目名称" },
  { key: "parentName", label: "上级科目" },
];

async function load(keyword: string, page: number) {
  const term = keyword.toLowerCase();
  const matching = props.nodes.filter(node => node.selectable).map(node => ({
    id: node.id,
    name: node.name,
    parentName: node.parent_id ? byId.value.get(node.parent_id)?.name ?? "" : "",
  })).filter(row => row.name.toLowerCase().includes(term) || row.parentName.toLowerCase().includes(term));
  return { items: matching.slice((page - 1) * 20, page * 20), total: matching.length };
}

function choose(rows: Row[]) {
  if (rows[0]) selected.value = rows[0].id;
  open.value = false;
}
</script>
