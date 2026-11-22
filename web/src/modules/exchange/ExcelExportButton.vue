<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import type { AssetExchangeKind, WorkbookKind } from "../../../../server/shared/types/exchange";
import { downloadExport } from "./download-export";

const props = defineProps<{
  kind: WorkbookKind | "projects";
  appliedQuery?: string;
  total?: number;
  selectedIds?: readonly string[];
  projectId?: string;
  assetKind?: AssetExchangeKind;
  disabled?: boolean;
  guideAction?: string;
}>();
const busy = ref(false);
const selected = computed(() => props.selectedIds !== undefined);
const count = computed(() => selected.value ? props.selectedIds?.length ?? 0 : props.total);
const scope = computed(() => selected.value ? `已选 ${count.value} 条`
  : `当前筛选（全部页）${count.value === undefined ? "" : `共 ${count.value} 条`}`);
const blocked = computed(() => props.disabled || busy.value || count.value === 0 ||
  (count.value ?? 0) > 5000 || (!selected.value && props.appliedQuery === ""));
async function saveReport() {
  if (blocked.value) return;
  const query = new URLSearchParams(selected.value ? "" : props.appliedQuery);
  query.delete("page");
  query.set("report", "true");
  if (props.projectId) query.set("project_id", props.projectId);
  if (props.assetKind) query.set("asset_kind", props.assetKind);
  busy.value = true;
  try { await downloadExport(`/exchange/${props.kind}/export?${query}`, props.selectedIds); }
  catch (failure) { ElMessage.error((failure as Error).message); }
  finally { busy.value = false; }
}
</script>

<template>
  <ElButton :data-guide-action="guideAction" :loading="busy" :disabled="blocked"
    :title="scope" :aria-description="scope" @click="saveReport">
    {{ selected ? "导出所选" : "导出 Excel" }}
  </ElButton>
</template>
