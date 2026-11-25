<template>
  <el-dialog :model-value="true" :title="config.title" width="min(92vw, 1450px)" append-to-body
    :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="closeFromDialog">
    <slot />
    <el-alert v-if="error" type="error" :title="error" :closable="false" class="mb-2" />
    <BusinessWorksheet ref="sheet" :name="config.title + '明细'" session-key="versioned-batch" :rows="rows" :columns="config.columns"
      :disabled="busy" :validate="validate" removable remove-label="移除选中明细"
      @rows-change="rows = $event" @readiness-change="ready = $event">
      <template #toolbar>
        <el-button v-if="revise" :disabled="!ready || busy || rows.length >= limit" @click="picker = true">选择待修订记录</el-button>
        <template v-else>
          <el-input-number v-model="newCount" aria-label="新增行数" :min="1" :max="Math.max(1, limit - rows.length)" :precision="0" />
          <el-button :disabled="!ready || busy || !newCount || rows.length >= limit || config.createReady === false"
            @click="addBlankRows">新增录入行</el-button>
        </template>
      </template>
    </BusinessWorksheet>
    <el-alert v-if="prepared" class="mt-2" type="success" :title="'已预检 ' + rows.length + ' 条明细'" :closable="false" />
    <template #footer>
      <el-button :disabled="busy" @click="close">关闭</el-button>
      <el-button :disabled="busy || !ready || !rows.length" @click="preview">预检明细</el-button>
      <el-button type="primary" :loading="busy" :disabled="!prepared" @click="commit">整批保存</el-button>
    </template>
  </el-dialog>
  <NativeRecordPicker v-if="picker" title="选择待修订记录" placeholder="搜索记录名称或编号" confirm-label="添加所选记录"
    :columns="choiceColumns" :loader="config.choices" @confirm="addRecords" @close="picker = false" />
</template>

<script setup lang="ts">
import { ref, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type { WorksheetIssue, WorksheetRow, WorksheetValues } from "@/components/BusinessWorksheet/univer-engine";
import { randomRequestId } from "@/utils/business/request-id";
import { MAX_VERSIONED_ENTRY_ROWS, type VersionedEntryRow } from "../../../../server/shared/types/versioned-entry";
import { submitVersionedBatch, type VersionedBatchEntryConfig, type VersionedEntryChoice } from "./versioned-batch-entry";
import NativeRecordPicker from "./NativeRecordPicker.vue";

const props = defineProps<{ config: VersionedBatchEntryConfig; revise: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const choiceColumns: { key: keyof VersionedEntryChoice; label: string }[] = [
  { key: "name", label: "名称" }, { key: "code", label: "编号" }, { key: "context", label: "归属" }, { key: "version", label: "正式版本" },
];
const limit = MAX_VERSIONED_ENTRY_ROWS;
const ready = ref(false), busy = ref(false), picker = ref(false);
const error = ref("");
const newCount = ref<number | undefined>(1);
const sheet = ref<InstanceType<typeof BusinessWorksheet>>();
const rows = shallowRef<readonly WorksheetRow[]>([]);
const bindings = new WeakMap<WorksheetRow, VersionedEntryChoice>();
const prepared = ref<{ input: string; fingerprint: string; key: string }>();
let sequence = 0;

function rowFor(record?: VersionedEntryChoice) {
  const id = String(++sequence);
  const row: WorksheetRow = { id, label: record?.name || "明细 " + id,
    values: record?.fields ?? props.config.initial() };
  if (record) bindings.set(row, record);
  return row;
}
async function addBlankRows() {
  const count = newCount.value;
  if (!count || !Number.isSafeInteger(count) || count < 1 || rows.value.length + count > limit) return;
  await sheet.value?.addRows(Array.from({ length: count }, () => rowFor()));
}
async function addRecords(records: VersionedEntryChoice[]) {
  const existing = new Set(rows.value.map(row => bindings.get(row)?.id));
  const selected = records.filter(record => !existing.has(record.id));
  if (selected.length + rows.value.length > limit) { ElMessage.warning("所选记录超过单批上限"); return; }
  if (selected.length) await sheet.value?.addRows(selected.map(rowFor));
  picker.value = false;
}
function problem(row: WorksheetRow, index: number, field: string, message: string): WorksheetIssue {
  return { row: index + 1, column: Math.max(0, props.config.columns.findIndex(column => column.key === field)),
    cell: "", rowId: row.id, field, location: row.label, message };
}
function validate(values: WorksheetValues): WorksheetIssue[] {
  return rows.value.flatMap((row, index) => {
    const data = values[row.id];
    if (!data) return [];
    const errors = props.config.columns.flatMap(column => {
      const raw = data[column.key]?.trim();
      if (column.required && !raw) return [problem(row, index, column.key, "请填写" + column.title)];
      if (raw && column.options && !column.options.includes(raw))
        return [problem(row, index, column.key, "请选择有效业务选项")];
      return [];
    });
    if (errors.length) return errors;
    try { props.config.values(data, bindings.get(row)); }
    catch (cause) {
      const failure = cause as Error & { field?: string };
      return [problem(row, index, failure.field || "name", failure.message)];
    }
    return [];
  });
}
function collect(values: WorksheetValues): VersionedEntryRow[] {
  return rows.value.map(row => {
    const record = bindings.get(row);
    return {
      ref: row.id, id: record?.id, values: {
        ...props.config.values(values[row.id], record),
        ...(record?.version !== undefined ? { expected_version: record.version } : {}),
      },
    };
  });
}
function report(cause: unknown) {
  const failure = cause as Error & { fields?: { batch_id?: string; batch_field?: string } };
  if (failure.fields?.batch_id) sheet.value?.focusField(failure.fields.batch_id, failure.fields.batch_field || "");
  error.value = failure.message;
}
async function preview() {
  if (busy.value) return;
  error.value = ""; prepared.value = undefined; busy.value = true;
  try {
    const values = await sheet.value?.prepareSave();
    if (!values) return;
    const rows = collect(values);
    const result = await submitVersionedBatch(props.config.endpoint, rows);
    if (result.fingerprint) prepared.value = { input: JSON.stringify(rows), fingerprint: result.fingerprint, key: randomRequestId() };
  } catch (cause) { report(cause); }
  finally { busy.value = false; }
}
async function commit() {
  if (busy.value || !prepared.value) return;
  const proof = prepared.value;
  error.value = ""; busy.value = true;
  try {
    const values = await sheet.value?.prepareSave();
    if (!values) return;
    const rows = collect(values);
    if (JSON.stringify(rows) !== proof.input) { prepared.value = undefined; throw Error("工作表内容已改变，请重新预检"); }
    await ElMessageBox.confirm("确认整批保存 " + rows.length + " 条正式记录？", "确认整批保存",
      { confirmButtonText: "确认提交", cancelButtonText: "继续填写" });
    await submitVersionedBatch(props.config.endpoint, rows, proof);
    ElMessage.success("已整批保存 " + rows.length + " 条记录");
    emit("saved");
  } catch (cause) { if (cause !== "cancel" && cause !== "close") report(cause); }
  finally { busy.value = false; }
}
async function mayLeave() {
  if (busy.value) return false;
  if (!rows.value.length) return true;
  try {
    await ElMessageBox.confirm("关闭将放弃尚未提交的批量资料。", "放弃批量录入",
      { type: "warning", confirmButtonText: "放弃修改", cancelButtonText: "继续填写" });
    return true;
  } catch { return false; }
}
async function close() { if (await mayLeave()) emit("close"); }
async function closeFromDialog(done: () => void) { if (await mayLeave()) { done(); emit("close"); } }
defineExpose({ mayLeave });
</script>
