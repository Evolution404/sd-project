<script setup lang="ts">
import { useAccess } from "../services/access";
const can = useAccess();
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, download, type Row } from "../services/api";
const props = defineProps<{ ownerKind: string; ownerId: string }>();
const includeDeleted = ref(false);
const rows = ref<Row[]>([]),
  busy = ref(false);
async function load() {
  rows.value = await api(
    `/evidence?owner_kind=${props.ownerKind}&owner_id=${props.ownerId}&deleted=${includeDeleted.value}`,
  );
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
onMounted(load);
</script>
<template>
  <div class="panel">
    <div class="toolbar">
      <h2>证据附件</h2>
      <ElCheckbox v-model="includeDeleted" @change="load"
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
    <ElTable :data="rows"
      ><ElTableColumn prop="filename" label="文件" /><ElTableColumn
        prop="bytes"
        label="字节数"
        width="120"
      /><ElTableColumn label="操作" min-width="260"
        ><template #default="{ row }"
          ><ElButton @click="download('/evidence/' + row.id, row.filename)"
            >下载</ElButton
          ><ElButton
            :disabled="!can('write') || row.deleted"
            @click="revise(row)"
            >修改说明</ElButton
          ><ElButton
            :disabled="!can('admin') || row.deleted"
            type="danger"
            @click="remove(row)"
            >删除</ElButton
          ></template
        ></ElTableColumn
      ></ElTable
    >
  </div>
</template>
