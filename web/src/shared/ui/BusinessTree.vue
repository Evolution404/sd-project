<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { TreeInstance } from "element-plus";
import {
  buildTree,
  matchingTreeIds,
  treePath,
  type TreeRecord,
} from "../utils/tree";
export interface DisplayTreeNode extends TreeRecord {
  status?: string;
  deleted?: boolean;
  disabled_reason?: string;
}
const props = defineProps<{
  nodes: DisplayTreeNode[];
  modelValue: string | null;
  label: string;
  loading?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [id: string] }>();
const tree = ref<TreeInstance>(),
  search = ref("");
const data = computed(() => buildTree(props.nodes));
const matches = computed(() => matchingTreeIds(props.nodes, search.value));
const expanded = ref<string[]>([]);
let beforeSearch: string[] = [];
function setExpansion(ids: string[]) {
  expanded.value = ids;
  const requested = new Set(ids);
  for (const item of props.nodes) {
    const node = tree.value?.getNode(item.id);
    if (requested.has(item.id)) node?.expand();
    else node?.collapse();
  }
}
watch(search, async (value, previous) => {
  if (value && !previous) beforeSearch = [...expanded.value];
  await nextTick();
  tree.value?.filter(value);
  if (value) setExpansion([...matches.value]);
  else setExpansion(beforeSearch);
});
watch(
  () => props.nodes,
  async () => {
    await nextTick();
    tree.value?.filter(search.value);
    setExpansion(expanded.value);
    revealSelection();
  },
  { deep: true },
);
function revealSelection() {
  if (!props.modelValue) return;
  tree.value?.setCurrentKey(props.modelValue);
  if (!search.value) {
    const ancestors = treePath(props.nodes, props.modelValue)
      .slice(0, -1)
      .map((node) => node.id);
    setExpansion([...new Set([...expanded.value, ...ancestors])]);
  }
}
watch(
  () => props.modelValue,
  async () => {
    await nextTick();
    revealSelection();
  },
);
function filterNode(_value: string, node: Record<string, unknown>) {
  return matches.value.has(String(node.id));
}
function selectNode(node: DisplayTreeNode) {
  emit("update:modelValue", node.id);
}
function expandNode(node: DisplayTreeNode) {
  expand(node.id);
}
function collapseNode(node: DisplayTreeNode) {
  expanded.value = expanded.value.filter((id) => id !== node.id);
}
function expand(id: string) {
  if (!expanded.value.includes(id)) expanded.value.push(id);
}
</script>
<template>
  <section class="business-tree" :aria-label="label" v-loading="loading">
    <ElInput v-model="search" clearable :placeholder="'搜索' + label" />
    <div class="tree-controls">
      <ElButton
        text
        size="small"
        @click="setExpansion(nodes.map((node) => node.id))"
        >展开全部</ElButton
      ><ElButton text size="small" @click="setExpansion([])">折叠全部</ElButton>
    </div>
    <ElTree
      ref="tree"
      :data="data"
      node-key="id"
      :props="{ label: 'name', children: 'children' }"
      highlight-current
      :current-node-key="modelValue || undefined"
      :default-expanded-keys="expanded"
      :expand-on-click-node="false"
      :filter-node-method="filterNode"
      @node-click="selectNode"
      @node-expand="expandNode"
      @node-collapse="collapseNode"
    >
      <template #default="{ data: node }"
        ><span class="tree-node-label">{{ node.name }}</span
        ><ElTag v-if="node.deleted" size="small" type="danger">已删除</ElTag
        ><ElTag v-else-if="node.status === 'inactive'" size="small" type="info"
          >停用</ElTag
        ><ElTooltip
          v-if="node.disabled_reason || node.issue"
          :content="
            node.disabled_reason ||
            (node.issue === 'orphan'
              ? '原上级暂缺，保留历史节点'
              : '层级异常，已安全展开')
          "
          ><ElTag size="small" type="warning">提示</ElTag></ElTooltip
        ></template
      >
    </ElTree>
    <ElEmpty v-if="!nodes.length" :description="'尚无' + label" :image-size="60"
      ><slot name="empty"
    /></ElEmpty>
    <ElEmpty
      v-else-if="!matches.size"
      description="没有符合搜索条件的节点"
      :image-size="60"
      ><ElButton @click="search = ''">清除搜索</ElButton></ElEmpty
    >
  </section>
</template>
<style scoped>
.business-tree {
  min-width: 0;
}
.tree-controls {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}
.el-tree {
  max-height: 430px;
  overflow: auto;
  background: transparent;
}
.tree-node-label {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
  margin-right: 8px;
}
.el-tag {
  margin-right: 5px;
}
:deep(.el-tree-node__content) {
  height: 36px;
  border-radius: 7px;
}
:deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: var(--brand-soft);
}
</style>
