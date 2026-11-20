<script setup lang="ts">
import { ref } from "vue";
import { CopyDocument } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";

const props = defineProps<{ value: string; label: string }>();
const code = ref<HTMLElement>();

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    ElMessage.success("已复制" + props.label);
  } catch {
    const selection = window.getSelection();
    if (!selection || !code.value) return;
    selection.selectAllChildren(code.value);
    ElMessage.info("编号已选中，可使用复制快捷键");
  }
}
</script>

<template>
  <span class="business-number">
    <span ref="code" class="business-number-value">{{ value }}</span>
    <ElButton text size="small" :icon="CopyDocument" :title="'复制' + label"
      :aria-label="'复制' + label" @click.stop="copy" />
  </span>
</template>

<style scoped>
.business-number { display: inline-flex; align-items: baseline; gap: 2px; max-width: 100%; }
.business-number-value { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; user-select: text; }
.business-number .el-button { flex: none; margin: 0; padding: 3px 5px; color: var(--el-text-color-secondary); }
</style>
