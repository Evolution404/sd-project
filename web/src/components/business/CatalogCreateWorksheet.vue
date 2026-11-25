<template>
  <el-dialog :model-value="true" :title="title" width="min(92vw, 1510px)" append-to-body
    :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="closeFromDialog">
    <el-alert v-if="error" class="mb-3" type="error" :title="error" :closable="false" />
    <BusinessWorksheet ref="sheet" :name="labels[kind] + '新增明细'" session-key="catalog-create" :rows="rows" :columns="columns"
      :validate="validate" :disabled="busy" removable remove-label="移除选中明细" @rows-change="rows = $event" @readiness-change="ready = $event">
      <template #toolbar>
        <el-input-number v-model="count" aria-label="新增行数" :min="1" :max="Math.max(1, limit - rows.length)" :precision="0"
          :disabled="!ready || busy || rows.length >= limit" />
        <el-button :disabled="!ready || busy || !count || rows.length >= limit" @click="addRows">新增明细行</el-button>
        <el-dropdown v-if="referenceFields.length" trigger="click" @command="referenceCommand">
          <el-button :disabled="!ready || busy || !rows.length">设置引用</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <template v-for="field in referenceFields" :key="field">
                <el-dropdown-item :command="field">选择{{ references[field].title }}</el-dropdown-item>
                <el-dropdown-item v-if="references[field].optional" :command="'clear:' + field">清除{{ references[field].title }}</el-dropdown-item>
              </template>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </template>
    </BusinessWorksheet>
    <el-alert v-if="issues.length" class="mt-3" type="error" title="请修正以下明细后重新预检" :closable="false">
      <div v-for="(issue,index) in issues" :key="index">
        <el-button link type="danger" @click="focusIssue(issue)">明细 {{ issue.row }}</el-button>{{ issue.message }}
      </div>
    </el-alert>
    <el-alert v-else-if="prepared" class="mt-3" type="success" :title="'已预检 ' + rows.length + ' 条明细'" :closable="false" />
    <template #footer>
      <el-button :disabled="busy" @click="close">关闭</el-button>
      <el-button :disabled="!ready || busy || !rows.length" @click="preview">预检明细</el-button>
      <el-button :disabled="!prepared" :loading="busy" type="primary" @click="commit">整批保存</el-button>
    </template>
  </el-dialog>
  <NativeRecordPicker v-if="picker" single :title="'选择' + references[picker].title" placeholder="搜索设备"
    confirm-label="确认选择" :columns="equipmentReferenceColumns(references[picker].kind)" :loader="loadReference"
    :selectable="eligibleReference" @confirm="chooseReference" @close="picker = undefined" />
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { OptionItem } from "@/api/common";
import { listEquipment, type EquipmentKind, type EquipmentRow } from "@/api/business/equipment";
import { commitWorkbook, previewAssetWorksheet } from "@/api/business/exchange";
import { saveMaterialWorksheet } from "@/api/business/materials";
import { randomRequestId } from "@/utils/business/request-id";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type { WorksheetColumn, WorksheetIssue, WorksheetRow, WorksheetValues } from "@/components/BusinessWorksheet/univer-engine";
import { EQUIPMENT_CREATE_WORKSHEET_FIELDS, EQUIPMENT_FIELD_META, EQUIPMENT_LINE_KINDS,
  MAX_EQUIPMENT_WORKSHEET_ROWS, type EquipmentBulkKind } from "../../../../server/shared/equipment-bulk";
import { MATERIAL_CREATE_WORKSHEET_FIELDS, MAX_MATERIAL_WORKSHEET_ROWS, type MaterialWorksheetIssue }
  from "../../../../server/shared/types/master-data";
import NativeRecordPicker from "./NativeRecordPicker.vue";
import { equipmentReferenceColumns } from "./equipment-reference-columns";

const props = defineProps<{ kind: EquipmentBulkKind | "materials"; options: Record<string, OptionItem[]> }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const labels = { lines: "输电线路", physical: "物理杆塔", towers: "逻辑杆塔", spans: "档距", materials: "物资" };
const title = computed(() => "批量新增" + labels[props.kind]);
const references = {
  parent_line_id: { kind: "lines", title: "所属主线", optional: true },
  junction_tower_id: { kind: "towers", title: "分支接入塔", optional: true },
  line_id: { kind: "lines", title: "所属线路", optional: false },
  physical_tower_id: { kind: "physical", title: "共用物理杆塔", optional: true },
  start_tower_id: { kind: "towers", title: "起点逻辑杆塔", optional: false },
  end_tower_id: { kind: "towers", title: "终点逻辑杆塔", optional: false },
} satisfies Record<string,{ kind: EquipmentKind; title: string; optional: boolean }>;
type ReferenceKey = keyof typeof references;
type Bindings = Partial<Record<ReferenceKey, EquipmentRow>>;
const rows = shallowRef<readonly WorksheetRow[]>([]);
const rowReferences = new WeakMap<WorksheetRow, Bindings>();
const sheet = ref<InstanceType<typeof BusinessWorksheet>>();
const busy = ref(false), ready = ref(false), error = ref("");
const issues = ref<MaterialWorksheetIssue[]>([]);
const count = ref<number | undefined>(1);
const picker = ref<ReferenceKey>();
const prepared = ref<{ ticket: string; key: string; input: string }>();
const limit = computed(() => props.kind === "materials" ? MAX_MATERIAL_WORKSHEET_ROWS : MAX_EQUIPMENT_WORKSHEET_ROWS);
let sequence = 0;
let targets = new Set<string>();
let referenceLine: EquipmentRow | undefined;

const fields = computed<readonly string[]>(() => props.kind === "materials" ? MATERIAL_CREATE_WORKSHEET_FIELDS : EQUIPMENT_CREATE_WORKSHEET_FIELDS[props.kind]);
function isReference(field: string): field is ReferenceKey { return Object.hasOwn(references, field); }
const referenceFields = computed(() => fields.value.filter(isReference));
function labelsFor(field: string) {
  return (props.options[field] || []).map(option => String(option.label));
}
function uniqueChoices(field: string) {
  const choices = labelsFor(field);
  return choices.filter(label => choices.indexOf(label) === choices.lastIndexOf(label));
}
const columns = computed<WorksheetColumn[]>(() => fields.value.map(key => {
  if (isReference(key)) return { key, title: references[key].title, width: 165 };
  if (key === "voltage_name") return { key, title: "电压等级", width: 120, editable: true, required: true,
    options: uniqueChoices("voltage_level_id") };
  if (key === "line_kind") return { key, title: "线路性质", width: 125, editable: true, required: true,
    options: Object.values(EQUIPMENT_LINE_KINDS) };
  if (props.kind === "materials") {
    const names: Record<string, string> = { name: "物资名称", unit_id: "计量单位", model: "型号", specification: "规格", note: "备注" };
    return { key, title: names[key], width: key === "unit_id" ? 125 : 220, editable: true,
      options: key === "unit_id" ? uniqueChoices(key) : undefined, required: key === "unit_id" || key === "name" };
  }
  const meta = EQUIPMENT_FIELD_META[key];
  return { key, title: meta.title, width: 145, editable: true, required: meta.required && key !== "sort_rank",
    numeric: meta.type === "number", options: meta.type === "select" ? uniqueChoices(key) : undefined };
}));
function worksheetRow(binding: Bindings = {}, id = String(++sequence)): WorksheetRow {
  const values: Record<string, string> = {};
  if (props.kind === "lines") values.line_kind = EQUIPMENT_LINE_KINDS.main;
  for (const field of referenceFields.value) {
    const choice = binding[field];
    values[field] = choice ? (choice.name || choice.tower_no || choice.tower_code || "") : "";
  }
  const row: WorksheetRow = { id, label: "明细 " + id, values };
  rowReferences.set(row, binding);
  return row;
}
async function addRows() {
  const next = count.value;
  if (!next || !Number.isSafeInteger(next) || next < 1 || rows.value.length + next > limit.value) return;
  await sheet.value?.addRows(Array.from({ length: next }, () => worksheetRow()));
}
function chosenRows() { return rows.value.filter(row => targets.has(row.id)); }
async function referenceCommand(command: unknown) {
  if (typeof command !== "string") return;
  const clear = command.startsWith("clear:");
  const field = clear ? command.slice(6) : command;
  if (!isReference(field)) return;
  targets = new Set(sheet.value?.selectedRowIds() || []);
  if (!targets.size) return ElMessage.warning("请先选择工作表中的目标行");
  referenceLine = undefined;
  if (["junction_tower_id", "start_tower_id", "end_tower_id"].includes(field) && !clear) {
    const scope = field === "junction_tower_id" ? "parent_line_id" : "line_id";
    const selectedLines = chosenRows().map(row => rowReferences.get(row)?.[scope]);
    if (!selectedLines[0] || selectedLines.some(line => line?.id !== selectedLines[0]?.id))
      return ElMessage.warning("请先为这些行设置同一条正式线路");
    referenceLine = selectedLines[0];
  }
  await sheet.value?.finishEditing();
  if (clear) await applyReference(field);
  else picker.value = field;
}
async function applyReference(field: ReferenceKey, choice?: EquipmentRow) {
  const replacements = chosenRows().flatMap(row => {
    const binding = rowReferences.get(row)!;
    if (binding[field]?.id === choice?.id) return [];
    const next = { ...binding, [field]: choice };
    if (field === "line_id") { delete next.start_tower_id; delete next.end_tower_id; }
    if (field === "parent_line_id") delete next.junction_tower_id;
    return [worksheetRow(next, row.id)];
  });
  if (replacements.length) await sheet.value?.replaceRowReferences(replacements);
}
async function chooseReference(choices: EquipmentRow[]) {
  const field = picker.value;
  picker.value = undefined;
  if (field && choices[0]) await applyReference(field, choices[0]);
}
async function loadReference(keyword: string, page: number) {
  const field = picker.value;
  if (!field) return { items: [], total: 0 };
  const useBranchJunction = field !== "junction_tower_id" && referenceLine?.line_kind === "branch";
  return listEquipment(references[field].kind, { keyword, page, size: 20,
    lineId: useBranchJunction ? undefined : referenceLine?.id,
    lineKind: field === "parent_line_id" ? "main" : undefined, filters: { status: "active" } });
}
function eligibleReference(record: EquipmentRow) {
  if (record.deleted || record.status !== "active") return false;
  if (!referenceLine) return true;
  return record.line_id === referenceLine.id || (picker.value !== "junction_tower_id" && record.id === referenceLine.junction_tower_id);
}
function validate(values: WorksheetValues): WorksheetIssue[] {
  const failures: WorksheetIssue[] = [];
  for (const [index, row] of rows.value.entries()) {
    const input = values[row.id];
    const choices = rowReferences.get(row)!;
    if (!input) continue;
    const issue = (field: string, message: string) => failures.push({ row: index + 1, rowId: row.id, field,
      column: Math.max(0, columns.value.findIndex(column => column.key === field)), cell: "", location: row.label, message });
    for (const column of columns.value) {
      const value = input[column.key]?.trim();
      if (column.required && !value) issue(column.key, "请填写" + column.title);
      else if (value && column.options && !column.options.includes(value)) issue(column.key, "请选择正式业务选项");
    }
    for (const field of referenceFields.value) {
      const required = !references[field].optional || (input.line_kind === EQUIPMENT_LINE_KINDS.branch && props.kind === "lines");
      if (required && !choices[field]) issue(field, "请选择" + references[field].title);
    }
    if (input.line_kind === EQUIPMENT_LINE_KINDS.main && (choices.parent_line_id || choices.junction_tower_id))
      issue("line_kind", "主线没有所属主线与分支接入塔，请清除引用");
    if (props.kind === "physical" && !Object.values(input).some(value => value.trim()))
      issue("asset_no", "请填写至少一项真实实物属性");
  }
  return failures;
}
function payload(values: WorksheetValues) {
  return rows.value.map(row => Object.fromEntries(fields.value.flatMap(field => {
    if (isReference(field)) {
      const reference = rowReferences.get(row)?.[field];
      return reference ? [[field, reference.id]] : [];
    }
    const raw = values[row.id][field]?.trim() || "";
    if (field === "unit_id") {
      const unit = props.options.unit_id?.find(option => option.label === raw);
      return unit ? [[field, String(unit.value)]] : [];
    }
    return raw ? [[field, raw]] : [];
  })));
}
function focusIssue(issue: MaterialWorksheetIssue) {
  const row = rows.value[issue.row - 1];
  if (row) sheet.value?.focusField(row.id, issue.field || "");
}
async function preview() {
  if (busy.value) return;
  busy.value = true; error.value = ""; issues.value = []; prepared.value = undefined;
  try {
    const values = await sheet.value?.prepareSave();
    if (!values) return;
    const input = payload(values);
    let ticket: string | undefined;
    if (props.kind === "materials") {
      const result = await saveMaterialWorksheet(input);
      issues.value = result.issues;
      ticket = result.fingerprint;
    } else {
      const result = await previewAssetWorksheet(props.kind, input);
      issues.value = result.issues.map(issue => ({ row: issue.row - 1, field: issue.field, message: issue.reason }));
      if (result.previous) { error.value = "相同设备批次已经提交，请在台账核对"; return; }
      if (!issues.value.length) ticket = result.token;
    }
    if (ticket) prepared.value = { ticket, key: randomRequestId(), input: JSON.stringify(input) };
  } catch (cause) { error.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function commit() {
  if (!prepared.value || busy.value) return;
  const stage = prepared.value;
  busy.value = true;
  try {
    const values = await sheet.value?.prepareSave();
    if (!values) return;
    const input = payload(values);
    if (stage.input !== JSON.stringify(input)) { prepared.value = undefined; error.value = "录入内容已变化，请重新预检"; return; }
    await ElMessageBox.confirm("确认整批保存 " + rows.value.length + " 条台账事实？", title.value,
      { confirmButtonText: "确认提交", cancelButtonText: "继续填写" });
    if (props.kind === "materials") {
      const result = await saveMaterialWorksheet(input, { fingerprint: stage.ticket, key: stage.key });
      if (result.issues.length) { issues.value = result.issues; prepared.value = undefined; return; }
    } else await commitWorkbook(stage.ticket, stage.key, true);
    ElMessage.success("已整批新增 " + rows.value.length + " 条记录");
    emit("saved");
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close") error.value = (cause as Error).message;
  } finally { busy.value = false; }
}
async function mayLeave() {
  if (busy.value) return false;
  if (!rows.value.length) return true;
  try {
    await ElMessageBox.confirm("当前批量录入尚未保存，确定放弃？", "放弃批量录入",
      { confirmButtonText: "放弃修改", cancelButtonText: "继续填写" });
    return true;
  } catch { return false; }
}
async function close() { if (await mayLeave()) emit("close"); }
async function closeFromDialog(done: () => void) { if (await mayLeave()) { done(); emit("close"); } }
defineExpose({ mayLeave });
</script>
