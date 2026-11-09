<script setup lang="ts">
import RowActions from "./RowActions.vue";
import { useAccess } from "../services/access";
const can = useAccess();
import { ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, download, type Row } from "../services/api";
import BusinessTable, { type TableColumn } from "./BusinessTable.vue";
const props = defineProps<{ ownerKind: string; ownerId: string }>();
const includeDeleted = ref(false);
const rows = ref<Row[]>([]),
  busy = ref(false);
const evidenceColumns: TableColumn[] = [
  { key: "filename", label: "文件名称", minWidth: 220 },
  { key: "bytes", label: "大小", minWidth: 115 },
  { key: "note", label: "附件说明", minWidth: 180 },
  { key: "deleted", label: "归档状态", minWidth: 115 },
];
let requestSequence = 0;
async function load() {
  const sequence = ++requestSequence;
  const response = await api<Row[]>(
    `/evidence?owner_kind=${props.ownerKind}&owner_id=${props.ownerId}&deleted=${includeDeleted.value}`,
  );
  if (sequence === requestSequence) rows.value = response;
}
async function upload(file: Row) {
  busy.value = true;
  try {
    const data = new Uint8Array(await file.raw.arrayBuffer());
    if (data.length > 10 * 1024 * 1024) throw Error("附件不能超过10MB");
    let binary = "";
    for (let i = 0; i < data.length; i += 8192)
      binary += String.fromCharCode(...data.subarray(i, i + 8192));
    await api("/evidence", "POST", {
      owner_kind: props.ownerKind,
      owner_id: props.ownerId,
      filename: file.name,
      mime: file.raw.type,
      base64: btoa(binary),
    });
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function remove(row: Row) {
  await ElMessageBox.confirm(
    "从正常附件列表移除，原证据和关联历史保留。",
    "删除附件",
  );
  await api("/evidence/" + row.id, "DELETE", {});
  await load();
}
async function revise(row: Row) {
  try {
    const { value } = await ElMessageBox.prompt(
      "填写附件说明，原始文件保持归档。",
      "修改附件说明",
      { inputValue: row.note || "" },
    );
    await api("/evidence/" + row.id, "POST", { note: value || "" });
    await load();
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
watch(() => [props.ownerKind, props.ownerId, includeDeleted.value], () => void load(), { immediate: true });
</script>
<template>
  <div class="panel">
    <div class="toolbar">
      <h2>证据附件</h2>
      <ElCheckbox v-model="includeDeleted"
        >包含已删除</ElCheckbox
      >
      <ElUpload
        :disabled="!can('write')"
        :auto-upload="false"
        :show-file-list="false"
        :on-change="upload"
        ><ElButton :disabled="!can('write')" :loading="busy"
          >添加附件</ElButton
        ></ElUpload
      >
    </div>
        <BusinessTable client-side :table-key="'evidence:' + ownerKind"
      :rows="rows" :columns="evidenceColumns" :actions-width="180" compact>
      <template #cell="{ row, column }">
        <span v-if="column.key === 'bytes'">{{ row.bytes == null ? '—' : Number(row.bytes).toLocaleString('zh-CN') + ' 字节' }}</span>
        <ElTag v-else-if="column.key === 'deleted'" :type="row.deleted ? 'info' : 'success'" effect="plain">
          {{ row.deleted ? '已删除' : '有效' }}
        </ElTag>
        <span v-else>{{ row[column.key] || '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          { label: '下载', run: () => download('/evidence/' + row.id, row.filename) },
          { label: '修改说明', disabled: !can('write') || row.deleted, run: () => revise(row) },
          { label: '删除', danger: true, disabled: !can('admin') || row.deleted, run: () => remove(row) },
        ]" />
      </template>
    </BusinessTable>
  </div>
</template>
