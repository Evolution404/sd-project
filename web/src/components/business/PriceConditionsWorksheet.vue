<template>
  <BusinessWorksheet ref="sheet" name="动态计价条件" :rows="rows" :columns="columns" session-key="price-conditions"
    :validate="validate" :disabled="disabled" removable remove-label="移除选中条件" remove-guide="pricing.condition-remove"
    @rows-change="rows = $event" @readiness-change="ready = $event" @change="syncConditions">
    <template #toolbar>
      <el-button :disabled="disabled || !ready || !available.length" @click="picker = 'attributes'">添加计价条件</el-button>
      <el-button :disabled="disabled || !ready || !rows.length" @click="openValuePicker">选择正式选项</el-button>
    </template>
  </BusinessWorksheet>
  <NativeRecordPicker v-if="picker === 'attributes'" title="选择计价属性" placeholder="按属性名称查询"
    :columns="attributePickerColumns" :loader="loadAttributes" confirm-label="添加所选条件"
    @confirm="addAttributes" @close="picker = ''" />
  <NativeRecordPicker v-if="picker === 'values'" single title="选择计价取值" placeholder="按选项名称查询"
    :columns="valuePickerColumns" :loader="loadValues" confirm-label="确认选项" @confirm="selectValue" @close="picker = ''" />
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { ElMessage } from "element-plus";
import { validateAttributeCondition } from "../../../../server/shared/operation-attributes";
import type { AttributeCondition, OperationAttribute } from "../../../../server/shared/types/operation-attributes";
import type { OptionItem } from "@/api/common";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type { WorksheetColumn, WorksheetIssue, WorksheetRow, WorksheetValues } from "@/components/BusinessWorksheet/univer-engine";
import NativeRecordPicker from "./NativeRecordPicker.vue";

const props = defineProps<{ features: readonly OperationAttribute[]; choices: (field: OperationAttribute) => OptionItem[]; disabled?: boolean }>();
const conditions = defineModel<Record<string, AttributeCondition>>({ required: true });
const precisionLabel = "精确匹配", rangeLabel = "范围匹配";
const columns: WorksheetColumn[] = [
  { key: "label", title: "计价属性", width: 240 },
  { key: "op", title: "匹配方式", width: 150, editable: true, options: [precisionLabel, rangeLabel], required: true },
  { key: "value", title: "适用取值", width: 220, editable: true },
  { key: "min", title: "最小值", width: 150, editable: true, numeric: true },
  { key: "max", title: "最大值", width: 150, editable: true, numeric: true },
];
const bindings = new WeakMap<WorksheetRow, string>();
const byId = computed(() => new Map(props.features.map(field => [field.key, field])));
const ready = ref(false);
const sheet = ref<InstanceType<typeof BusinessWorksheet>>();
const picker = ref<"" | "attributes" | "values">("");
const target = shallowRef<WorksheetRow>();
type AttributeChoice = { id: string; label: string; level: string };
type ValueChoice = { id: string; label: string };
const attributePickerColumns: { key: keyof AttributeChoice; label: string }[] =
  [{ key: "label", label: "属性名称" }, { key: "level", label: "层级" }];
const valuePickerColumns: { key: keyof ValueChoice; label: string }[] = [{ key: "label", label: "正式选项名称" }];
const isNumeric = (field?: OperationAttribute) => field?.type === "integer" || field?.type === "decimal";

function worksheetRow(id: string, condition: AttributeCondition, priorLabel?: string): WorksheetRow {
  const field = byId.value.get(id);
  const selected = field?.type === "select" && typeof condition.value === "string" ? condition.value : "";
  const label = field?.label || priorLabel || "已撤下属性";
  const eqValue = field?.type === "boolean" ? (condition.value === true ? "是" : condition.value === false ? "否" : "")
    : typeof condition.value === "number" || typeof condition.value === "string" ? String(condition.value) : "";
  const row: WorksheetRow = { id, label,
    readonlyFields: isNumeric(field) ? [] : field?.type === "boolean" ? ["op", "min", "max"] : ["op", "value", "min", "max"],
    values: { label, op: condition.op === "range" ? rangeLabel : precisionLabel,
      value: selected && field ? props.choices(field).find(choice => String(choice.value) === selected)?.label || "已采用正式选项" : eqValue,
      min: String(condition.min ?? ""), max: String(condition.max ?? "") },
  };
  if (selected) bindings.set(row, selected);
  return row;
}
const rows = shallowRef<readonly WorksheetRow[]>(Object.entries(conditions.value).map(([id, condition]) => worksheetRow(id, condition)));
const available = computed(() => props.features.filter(field => !rows.value.some(row => row.id === field.key)));
function lookup<T>(items: T[], page: number) { return { items: items.slice((page - 1) * 20, page * 20), total: items.length }; }
async function loadAttributes(keyword: string, page: number) {
  return lookup(available.value.filter(field => field.label.includes(keyword)).map(field => ({
    id: field.key, label: field.label, level: field.scope === "demand" ? "需求级" : "位置级",
  })), page);
}
async function addAttributes(items: AttributeChoice[]) {
  const additions = items.flatMap(item => {
    const field = byId.value.get(item.id);
    return field ? [worksheetRow(item.id, { op: isNumeric(field) ? "range" : "eq" })] : [];
  });
  if (additions.length) await sheet.value?.addRows(additions);
  picker.value = "";
}
async function openValuePicker() {
  const ids = sheet.value?.selectedRowIds() || [];
  const row = ids.length === 1 ? rows.value.find(candidate => candidate.id === ids[0]) : undefined;
  if (!row || byId.value.get(row.id)?.type !== "select") {
    ElMessage.warning("请选择一条单选条件行"); return;
  }
  await sheet.value?.finishEditing();
  target.value = row;
  picker.value = "values";
}
async function loadValues(keyword: string, page: number) {
  const field = byId.value.get(target.value?.id || "");
  const choices = field ? props.choices(field) : [];
  const counts = new Map<string, number>();
  for (const choice of choices) counts.set(choice.label, (counts.get(choice.label) || 0) + 1);
  return lookup(choices.filter(choice => choice.label.includes(keyword) && counts.get(choice.label) === 1)
    .map(choice => ({ id: String(choice.value), label: choice.label })), page);
}
async function selectValue(items: ValueChoice[]) {
  const row = target.value;
  picker.value = "";
  if (row && items[0] && bindings.get(row) !== items[0].id)
    await sheet.value?.replaceRowReferences([worksheetRow(row.id, { op: "eq", value: items[0].id })]);
}
function condition(row: WorksheetRow, input: WorksheetValues[string]) {
  const field = byId.value.get(row.id);
  if (!field) throw Object.assign(Error("已采用的操作定义不再提供该属性，请移除原条件"), { field: "label" });
  const op = input.op === rangeLabel ? "range" : input.op === precisionLabel ? "eq" : undefined;
  if (!op) throw Object.assign(Error("请选择匹配方式"), { field: "op" });
  if (op === "range" && (!input.min || !input.max))
    throw Object.assign(Error("请填写数值范围"), { field: input.min ? "max" : "min" });
  let value: AttributeCondition["value"];
  if (op === "eq") {
    const text = input.value || "";
    if (field.type === "select") value = bindings.get(row);
    else if (field.type === "boolean") value = text === "是" ? true : text === "否" ? false : undefined;
    else if (field.type === "integer" && /^[+-]?[0-9]+$/.test(text)) value = Number(text);
    else if (field.type === "decimal") value = text || undefined;
    if (value === undefined) throw Object.assign(Error("请填写或选择正式取值"), { field: "value" });
  }
  const output: AttributeCondition = op === "eq" ? { op, value } : { op, min: input.min, max: input.max };
  validateAttributeCondition(field, output);
  return output;
}
function validate(values: WorksheetValues) {
  const issues: WorksheetIssue[] = [];
  rows.value.forEach((row, index) => {
    if (!values[row.id]) return;
    try { condition(row, values[row.id]); }
    catch (cause) {
      const failure = cause as Error & { field?: string };
      const field = failure.field || (values[row.id].op === rangeLabel ? "min" : "value");
      issues.push({ row: index + 1, rowId: row.id, column: columns.findIndex(column => column.key === field),
        field, cell: "", location: row.label, message: failure.message });
    }
  });
  return issues;
}
function syncConditions(values: WorksheetValues) {
  if (validate(values).length) return;
  const next = Object.fromEntries(rows.value.map(row => [row.id, condition(row, values[row.id])]));
  if (JSON.stringify(conditions.value) !== JSON.stringify(next)) conditions.value = next;
}
async function prepare() {
  const values = await sheet.value?.prepareSave();
  if (!values) return false;
  syncConditions(values);
  return true;
}
defineExpose({ prepare, changed: () => sheet.value?.changed(), finishEditing: () => sheet.value?.finishEditing() });
</script>
